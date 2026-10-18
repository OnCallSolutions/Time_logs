import {afterEach,expect,it,vi} from "vitest"
import {reportClientFailure} from "./client-error-report"

afterEach(()=>vi.unstubAllGlobals())

it("redacts credentials and personal data before sending client failure reports",()=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status:202}))
  vi.stubGlobal("fetch",fetchMock)
  reportClientFailure({reference:"e4b21455-ca7d-468c-aee9-3b6a9d3767ea",operation:"entry.save",route:"/api/entries",message:"Save failed for person@example.com; Bearer abc.def; access_token=secret-value"})
  const body=JSON.parse(fetchMock.mock.calls[0][1].body as string)
  expect(body.message).toContain("[redacted email]")
  expect(body.message).toContain("Bearer [redacted]")
  expect(body.message).toContain("access_token=[redacted]")
  expect(body.message).not.toContain("person@example.com")
  expect(body.message).not.toContain("secret-value")
})
