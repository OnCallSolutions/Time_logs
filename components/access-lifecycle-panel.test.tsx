/**
 * Verifies explicit confirmation and admin-only lifecycle controls.
 * Datetimes and roster data are synthetic; no real account state is changed.
 */
import { render,screen,waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { AccessLifecyclePanel } from "./access-lifecycle-panel"
import { resolvePermissions } from "@/lib/permissions"
afterEach(()=>vi.unstubAllGlobals())
/** @returns Fetch spy serving fixtures and accepting explicit mutations. */
function requests(){
  const request=vi.fn(async(url:string,options?:RequestInit)=>new Response(JSON.stringify(options?.method==="POST"?{ok:true}:url.includes("access-lifecycle")?{schedules:[],assignments:[]}:{users:[{email:"staff@example.com",role:"employee",accessStatus:"active"}]})))
  vi.stubGlobal("fetch",request);return request
}
it("does not save a cutoff before the reason and explicit confirmation",async()=>{
  const request=requests();render(<AccessLifecyclePanel admin permissions={resolvePermissions("admin")}/>);const user=userEvent.setup()
  await screen.findByRole("option",{name:"staff@example.com (employee, active)"})
  await user.selectOptions(screen.getByRole("combobox",{name:"Account"}),"staff@example.com")
  await user.click(screen.getByRole("button",{name:"Schedule deactivation"}))
  expect(request.mock.calls.some(call=>call[1]?.method==="POST")).toBe(false)
  await user.type(screen.getByLabelText("Access cutoff (local time)"),"2099-01-01T12:00")
  await user.type(screen.getByRole("textbox",{name:"Reason"}),"Contract ending")
  await user.click(screen.getByRole("button",{name:"Confirm and save"}))
  await waitFor(()=>expect(request).toHaveBeenCalledWith("/tanovo-time/api/access-lifecycle",expect.objectContaining({method:"POST",body:expect.stringContaining('"action":"schedule_cutoff"')})))
})
it("keeps suspension and reactivation controls out of manager coverage",async()=>{
  requests();render(<AccessLifecyclePanel admin={false} permissions={resolvePermissions("manager")}/>)
  await screen.findByRole("option",{name:"staff@example.com (employee, active)"})
  expect(screen.queryByRole("button",{name:"Suspend"})).not.toBeInTheDocument()
  expect(screen.queryByRole("button",{name:"Reactivate"})).not.toBeInTheDocument()
  expect(screen.getByRole("button",{name:"Temporary assignment"})).toBeVisible()
})
