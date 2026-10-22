import { render,screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { ManagerRejectionArchive } from "./manager-rejection-archive"

afterEach(()=>vi.unstubAllGlobals())

it("loads a manager's rejection history and lets them search and sort it",async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({rejections:[
    {id:"two",actorEmail:"manager@example.com",entryId:"e2",contractor:"Mina Patel",ownerEmail:"mina@example.com",project:"North build",workDate:"2026-10-12",hours:4,reason:"Missing work notes",rejectedAt:"2026-10-13T10:00:00.000Z"},
    {id:"one",actorEmail:"manager@example.com",entryId:"e1",contractor:"Alex Chen",ownerEmail:"alex@example.com",project:"West audit",workDate:"2026-10-10",hours:2,reason:"Confirm the dates",rejectedAt:"2026-10-11T10:00:00.000Z"},
  ]})))
  vi.stubGlobal("fetch",fetch)
  render(<ManagerRejectionArchive/>)
  await userEvent.click(screen.getByRole("button",{name:"Rejection archive"}))
  expect(await screen.findByText("Missing work notes")).toBeVisible()
  expect(screen.getByText(/Patron · Alex Chen/)).toBeVisible()
  await userEvent.type(screen.getByRole("textbox",{name:"Search rejections"}),"West audit")
  expect(screen.getByText("Alex Chen")).toBeVisible()
  expect(screen.queryByText("Mina Patel")).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole("combobox",{name:"Sort rejections"}),"person")
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/entries/rejections"),{cache:"no-store"})
})
