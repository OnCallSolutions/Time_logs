import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/db",()=>({listAuditEventPage:vi.fn()}))
import {auth} from "@/auth"
import {getEffectiveUserRole} from "@/lib/access"
import {listAuditEventPage} from "@/lib/db"
import {GET} from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  vi.mocked(listAuditEventPage).mockResolvedValue({events:[],nextCursor:null} as never)
})

it("serves bounded, uncached admin audit pages and forwards a validated keyset cursor",async()=>{
  const response=await GET(new Request("http://localhost/api/audit?limit=250&beforeAt=2026-10-17T12%3A00%3A00.000Z&beforeId=123e4567-e89b-42d3-a456-426614174000"))
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(listAuditEventPage).toHaveBeenCalledWith({limit:250,beforeAt:"2026-10-17T12:00:00.000Z",beforeId:"123e4567-e89b-42d3-a456-426614174000"})
})

it("rejects non-admins and malformed cursors",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  expect((await GET(new Request("http://localhost/api/audit"))).status).toBe(403)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  expect((await GET(new Request("http://localhost/api/audit?beforeAt=not-a-date&beforeId=bad"))).status).toBe(400)
  expect(listAuditEventPage).not.toHaveBeenCalled()
})
