export class RequestBodyTooLargeError extends Error {
  constructor(){
    super("Request body exceeds the configured size limit.")
    this.name="RequestBodyTooLargeError"
  }
}

/** Reads JSON while enforcing a byte cap on the actual stream, not just its headers. */
export async function readJsonLimited(request:Request,maxBytes:number):Promise<unknown>{
  const declaredLength=request.headers.get("content-length")
  if(declaredLength&&/^\d+$/.test(declaredLength)&&Number(declaredLength)>maxBytes)throw new RequestBodyTooLargeError()
  const reader=request.body?.getReader()
  if(!reader)return JSON.parse("") as unknown
  const chunks:Uint8Array[]=[]
  let size=0
  while(true){
    const {done,value}=await reader.read()
    if(done)break
    size+=value.byteLength
    if(size>maxBytes){
      void reader.cancel().catch(()=>undefined)
      throw new RequestBodyTooLargeError()
    }
    chunks.push(value)
  }
  const bytes=new Uint8Array(size)
  let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}
