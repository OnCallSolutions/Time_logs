import {expect,it} from "vitest"
import {readJsonLimited,RequestBodyTooLargeError} from "./read-json-limited"

it("rejects oversized streamed JSON without trusting Content-Length",async()=>{
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"value":"too large"}'));controller.close()}})
  const request={headers:new Headers(),body} as Request
  await expect(readJsonLimited(request,8)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
})

it("parses a JSON stream at or below the configured byte limit",async()=>{
  const payload='{"ok":true}'
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(payload));controller.close()}})
  const request={headers:new Headers(),body} as Request
  await expect(readJsonLimited(request,new TextEncoder().encode(payload).byteLength)).resolves.toEqual({ok:true})
})
