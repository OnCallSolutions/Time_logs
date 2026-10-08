/**
 * Manages browser-only unlocked identities and encrypted multi-device recovery.
 * Plaintext exists only in component memory; backups and public keys use the API.
 * Public identities are pinned per browser; changes fail closed for review.
 */
"use client"
import { useEffect, useState } from "react"
import { apiPath } from "@/lib/paths"
import { createMessageIdentity,recoverMessageIdentity,identityFingerprint,encryptMessage,decryptMessage,type MessageIdentity,type PublicMessageKey,type KeyBackup } from "@/lib/message-crypto"
import type { AppMessage } from "@/lib/message-policy"

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
  useEffect(()=>{setIdentity(null);setPlaintext({});setOwn(null);setLoaded(false)},[email])
  useEffect(()=>{
    if(!email)return
    const controller=new AbortController()
    fetch(apiPath("/api/messages/keys"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error)
      for(const key of data.keys as PublicMessageKey[]){
        if(await identityFingerprint(key.publicKey,key.signingKey)!==key.fingerprint)throw new Error("Public identity fingerprint mismatch.")
        const cacheKey=`message-key:${email}:${key.email}`
        const pinned=localStorage.getItem(cacheKey)
        if(pinned&&pinned!==key.fingerprint)throw new Error("A participant's encryption identity changed. Verify it before continuing.")
        localStorage.setItem(cacheKey,key.fingerprint)
      }
      if(!controller.signal.aborted){setOwn(data.own);setKeys(data.keys);setLoaded(true);setError(null)}
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:"Encryption unavailable.")})
    return ()=>controller.abort()
  },[email,revision,messages])
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
          next[message.id]=await decryptMessage(message.encrypted_payload,identity!,email,author)
        }
        catch{if(!cancelled)setError("A message could not be authenticated or decrypted. Its contents were not shown.")}
      }
      if(!cancelled)setPlaintext(next)
    }
    void decrypt();return ()=>{cancelled=true}
  },[identity,email,messages,keys])
  /** @param passphrase - Browser-only recovery secret. @returns Promise<boolean> confirming setup or unlocking. */
  async function unlock(passphrase:string):Promise<boolean>{
    setBusy(true);setError(null)
    try{
      if(own){setIdentity(await recoverMessageIdentity(own.backup,passphrase,own))}
      else{
        const result=await createMessageIdentity(passphrase,email)
        const response=await fetch(apiPath("/api/messages/keys"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({publicKey:result.identity.publicKey,signingKey:result.identity.signingKey,fingerprint:result.identity.fingerprint,backup:result.backup})})
        if(!response.ok)throw new Error((await response.json()).error)
        setIdentity(result.identity)
      }
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
  return {own,keys,plaintext,error,busy,loaded,unlocked:!!identity,unlock,encrypt,lock:()=>{setIdentity(null);setPlaintext({})}}
}
