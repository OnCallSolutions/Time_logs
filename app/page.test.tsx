/**
 * Checks that the authentication redesign preserves Microsoft provider behavior.
 * Server sessions and provider calls are mocked to avoid live account actions.
 */
import {beforeEach,expect,it,vi} from "vitest"
vi.mock("@/auth",()=>({auth:vi.fn(),signIn:vi.fn()}))
vi.mock("@/lib/access",()=>({getEffectiveUserRole:vi.fn()}))
vi.mock("@/components/timesheet-app",()=>({TimesheetApp:()=>null}))
import {auth,signIn} from "@/auth"
import {getEffectiveUserRole} from "@/lib/access"
import {AuthScreen} from "@/components/auth-screen"
import Page from "./page"
beforeEach(()=>vi.resetAllMocks())
it("retains the Microsoft provider and forced sign-in parameters",async()=>{
  vi.mocked(auth).mockResolvedValue(null as never)
  const page=await Page()
  expect(page.type).toBe(AuthScreen)
  const action=(page.props as {action:()=>Promise<void>}).action
  await action()
  expect(signIn).toHaveBeenCalledWith("microsoft-entra-id",undefined,{max_age:"0",prompt:"login"})
})
it("shows the unapproved account without starting another sign-in",async()=>{
  vi.mocked(auth).mockResolvedValue({user:{email:"employee@example.com"}} as never)
  vi.mocked(getEffectiveUserRole).mockResolvedValue(null)
  const page=await Page()
  expect(page.type).toBe(AuthScreen)
  expect(page.props).toMatchObject({email:"employee@example.com"})
  expect(signIn).not.toHaveBeenCalled()
})
