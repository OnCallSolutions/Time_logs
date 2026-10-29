import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/db",()=>({listAuditEventPage:vi.fn(),listAuditEventsByCorrelation:vi.fn()}))
vi.mock("@/lib/operational-events",()=>({listOperationalEventsByCorrelation:vi.fn()}))
import {auth} from "@/auth"
import {getEffectiveUserRole} from "@/lib/access"
import {listAuditEventPage,listAuditEventsByCorrelation} from "@/lib/db"
import {listOperationalEventsByCorrelation} from "@/lib/operational-events"
import {GET} from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"admin@example.com"}} as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  vi.mocked(listAuditEventPage).mockResolvedValue({events:[],nextCursor:null} as never)
  vi.mocked(listAuditEventsByCorrelation).mockResolvedValue([] as never)
  vi.mocked(listOperationalEventsByCorrelation).mockResolvedValue([])
})

it("includes correlated operational diagnostics with audit history",async()=>{
  vi.mocked(listOperationalEventsByCorrelation).mockResolvedValue([{id:"op-1",correlationId:"123e4567-e89b-42d3-a456-426614174000",actorEmail:"admin@example.com",category:"client_error",operation:"entry.submit",route:"/api/entries/[id]",method:"PATCH",httpStatus:503,errorCode:"42P18",message:"save failed",requestId:"req-1",occurredAt:"2026-10-17T12:00:00.000Z"}])
  const response=await GET(new Request("http://localhost/api/audit?correlationId=123e4567-e89b-42d3-a456-426614174000"))
  const data=await response.json()
  expect(listOperationalEventsByCorrelation).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174000")
  expect(data.events).toContainEqual(expect.objectContaining({action:"operational_failure",targetType:"client_error",metadata:expect.objectContaining({httpStatus:503,errorCode:"42P18"})}))
})

it("serves bounded, uncached admin audit pages and forwards a validated keyset cursor",async()=>{
  const response=await GET(new Request("http://localhost/api/audit?limit=250&beforeAt=2026-10-17T12%3A00%3A00.000Z&beforeId=123e4567-e89b-42d3-a456-426614174000&from=2026-10-01&through=2026-10-19&search=deadline&targetType=timesheet_period&scope=periods"))
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(listAuditEventPage).toHaveBeenCalledWith({limit:250,beforeAt:"2026-10-17T12:00:00.000Z",beforeId:"123e4567-e89b-42d3-a456-426614174000",from:"2026-10-01",through:"2026-10-19",search:"deadline",actor:undefined,action:undefined,targetType:"timesheet_period",scope:"periods"})
})

it("rejects non-admins and malformed cursors",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  expect((await GET(new Request("http://localhost/api/audit"))).status).toBe(403)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  expect((await GET(new Request("http://localhost/api/audit?beforeAt=not-a-date&beforeId=bad"))).status).toBe(400)
  expect(listAuditEventPage).not.toHaveBeenCalled()
})
