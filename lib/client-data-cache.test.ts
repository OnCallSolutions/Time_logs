/**
 * Tests scoped, short-lived memory reads without persisting application data.
 * Cases cover concurrent reuse, account isolation, invalidation, and failures.
 */
import { afterEach,expect,it,vi } from "vitest"
import { readClientData,invalidateClientData } from "./client-data-cache"
afterEach(()=>{invalidateClientData();vi.unstubAllGlobals()})
it("deduplicates concurrent reads and separates accounts",async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({value:1})));vi.stubGlobal("fetch",fetch)
  const first=readClientData("/api/profile","one@example.com",1000),second=readClientData("/api/profile","one@example.com",1000)
  expect(first).toBe(second);await first
  await readClientData("/api/profile","two@example.com",1000);expect(fetch).toHaveBeenCalledTimes(2)
})
it("revalidates after explicit invalidation",async()=>{
  const fetch=vi.fn(async()=>new Response("{}"));vi.stubGlobal("fetch",fetch)
  await readClientData("/api/profile","one",1000);invalidateClientData("one","/api/profile")
  await readClientData("/api/profile","one",1000);expect(fetch).toHaveBeenCalledTimes(2)
})
it("does not retain failed authorization responses",async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({error:"Forbidden"}),{status:403}));vi.stubGlobal("fetch",fetch)
  await expect(readClientData("/api/profile","one",1000)).rejects.toThrow("Forbidden")
  await expect(readClientData("/api/profile","one",1000)).rejects.toThrow("Forbidden")
  expect(fetch).toHaveBeenCalledTimes(2)
})
