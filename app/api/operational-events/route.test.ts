import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/access", () => ({ getEffectiveUserRole: vi.fn() }))
vi.mock("@/lib/operational-events", () => ({ listOperationalEventPage: vi.fn() }))
import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { listOperationalEventPage } from "@/lib/operational-events"
import { GET } from "./route"

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { email: "admin@example.com" } } as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  vi.mocked(listOperationalEventPage).mockResolvedValue({events:[],nextCursor:null})
})

it("returns uncached admin event pages and passes bounded filters", async () => {
  const response = await GET(new Request("http://localhost/api/operational-events?from=2026-10-01&through=2026-10-19&category=client_error&search=entry.submit&actor=admin%40example.com&route=%2Fapi%2Fentries&method=PATCH&status=503&limit=900"))
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(listOperationalEventPage).toHaveBeenCalledWith({ limit: 250, from: "2026-10-01", through: "2026-10-19", category: "client_error", search: "entry.submit",actor:"admin@example.com",route:"/api/entries",method:"PATCH",status:503,beforeAt:undefined,beforeId:undefined })
})

it("restricts reads to admins and rejects invalid date windows", async () => {
  vi.mocked(getEffectiveUserRole).mockResolvedValue("manager")
  expect((await GET(new Request("http://localhost/api/operational-events"))).status).toBe(403)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("admin")
  expect((await GET(new Request("http://localhost/api/operational-events?from=2026-10-20&through=2026-10-19"))).status).toBe(400)
  expect((await GET(new Request("http://localhost/api/operational-events?from=2026-02-30"))).status).toBe(400)
  expect(listOperationalEventPage).not.toHaveBeenCalled()
})
