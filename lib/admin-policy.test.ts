// @vitest-environment node
/**
 * Exercises last-admin rejection at the database accessor boundary.
 * A mocked Neon driver verifies serializable isolation without a live database.
 * API tests separately cover conflicts and environment recovery administrators.
 */
import { afterAll,beforeAll,beforeEach,expect,it,vi } from "vitest"
import { LastAdministratorError } from "./admin-policy"
const driver=vi.hoisted(()=>({sql:Object.assign(vi.fn(async (_parts:TemplateStringsArray,..._values:unknown[])=>[]),{transaction:vi.fn<(queries:unknown[],options:unknown)=>Promise<unknown[][]>>()})}))
vi.mock("@neondatabase/serverless",()=>({neon:()=>driver.sql}))
let storage:typeof import("./db")
beforeAll(async()=>{vi.stubEnv("DATABASE_URL","postgresql://test:test@localhost/test");storage=await import("./db")})
afterAll(()=>vi.unstubAllEnvs())
beforeEach(()=>vi.clearAllMocks())
const assignment={email:"admin@example.com",role:"employee" as const,accessStatus:"active" as const,updatedBy:"admin@example.com"}
it("rejects a mutation when its guarded insert returns no administrator-safe row",async()=>{
  driver.sql.transaction.mockResolvedValue([[]])
  await expect(storage.upsertManagedAccessUser(assignment)).rejects.toBeInstanceOf(LastAdministratorError)
  expect(driver.sql.transaction).toHaveBeenCalledWith(expect.any(Array),{isolationLevel:"Serializable"})
})
it("checks remaining active administrators inside the serialized write",async()=>{
  driver.sql.transaction.mockResolvedValue([[{email:assignment.email,role:"employee",access_status:"active",note:"",permissions:{},updated_by:assignment.updatedBy,created_at:"2026-10-08T12:00:00Z",updated_at:"2026-10-08T12:00:00Z"}]])
  await storage.upsertManagedAccessUser({...assignment,environmentAdmins:["recovery@example.com"]})
  const query=driver.sql.mock.calls.find(([parts])=>parts.join("").includes("INSERT INTO managed_user_access"))!
  expect(query[0].join("")).toContain("WHERE role = 'admin' AND access_status = 'active'")
  expect(query.slice(1)).toContain(true)
})
it("propagates concurrent serialization conflicts instead of retrying unsafe writes",async()=>{
  const conflict=Object.assign(new Error("serialization"),{code:"40001"})
  driver.sql.transaction.mockRejectedValue(conflict)
  await expect(storage.upsertManagedAccessUser(assignment)).rejects.toBe(conflict)
})
