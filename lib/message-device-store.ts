/**
 * Keeps nonextractable messaging CryptoKeys in this browser's IndexedDB only.
 * Trusted-device records are account-scoped and never contain a passphrase.
 * Clearing site data or explicitly forgetting the device removes this access.
 */
import type { MessageIdentity } from "./message-crypto"
/**
 * Runs a native IndexedDB request and closes its connection after completion.
 * @param email - Authenticated account binding for the stored identity.
 * @param identity - Keys to save, null to forget, or undefined to read.
 * @returns Promise containing the locally stored identity when reading.
 */
async function deviceRecord(email:string,identity?:MessageIdentity|null):Promise<MessageIdentity|null>{
  if(typeof indexedDB==="undefined")throw new Error("Trusted-device storage is unavailable in this browser.")
  return new Promise((resolve,reject)=>{
    let blocked=false
    const opening=indexedDB.open("tanovo-message-devices",1)
    opening.onupgradeneeded=()=>opening.result.createObjectStore("identities")
    opening.onerror=()=>reject(new Error("Unable to open trusted-device storage."))
    opening.onblocked=()=>{blocked=true;reject(new Error("Trusted-device storage is blocked by another tab."))}
    opening.onsuccess=()=>{
      const db=opening.result
      if(blocked){db.close();return}
      const transaction=db.transaction("identities",identity===undefined?"readonly":"readwrite")
      const store=transaction.objectStore("identities"),key=email.toLowerCase()
      const request=identity===undefined?store.get(key):identity===null?store.delete(key):store.put(identity,key)
      let result:MessageIdentity|null=null
      request.onsuccess=()=>{result=identity===undefined?request.result??null:identity??null}
      transaction.oncomplete=()=>{db.close();resolve(result)}
      transaction.onabort=transaction.onerror=()=>{db.close();reject(new Error("Unable to use trusted-device storage."))}
    }
  })
}
/** @param email - Authenticated account email. @returns Locally remembered nonextractable keys, if present. */
export function loadDeviceIdentity(email:string){return deviceRecord(email)}
/** @param email - Authenticated account email. @param identity - Nonextractable private-key handles. @returns Promise<void> after durable browser storage. */
export async function rememberDeviceIdentity(email:string,identity:MessageIdentity):Promise<void>{
  if(identity.encryption.extractable||identity.signing.extractable)throw new Error("Extractable private keys cannot be remembered.")
  await deviceRecord(email,identity)
}
/** @param email - Account whose trusted-device access is being removed. @returns Promise<void> after deletion, without changing server identity. */
export async function forgetDeviceIdentity(email:string):Promise<void>{await deviceRecord(email,null)}
