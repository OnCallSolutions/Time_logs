/**
 * Implements browser-side message encryption and passphrase-protected recovery.
 * Web Crypto provides AES-GCM, RSA-OAEP, ECDSA, and PBKDF2 primitives; private
 * keys and recovery passphrases are never included in requests to the server.
 */
export type PublicMessageKey = { email:string; publicKey:string; signingKey:string; fingerprint:string; deviceId?:string }
export type KeyBackup = { salt:string; nonce:string; ciphertext:string; iterations:number }
export type MessageIdentity = { encryption:CryptoKey; signing:CryptoKey; publicKey:string; signingKey:string; fingerprint:string;deviceId?:string }
export type EncryptedMessage = { version:1|2; nonce:string; ciphertext:string; sender:string; recipient:string|null; token:string;
  keys:Record<string,{wrapped:string;fingerprint:string;devices?:Record<string,string>}>; author:string; signature:string;authorFingerprint?:string }
const encoder = new TextEncoder()

/**
 * Converts binary key material or ciphertext into JSON-safe transport encoding.
 * @param value - Binary bytes, never a plaintext recovery passphrase.
 * @returns string containing Base64-encoded data.
 */
function encode(value:ArrayBuffer|Uint8Array):string { return btoa(String.fromCharCode(...new Uint8Array(value instanceof Uint8Array?value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength):value))) }
/**
 * Decodes transport data into an owned buffer accepted by Web Crypto operations.
 * @param value - Base64 transport string.
 * @returns Uint8Array<ArrayBuffer> containing decoded bytes.
 */
function decode(value:string):Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value),char=>char.charCodeAt(0)) }
/**
 * Fingerprints both public keys so recipient verification covers the full identity.
 * @param publicKey - Base64 public encryption key.
 * @param signingKey - Base64 public signing key.
 * @returns Promise<string> containing a SHA-256 hexadecimal fingerprint.
 */
export async function identityFingerprint(publicKey:string,signingKey:string):Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(`${publicKey}:${signingKey}`))),byte=>byte.toString(16).padStart(2,"0")).join("")
}
/**
 * Derives an authenticated-backup encryption key without exposing the passphrase.
 * @param passphrase - Browser-only recovery secret.
 * @param salt - Random KDF salt stored alongside the encrypted backup.
 * @returns Promise<CryptoKey> containing a nonextractable AES-GCM key.
 */
async function recoveryKey(passphrase:string,salt:Uint8Array<ArrayBuffer>):Promise<CryptoKey> {
  const material=await crypto.subtle.importKey("raw",encoder.encode(passphrase),"PBKDF2",false,["deriveKey"])
  return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations:600000},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])
}
/**
 * Generates browser-owned messaging keys automatically without a recovery secret.
 * Private keys never become extractable and never leave the device's storage.
 * @returns New device identity suitable for authenticated public-key registration.
 */
export async function createDeviceIdentity():Promise<MessageIdentity>{
  const encryption=await crypto.subtle.generateKey({name:"RSA-OAEP",modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},false,["encrypt","decrypt","wrapKey","unwrapKey"])
  const signing=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"])
  const publicKey=encode(await crypto.subtle.exportKey("spki",encryption.publicKey)),signingKey=encode(await crypto.subtle.exportKey("spki",signing.publicKey))
  return {encryption:encryption.privateKey,signing:signing.privateKey,publicKey,signingKey,fingerprint:await identityFingerprint(publicKey,signingKey),deviceId:crypto.randomUUID()}
}
/**
 * Creates independent encryption/signing keys and protects their recovery backup.
 * The returned private keys are nonextractable; only the backup reaches storage.
 * @param passphrase - Strong recovery passphrase kept exclusively in the browser.
 * @param email - Account binding authenticated with the backup ciphertext.
 * @returns Promise containing a MessageIdentity and encrypted KeyBackup.
 */
export async function createMessageIdentity(passphrase:string,email:string):Promise<{identity:MessageIdentity;backup:KeyBackup}> {
  if(passphrase.trim().length<16)throw new Error("Use a recovery passphrase of at least 16 non-padding characters.")
  const encryption=await crypto.subtle.generateKey({name:"RSA-OAEP",modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["encrypt","decrypt"])
  const signing=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"])
  const publicKey=encode(await crypto.subtle.exportKey("spki",encryption.publicKey))
  const signingKey=encode(await crypto.subtle.exportKey("spki",signing.publicKey))
  const rawEncryption=await crypto.subtle.exportKey("pkcs8",encryption.privateKey)
  const rawSigning=await crypto.subtle.exportKey("pkcs8",signing.privateKey)
  const salt=crypto.getRandomValues(new Uint8Array(16));const nonce=crypto.getRandomValues(new Uint8Array(12))
  const key=await recoveryKey(passphrase,salt)
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,additionalData:encoder.encode(email.toLowerCase())},key,encoder.encode(JSON.stringify({encryption:encode(rawEncryption),signing:encode(rawSigning)})))
  const identity={encryption:await crypto.subtle.importKey("pkcs8",rawEncryption,{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt","unwrapKey"]),signing:await crypto.subtle.importKey("pkcs8",rawSigning,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]),publicKey,signingKey,fingerprint:await identityFingerprint(publicKey,signingKey)}
  return {identity,backup:{salt:encode(salt),nonce:encode(nonce),ciphertext:encode(ciphertext),iterations:600000}}
}
/**
 * Recovers a private identity and verifies it against both published public keys.
 * Incorrect passphrases, swapped accounts, or mismatched identities fail closed.
 * @param backup - Encrypted server backup.
 * @param passphrase - Browser-only recovery secret.
 * @param account - Expected account public identity.
 * @returns Promise<MessageIdentity> containing recovered nonextractable keys.
 */
export async function recoverMessageIdentity(backup:KeyBackup,passphrase:string,account:PublicMessageKey):Promise<MessageIdentity> {
  if(backup.iterations!==600000)throw new Error("Unsupported recovery format.")
  const key=await recoveryKey(passphrase,decode(backup.salt))
  const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(backup.nonce),additionalData:encoder.encode(account.email.toLowerCase())},key,decode(backup.ciphertext))
  const raw=JSON.parse(new TextDecoder().decode(plaintext))
  const encryption=await crypto.subtle.importKey("pkcs8",decode(raw.encryption),{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt","unwrapKey"])
  const signing=await crypto.subtle.importKey("pkcs8",decode(raw.signing),{name:"ECDSA",namedCurve:"P-256"},false,["sign"])
  // Bind recovery to the published identity before accepting a backup.
  const probe=crypto.getRandomValues(new Uint8Array(32))
  const publicEncryption=await crypto.subtle.importKey("spki",decode(account.publicKey),{name:"RSA-OAEP",hash:"SHA-256"},false,["encrypt"])
  const recovered=await crypto.subtle.decrypt("RSA-OAEP",encryption,await crypto.subtle.encrypt("RSA-OAEP",publicEncryption,probe))
  if(encode(recovered)!==encode(probe))throw new Error("Recovery identity mismatch.")
  const publicSigning=await crypto.subtle.importKey("spki",decode(account.signingKey),{name:"ECDSA",namedCurve:"P-256"},false,["verify"])
  if(!await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},publicSigning,await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},signing,probe),probe))throw new Error("Recovery identity mismatch.")
  return {encryption,signing,publicKey:account.publicKey,signingKey:account.signingKey,fingerprint:await identityFingerprint(account.publicKey,account.signingKey)}
}
/**
 * Canonicalizes the content and conversation context authenticated by signatures.
 * Recipient key fingerprints are independently validated at the API boundary.
 * @param payload - Envelope metadata and ciphertext, without its signature.
 * @returns Uint8Array<ArrayBuffer> containing deterministic signature input.
 */
function signedBytes(payload:Omit<EncryptedMessage,"signature">):Uint8Array<ArrayBuffer> {
  const values:unknown[]=[payload.version,payload.nonce,payload.ciphertext,payload.sender,payload.recipient,payload.token,payload.author]
  if(payload.version===2)values.push(payload.authorFingerprint,Object.keys(payload.keys).sort().map(email=>[email,payload.keys[email].fingerprint,payload.keys[email].wrapped,Object.entries(payload.keys[email].devices??{}).sort(([a],[b])=>a<b?-1:a>b?1:0)]))
  return Uint8Array.from(encoder.encode(JSON.stringify(values)))
}
/**
 * Encrypts content with a fresh AES key and signs the encrypted message context.
 * Every participant receives a separately wrapped copy of that content key.
 * @param text - Plaintext message retained only in browser memory.
 * @param identity - Unlocked author encryption/signing identity.
 * @param author - Current actor email, including an authorized admin editor.
 * @param sender - Original sender email.
 * @param recipient - Private recipient email, or null for a broadcast.
 * @param participants - Public identities authorized to receive the ciphertext.
 * @returns Promise<EncryptedMessage> containing signed ciphertext and key envelopes.
 */
export async function encryptMessage(text:string,identity:MessageIdentity,author:string,sender:string,recipient:string|null,participants:PublicMessageKey[],multiDevice=false):Promise<EncryptedMessage> {
  const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},true,["encrypt","decrypt"])
  const nonce=crypto.getRandomValues(new Uint8Array(12));const token=crypto.randomUUID()
  const context=encoder.encode(JSON.stringify([sender,recipient,token,author]))
  const ciphertext=encode(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,additionalData:context},key,encoder.encode(text)))
  const keys:EncryptedMessage["keys"]={}
  for(const participant of [...new Map(participants.map(key=>[`${key.email.toLowerCase()}:${key.fingerprint}`,key])).values()]){
    const publicKey=await crypto.subtle.importKey("spki",decode(participant.publicKey),{name:"RSA-OAEP",hash:"SHA-256"},false,["wrapKey"])
    const email=participant.email.toLowerCase(),wrapped=encode(await crypto.subtle.wrapKey("raw",key,publicKey,"RSA-OAEP"))
    if(multiDevice){
      const existing=keys[email]
      if(existing)existing.devices![participant.fingerprint]=wrapped
      else keys[email]={wrapped,fingerprint:participant.fingerprint,devices:{[participant.fingerprint]:wrapped}}
    }else keys[email]={wrapped,fingerprint:participant.fingerprint}
  }
  const payload={version:multiDevice?2 as const:1 as const,nonce:encode(nonce),ciphertext,sender,recipient,token,keys,author,...(multiDevice?{authorFingerprint:identity.fingerprint}:{})}
  return {...payload,signature:encode(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},identity.signing,signedBytes(payload)))}
}
/**
 * Verifies the author signature before unwrapping and decrypting message content.
 * Missing recipient envelopes or modified ciphertext never produce plaintext.
 * @param payload - Signed encrypted message received from the scoped inbox.
 * @param identity - Unlocked recipient identity.
 * @param email - Recipient email identifying its wrapped content-key envelope.
 * @param author - Published author signing identity.
 * @returns Promise<string> containing authenticated plaintext; rejects on failure.
 */
export async function decryptMessage(payload:EncryptedMessage,identity:MessageIdentity,email:string,author:PublicMessageKey):Promise<string> {
  const envelope=payload.keys[email.toLowerCase()]
  const wrapped=payload.version===2?envelope?.devices?.[identity.fingerprint]:envelope?.fingerprint===identity.fingerprint?envelope.wrapped:undefined
  if(!wrapped)throw new Error("This identity cannot decrypt this message.")
  if(payload.version===2&&payload.authorFingerprint!==author.fingerprint)throw new Error("Author identity mismatch.")
  const verifyKey=await crypto.subtle.importKey("spki",decode(author.signingKey),{name:"ECDSA",namedCurve:"P-256"},false,["verify"])
  if(!await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},verifyKey,decode(payload.signature),signedBytes(payload)))throw new Error("Message signature could not be verified.")
  const key=await crypto.subtle.unwrapKey("raw",decode(wrapped),identity.encryption,"RSA-OAEP",{name:"AES-GCM",length:256},false,["decrypt"])
  const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(payload.nonce),additionalData:encoder.encode(JSON.stringify([payload.sender,payload.recipient,payload.token,payload.author]))},key,decode(payload.ciphertext))
  return new TextDecoder().decode(bytes)
}
