import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { ProjectManagement } from "./project-management"

afterEach(() => vi.unstubAllGlobals())

it("stretches project management across a full-screen window when requested", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ projects: [], assignments: [], patrons: [] }))))
  const { container, rerender } = render(<ProjectManagement canManage canCreate fullWidth />)
  await screen.findByText("No projects yet. Create a project to begin logging time.")
  expect(screen.getByText("Manage projects and assignments for your own team.")).toBeVisible()
  expect(container.querySelector("section")).toHaveClass("w-full", "max-w-none")
  expect(container.querySelector("section")).not.toHaveClass("max-w-6xl")

  rerender(<ProjectManagement canManage canCreate />)
  expect(container.querySelector("section")).toHaveClass("mx-auto", "max-w-6xl")
})

it("lets a manager choose contractor and employee assignments while creating a project",async()=>{
  vi.stubGlobal("fetch",vi.fn(async(input,init)=>{
    if(init?.method==="POST")return new Response(JSON.stringify({project:{id:"project-new"}}),{status:201})
    return new Response(JSON.stringify({projects:[],assignments:[],patrons:[
      {email:"contractor@example.com",displayName:"Taylor Contractor",role:"contractor"},
      {email:"employee@example.com",displayName:"Alex Employee",role:"employee"},
    ]}))
  }))
  render(<ProjectManagement canManage canCreate fullWidth/>)
  await userEvent.type(await screen.findByLabelText("Project name"),"Bridge repair")
  await userEvent.click(screen.getByRole("checkbox",{name:/Taylor Contractor/}))
  await userEvent.click(screen.getByText(/Employee assignments/))
  await userEvent.click(screen.getByRole("checkbox",{name:/Alex Employee/}))
  await userEvent.click(screen.getByRole("button",{name:"Create project"}))
  await screen.findByRole("status")
  const post=vi.mocked(fetch).mock.calls.find(([,init])=>init?.method==="POST")
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({name:"Bridge repair",initialAssignmentEmails:["contractor@example.com","employee@example.com"]})
})

it("shows the appointed manager separately from the contractor assignment",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
    projects:[{id:"project-1",name:"Site repair",description:"",active:true,createdBy:"taylor@example.com",managerEmail:"morgan@example.com"}],
    assignments:[{projectId:"project-1",email:"taylor@example.com"}],
    patrons:[{email:"taylor@example.com",displayName:"Taylor Contractor",role:"contractor"},{email:"morgan@example.com",displayName:"Morgan Manager",role:"manager"}],
  }))))
  render(<ProjectManagement canManage canCreate fullWidth/>)
  const project=await screen.findByRole("group",{name:"People assigned to Site repair"})
  expect(screen.getByText("Appointed manager: Morgan Manager")).toBeVisible()
  expect(within(project).queryByRole("checkbox",{name:/Morgan Manager/})).not.toBeInTheDocument()
  expect(within(project).getByRole("checkbox",{name:"Taylor Contractor"})).toBeChecked()
})

it("offers explicit manager-side duplicate resolution for similar patron projects",async()=>{
  const request=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
    if(init?.method==="PATCH")return new Response(JSON.stringify({ok:true,targetName:"Bridge Repairs",updatedEntries:2}))
    return new Response(JSON.stringify({projects:[
      {id:"self-project",name:"Bridge repair",description:"",active:true,createdBy:"taylor@example.com",managerEmail:"morgan@example.com",used:true},
      {id:"canonical",name:"Bridge Repairs",description:"",active:true,createdBy:"morgan@example.com",managerEmail:null,used:true},
    ],assignments:[{projectId:"self-project",email:"taylor@example.com"}],assignmentHistory:[],patrons:[
      {email:"taylor@example.com",displayName:"Taylor Contractor",role:"contractor"},
      {email:"morgan@example.com",displayName:"Morgan Manager",role:"manager"},
    ]}))
  })
  vi.stubGlobal("fetch",request)
  vi.spyOn(window,"confirm").mockReturnValue(true)
  render(<ProjectManagement canManage fullWidth/>)
  await userEvent.click(await screen.findByRole("button",{name:"Bridge Repairs · Merge"}))
  const mergeCall=request.mock.calls.find(([,init])=>init?.method==="PATCH")
  expect(JSON.parse(String(mergeCall?.[1]?.body))).toMatchObject({action:"merge",sourceProjectId:"self-project",targetProjectId:"canonical"})
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

it("exposes pause and resume controls for an assigned contractor",async()=>{
  const request=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>new Response(JSON.stringify({
    projects:[{id:"project-1",name:"Site repair",description:"",active:true,createdBy:"manager@example.com"}],
    assignments:[{projectId:"project-1",email:"taylor@example.com",status:"active"}],
    assignmentHistory:[],patrons:[{email:"taylor@example.com",displayName:"Taylor Contractor",role:"contractor"}],
  }),{status:200}))
  vi.stubGlobal("fetch",request)
  render(<ProjectManagement canManage fullWidth/>)
  await userEvent.click(await screen.findByRole("button",{name:"Pause Taylor Contractor on Site repair"}))
  const pauseCall=request.mock.calls.find(([,init])=>init?.method==="PATCH")
  expect(JSON.parse(String(pauseCall?.[1]?.body))).toMatchObject({action:"assignment_status",email:"taylor@example.com",status:"paused"})
})
