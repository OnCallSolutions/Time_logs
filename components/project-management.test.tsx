import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { ProjectManagement } from "./project-management"

afterEach(() => vi.unstubAllGlobals())

it("stretches project management across a full-screen window when requested", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ projects: [], assignments: [], patrons: [] }))))
  const { container, rerender } = render(<ProjectManagement canManage canCreate fullWidth />)
  await screen.findByText("No projects yet. Create a project to begin logging time.")
  expect(screen.getByText("Assign projects across timesheet periods. Assignments stay active until changed or the project is archived.")).toBeVisible()
  expect(container.querySelector("section")).toHaveClass("w-full", "max-w-none")
  expect(container.querySelector("section")).not.toHaveClass("max-w-6xl")

  rerender(<ProjectManagement canManage canCreate />)
  expect(container.querySelector("section")).toHaveClass("mx-auto", "max-w-6xl")
})

it("shows the creator's assigned manager checked on a contractor-created project",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
    projects:[{id:"project-1",name:"Site repair",description:"",active:true,createdBy:"taylor@example.com"}],
    assignments:[{projectId:"project-1",email:"taylor@example.com"},{projectId:"project-1",email:"morgan@example.com"}],
    patrons:[{email:"taylor@example.com",displayName:"Taylor Contractor",role:"contractor"},{email:"morgan@example.com",displayName:"Morgan Manager",role:"manager"}],
  }))))
  render(<ProjectManagement canManage canCreate fullWidth/>)
  const project=await screen.findByRole("group",{name:"People assigned to Site repair"})
  expect(within(project).getByText(/Assigned manager/)).toBeVisible()
  const managerCheck=within(project).getByRole("checkbox",{name:/Morgan Manager.*Assigned manager/})
  expect(managerCheck).toBeChecked()
  expect(managerCheck).toBeDisabled()
  expect(within(project).getByRole("checkbox",{name:"Taylor Contractor"})).toBeChecked()
})

it("shows an immutable assignment and removal timeline to project managers",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
    projects:[{id:"project-1",name:"Site repair",description:"",active:true,createdBy:"taylor@example.com"}],
    assignments:[],
    assignmentHistory:[
      {id:"event-2",projectId:"project-1",projectName:"Site repair",email:"taylor@example.com",action:"removed",actorEmail:"morgan@example.com",occurredAt:"2026-10-18T15:00:00.000Z"},
      {id:"event-1",projectId:"project-1",projectName:"Site repair",email:"taylor@example.com",action:"assigned",actorEmail:"morgan@example.com",occurredAt:"2026-10-17T15:00:00.000Z"},
    ],
    patrons:[{email:"taylor@example.com",displayName:"Taylor Contractor",role:"contractor"}],
  }))))
  render(<ProjectManagement canManage fullWidth/>)
  await userEvent.click(await screen.findByText("Assignment history (2)"))
  const history=screen.getAllByRole("listitem")
  expect(history[0].textContent).toContain("taylor@example.com removed by morgan@example.com")
  expect(history[1].textContent).toContain("taylor@example.com assigned by morgan@example.com")
})
