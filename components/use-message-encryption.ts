/**
 * Manages browser-only unlocked identities and encrypted multi-device recovery.
 * Plaintext exists only in component memory; backups and public keys use the API.
 * Public identities are pinned per browser; changes fail closed for review.
 */
"use client"
import { useEffect, useState, useRef } from "react"
import { apiPath } from "@/lib/paths"
import { createMessageIdentity,recoverMessageIdentity,identityFingerprint,encryptMessage,decryptMessage,type MessageIdentity,type PublicMessageKey,type KeyBackup } from "@/lib/message-crypto"
import type { AppMessage } from "@/lib/message-policy"
import { loadDeviceIdentity,rememberDeviceIdentity,forgetDeviceIdentity } from "@/lib/message-device-store"
import { readClientData,invalidateClientData } from "@/lib/client-data-cache"

/**
 * Loads scoped identities, unlocks recovery backups, and decrypts signed messages.
 * @param email - Authenticated account email.
 * @param messages - Current scoped message list.
 * @returns Encryption status, plaintext cache, fingerprint directory, and actions.
 */
export function useMessageEncryption(email:string,messages:AppMessage[]) {
  const [keys,setKeys]=useState<PublicMessageKey[]>([])
  const [own,setOwn]=useState<(PublicMessageKey&{backup:KeyBackup})|null>(null)
  const [identity,setIdentity]=useState<MessageIdentity|null>(null)
  const [plaintext,setPlaintext]=useState<Record<string,string>>({})
  const [error,setError]=useState<string|null>(null)
  const [busy,setBusy]=useState(false)
  const [loaded,setLoaded]=useState(false)
  const [revision,setRevision]=useState(0)
  const activeEmail=useRef(email);activeEmail.current=email
  const autoRestore=useRef(true)
  const decrypted=useRef(new Map<string,{evidence:string;text:string}>())
  const previousPeers=useRef("")
  const peers=[...new Set(messages.flatMap(message=>[message.sender_email,message.recipient_email,message.encrypted_payload?.author,...Object.keys(message.encrypted_payload?.keys??{})]).filter(Boolean))].sort().join("|")
  useEffect(()=>{setIdentity(null);setPlaintext({});setOwn(null);setLoaded(false);decrypted.current.clear();autoRestore.current=true},[email])
  useEffect(()=>{
    if(!email)return
    const refresh=()=>{if(document.visibilityState==="visible"){invalidateClientData(email,apiPath("/api/messages/keys"));setRevision(value=>value+1)}}
    const timer=window.setInterval(refresh,30000)
    window.addEventListener("focus",refresh)
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh)}
  },[email])
  useEffect(()=>{
    if(!email)return
    let cancelled=false
    if(previousPeers.current!==peers){invalidateClientData(email,apiPath("/api/messages/keys"));previousPeers.current=peers}
    readClientData<{own:(PublicMessageKey&{backup:KeyBackup})|null;keys:PublicMessageKey[]}>(apiPath("/api/messages/keys"),email,15000).then(async data=>{
      if(data.own&&(data.own.email.toLowerCase()!==email.toLowerCase()||await identityFingerprint(data.own.publicKey,data.own.signingKey)!==data.own.fingerprint))throw new Error("Own encryption identity mismatch.")
      for(const key of data.keys as PublicMessageKey[]){
        if(await identityFingerprint(key.publicKey,key.signingKey)!==key.fingerprint)throw new Error("Public identity fingerprint mismatch.")
        const cacheKey=`message-key:${email}:${key.email}`
        const pinned=localStorage.getItem(cacheKey)
        if(pinned&&pinned!==key.fingerprint)throw new Error("A participant's encryption identity changed. Verify it before continuing.")
        localStorage.setItem(cacheKey,key.fingerprint)
      }
      if(!cancelled){
        setOwn(data.own);setKeys(data.keys);setLoaded(true);setError(null)
        try{
          const remembered=await loadDeviceIdentity(email)
          if(!cancelled&&autoRestore.current&&remembered&&data.own){
            if(remembered.fingerprint!==data.own.fingerprint||remembered.publicKey!==data.own.publicKey||remembered.signingKey!==data.own.signingKey||remembered.encryption.extractable||remembered.signing.extractable)throw new Error("Trusted-device identity changed. Recover or verify it before continuing.")
            setIdentity(remembered)
          }
        }catch(error){if(!cancelled&&error instanceof Error&&error.message.includes("identity changed")){setIdentity(null);setError(error.message)}}
      }
    }).catch(error=>{if(!cancelled){setIdentity(null);setKeys([]);setLoaded(false);setError(error instanceof Error?error.message:"Encryption unavailable.")}})
    return ()=>{cancelled=true}
  },[email,revision,peers])
  useEffect(()=>{
    let cancelled=false
    if(!identity){setPlaintext({});return}
    /** @returns Promise<void> after decrypting authorized messages without changing receipts. */
    async function decrypt():Promise<void>{
      const next:Record<string,string>={}
      for(const message of messages){
        if(!message.encrypted_payload||message.deleted_at)continue
        const author=keys.find(key=>key.email===message.encrypted_payload!.author)
        if(!author)continue
        try{
          if(message.encrypted_payload.sender!==message.sender_email || message.encrypted_payload.recipient!==message.recipient_email)throw new Error("Message identity mismatch.")
          const evidence=JSON.stringify([message.encrypted_payload,author.fingerprint])
          const previous=decrypted.current.get(message.id)
          const text=previous?.evidence===evidence?previous.text:await decryptMessage(message.encrypted_payload,identity!,email,author)
          next[message.id]=text
          if(!cancelled)decrypted.current.set(message.id,{evidence,text})
        }
        catch{if(!cancelled)setError("A message could not be authenticated or decrypted. Its contents were not shown.")}
      }
      if(!cancelled){for(const id of decrypted.current.keys())if(!(id in next))decrypted.current.delete(id);setPlaintext(next)}
    }
    void decrypt();return ()=>{cancelled=true}
  },[identity,email,messages,keys])
  /** @param passphrase - Browser-only recovery secret. @param remember - Whether this personal browser may retain nonextractable keys. @returns Promise<boolean> confirming setup or unlocking. */
  async function unlock(passphrase:string,remember=true):Promise<boolean>{
    setBusy(true);setError(null)
    try{
      const account=email
      let unlocked:MessageIdentity
      if(own){unlocked=await recoverMessageIdentity(own.backup,passphrase,own)}
      else{
        const result=await createMessageIdentity(passphrase,email)
        const response=await fetch(apiPath("/api/messages/keys"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({publicKey:result.identity.publicKey,signingKey:result.identity.signingKey,fingerprint:result.identity.fingerprint,backup:result.backup})})
        if(!response.ok)throw new Error((await response.json()).error)
        unlocked=result.identity
      }
      if(activeEmail.current!==account)return false
      if(remember){try{await rememberDeviceIdentity(account,unlocked)}catch{setError("Messaging unlocked for this session, but this browser could not remember the device.")}}
      else await forgetDeviceIdentity(account).catch(()=>{})
      setIdentity(unlocked)
      autoRestore.current=true
      invalidateClientData(account,apiPath("/api/messages/keys"))
      setRevision(value=>value+1);return true
    }catch{setError("Unable to unlock or set up encryption. Check your recovery passphrase; existing identities cannot be replaced.");if(!own)setRevision(value=>value+1);return false}
    finally{setBusy(false)}
  }
  /** @param text - Plaintext. @param recipient - Private recipient or broadcast. @param recipients - Fixed participant identities. @param sender - Original sender for edits. @returns Signed ciphertext for server storage. */
  async function encrypt(text:string,recipient:string|null,recipients:string[],sender=email){
    if(!identity)throw new Error("Unlock messaging encryption first.")
    if(new Set(recipients.map(value=>value.toLowerCase())).size>100)throw new Error("A message can include at most 100 participants, including the sender.")
    const participants=[...new Set(recipients.map(value=>value.toLowerCase()))].map(value=>{
      const key=keys.find(key=>key.email===value);if(!key)throw new Error(`${value} must set up messaging encryption first.`);return key
    })
    return encryptMessage(text,identity,email,sender,recipient,participants)
  }
  /** @returns Promise<void> after forgetting local keys and clearing plaintext memory. */
  async function lock():Promise<void>{
    setIdentity(null);setPlaintext({});decrypted.current.clear()
    autoRestore.current=false
    try{await forgetDeviceIdentity(email)}catch{setError("Unable to forget this device. Clear browser site data before using a shared device.")}
  }
  return {own,keys,plaintext,error,busy,loaded,unlocked:!!identity,unlock,encrypt,lock}
}
