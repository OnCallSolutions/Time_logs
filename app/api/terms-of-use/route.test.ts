import { beforeEach, expect, it, vi } from "vitest"

vi.mock("@/auth",()=>({auth:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/lib/terms-of-use",()=>({acceptCurrentTerms:vi.fn()}))

import { auth } from "@/auth"
import { getEffectiveUserRole } from "@/lib/access"
import { acceptCurrentTerms } from "@/lib/terms-of-use"
import { CURRENT_TERMS_VERSION } from "@/lib/terms-constants"
import { POST } from "./route"

beforeEach(()=>{
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({user:{email:"patron@example.com"}} as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue("employee" as never)
})

it("records acknowledgement for a signed-in approved patron",async()=>{
  const request=new Request("http://localhost/api/terms-of-use",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accepted:true,version:CURRENT_TERMS_VERSION})})
  const response=await POST(request)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({accepted:true,version:CURRENT_TERMS_VERSION})
  expect(acceptCurrentTerms).toHaveBeenCalledWith("patron@example.com",request)
})

it("rejects acknowledgements from unapproved patrons",async()=>{
  vi.mocked(getEffectiveUserRole).mockResolvedValue(null)
  const response=await POST(new Request("http://localhost/api/terms-of-use",{method:"POST",body:JSON.stringify({accepted:true,version:CURRENT_TERMS_VERSION})}))
  expect(response.status).toBe(401)
  expect(acceptCurrentTerms).not.toHaveBeenCalled()
})

it("rejects stale Terms of Use versions",async()=>{
  const response=await POST(new Request("http://localhost/api/terms-of-use",{method:"POST",body:JSON.stringify({accepted:true,version:"old-version"})}))
  expect(response.status).toBe(400)
  expect(acceptCurrentTerms).not.toHaveBeenCalled()
})
