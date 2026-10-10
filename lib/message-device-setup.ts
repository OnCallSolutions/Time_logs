/**
 * Automatically enrolls browser-generated public messaging keys after sign-in.
 * Private CryptoKeys stay in IndexedDB and are never exported or sent in requests.
 * Concurrent mounts share one setup task to avoid creating duplicate devices.
 */
import { apiPath } from "./paths"
import { createDeviceIdentity,type MessageIdentity,type PublicMessageKey } from "./message-crypto"
import { loadDeviceIdentity,rememberDeviceIdentity } from "./message-device-store"
const setups=new Map<string,Promise<MessageIdentity>>()
/**
 * Restores or creates a device identity and authenticates its public enrollment.
 * @param email - Signed-in account, verified again by the registration API.
 * @param directory - Authorized public identities returned by the server.
 * @returns Promise<MessageIdentity> after matching restoration or enrollment.
 */
export function automaticMessageIdentity(email:string,directory:PublicMessageKey[]):Promise<MessageIdentity>{
  const owner=email.toLowerCase(),pending=setups.get(owner)
  if(pending)return pending
  const task=(async()=>{
    let identity=await loadDeviceIdentity(owner)
    if(identity){
      if(identity.encryption.extractable||identity.signing.extractable)throw new Error("Unsafe stored private keys.")
      const published=directory.find(key=>key.email.toLowerCase()===owner&&key.fingerprint===identity!.fingerprint)
      if(published){if(published.publicKey!==identity.publicKey||published.signingKey!==identity.signingKey)throw new Error("Stored identity mismatch.");return identity}
      if(!identity.deviceId){
        if(directory.some(key=>key.email.toLowerCase()===owner))throw new Error("Trusted-device identity changed or is unavailable. It was not replaced.")
        identity={...identity,deviceId:crypto.randomUUID()}
        await rememberDeviceIdentity(owner,identity)
      }
    }else{
      identity=await createDeviceIdentity()
      await rememberDeviceIdentity(owner,identity)
    }
    const response=await fetch(apiPath("/api/messages/keys"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deviceId:identity.deviceId,publicKey:identity.publicKey,signingKey:identity.signingKey,fingerprint:identity.fingerprint})})
    if(!response.ok)throw new Error((await response.json()).error||"Unable to connect secure messaging.")
    return identity
  })()
  setups.set(owner,task)
  void task.finally(()=>{if(setups.get(owner)===task)setups.delete(owner)}).catch(()=>{})
  return task
}
