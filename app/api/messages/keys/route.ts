/**
 * Registers immutable public messaging identities and returns encrypted backups.
 * Recovery passphrases and unencrypted private keys are never accepted here.
 * Public lookup is limited to the current roster and visible conversation peers.
 */
import { auth } from "@/auth"
import { getEffectivePermissions } from "@/lib/effective-permissions"
import { actorRoster,listMessages } from "@/lib/collaboration"
import { ownMessageKey,publicMessageKeys,registerMessageKey } from "@/lib/message-keys"
import { z } from "zod"
import { createHash,createPublicKey } from "node:crypto"
import { recordAuditEvent } from "@/lib/db"
import { getAuditContext } from "@/lib/audit"
const base64=z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)
const schema=z.object({publicKey:base64.max(2048),signingKey:base64.max(1024),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),backup:z.object({salt:base64.length(24),nonce:base64.length(16),ciphertext:base64.min(100).max(12000),iterations:z.literal(600000)})}).strict()
/** @returns Authenticated own encrypted backup and scoped public-key directory. */
export async function GET():Promise<Response>{
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Forbidden."},{status:403})
    const messages=await listMessages(email,access.role==="employee"||access.role==="contractor")
    const peers=messages.flatMap(message=>[message.sender_email,message.recipient_email,...Object.keys(message.encrypted_payload?.keys??{}),message.encrypted_payload?.author]).filter((value):value is string=>typeof value==="string")
    const roster=(access.role==="admin"||access.role==="manager")&&access.permissions.send_messages?(await actorRoster()).filter(user=>user.accessStatus==="active"):[]
    return Response.json({own:await ownMessageKey(email),keys:await publicMessageKeys([...new Set([email,...peers,...roster.map(user=>user.email)])])},{headers:{"Cache-Control":"no-store"}})
  }catch{return Response.json({error:"Encryption keys unavailable."},{status:500})}
}
/** @param req - Public keys and an already encrypted recovery backup. @returns First-time registration result or safe validation failure. */
export async function POST(req:Request):Promise<Response>{
  try{
    const email=(await auth())?.user?.email;const access=await getEffectivePermissions(email)
    if(!email||!access.role)return Response.json({error:"Forbidden."},{status:403})
    const input=schema.parse(await req.json())
    const encryption=createPublicKey({key:Buffer.from(input.publicKey,"base64"),format:"der",type:"spki"})
    const signing=createPublicKey({key:Buffer.from(input.signingKey,"base64"),format:"der",type:"spki"})
    if(encryption.asymmetricKeyType!=="rsa"||encryption.asymmetricKeyDetails?.modulusLength!==3072||signing.asymmetricKeyType!=="ec"||signing.asymmetricKeyDetails?.namedCurve!=="prime256v1"||createHash("sha256").update(`${input.publicKey}:${input.signingKey}`).digest("hex")!==input.fingerprint)return Response.json({error:"Invalid public identity."},{status:400})
    if(!await registerMessageKey(email,input))return Response.json({error:"Encryption is already set up. Unlock with your recovery passphrase."},{status:409})
    await recordAuditEvent({actorEmail:email,action:"message_encryption_initialized",targetType:"user",targetId:email.toLowerCase(),metadata:{fingerprint:input.fingerprint},...getAuditContext(req)})
    return Response.json({ok:true},{status:201})
  }catch(error){return Response.json({error:error instanceof z.ZodError||error instanceof SyntaxError?"Invalid encryption setup.":"Encryption setup failed."},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:500})}
}
