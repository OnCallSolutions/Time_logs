import { afterEach, expect, it, vi } from "vitest"

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules()})

it("reuses the same error reference and sends diagnostics once for repeated failures",async()=>{
  const fetchMock=vi.fn(()=>Promise.resolve(Response.json({accepted:true})))
  vi.stubGlobal("fetch",fetchMock)
  const {reportClientFailure}=await import("./client-error-report")
  const error={operation:"entry.submit",route:"/api/entries/[id]",status:503,message:"Save failed for request 12345"}
  const first=reportClientFailure(error)
  const second=reportClientFailure(error)
  expect(second).toBe(first)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
