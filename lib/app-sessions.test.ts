/**
 * Checks session persistence does not mistake polling for interactive activity.
 * SQL gates prevent revoked, idle-expired or absolutely expired sessions reviving.
 * All records/keys are synthetic; no live sign-in session is created here.
 */
import {beforeEach,expect,it,vi} from "vitest"
const {queries,result}=vi.hoisted(()=>({queries:[] as {text:string;values:unknown[]}[],result:{rows:[] as Record<string,unknown>[]}}))
vi.mock("@neondatabase/serverless",()=>({neon:()=>async(strings:TemplateStringsArray,...values:unknown[])=>{
  const text=strings.join("?");queries.push({text,values});return text.includes('AS "expiresAt"')?result.rows:[]
}}))
import {createAppSession,readAppSession,revokeAppSession} from "./app-sessions"
const id="00000000-0000-4000-8000-000000000000"
beforeEach(()=>{queries.length=0;result.rows=[{expiresAt:"2026-10-16T12:30:00Z",absoluteExpiresAt:"2026-10-16T20:00:00Z"}]})
it("reads an existing session without updating activity or creating replacements",async()=>{
  expect(await readAppSession(id,"Person@EXAMPLE.COM")).toBeTruthy()
  const reads=queries.filter(query=>query.text.includes('AS "expiresAt"'))
  expect(reads).toHaveLength(1);expect(reads[0].text.trim()).toMatch(/^SELECT/)
  expect(reads[0].values).toContain("person@example.com")
  expect(reads[0].text).toContain("revoked_at IS NULL")
})
it("touches only a still-live session using both hard and idle limits",async()=>{
  await readAppSession(id,"person@example.com",true)
  const touch=queries.find(query=>query.text.includes("SET last_activity_at=now()"))!
  expect(touch.text).toContain("created_at>now()")
  expect(touch.text).toContain("last_activity_at>now()")
  expect(touch.values).toContain(8*3600);expect(touch.values).toContain(30*60)
  result.rows=[];expect(await readAppSession(id,"person@example.com",true)).toBeNull()
})
it("binds created sessions to normalized identity and revokes the exact ID",async()=>{
  expect(await createAppSession(" Person@EXAMPLE.com ")).toMatch(/^[a-f0-9-]{36}$/)
  expect(queries.find(query=>query.text.includes("INSERT INTO app_signin_sessions"))?.values).toContain("person@example.com")
  await revokeAppSession(id)
  expect(queries.at(-1)?.text).toContain("SET revoked_at=COALESCE")
  expect(queries.at(-1)?.values).toEqual([id])
})
