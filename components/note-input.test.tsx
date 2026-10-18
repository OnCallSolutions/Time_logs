/**
 * Verifies identity-scoped sample loading and read-only financial previews.
 * Sample content comes from a mocked authenticated endpoint, not client names.
 * Preview controls must never invoke extraction or persist actual evidence.
 */
import { render,screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach,expect,it,vi } from "vitest"
import { NoteInput } from "./note-input"
afterEach(()=>vi.unstubAllGlobals())
const period={id:"10000000-0000-4000-8000-000000000001",name:"Current period",startDate:"2026-01-01",endDate:"2026-12-31"}
function periodResponse(){return new Response(JSON.stringify({periods:[period]}))}
it("loads sample identity from the server without supplying another person's name",async()=>{
  const request=vi.fn(async(input:string|URL|Request)=>String(input).includes("timesheet-periods")?periodResponse():new Response(JSON.stringify({notes:"Own Person: 2 hours on Sample Project"})))
  vi.stubGlobal("fetch",request);render(<NoteInput onParsed={()=>{}}/>)
  await userEvent.click(screen.getByRole("button",{name:"AI notes"}))
  await userEvent.click(screen.getByRole("button",{name:"Try a sample"}))
  expect(screen.getByRole("textbox",{name:"Time worked notes"})).toHaveValue("Own Person: 2 hours on Sample Project")
  expect(request).toHaveBeenCalledWith(expect.stringContaining("/api/samples?count=random"),{cache:"no-store"})
})
it("does not expose extraction for account-manager sample preview",()=>{
  render(<NoteInput previewOnly onParsed={()=>{}}/>)
  expect(screen.queryByRole("button",{name:"Extract entries"})).not.toBeInTheDocument()
})
it("keeps manager-generated samples read-only and display-only until cleared",async()=>{
  const request=vi.fn(async(input:string|URL|Request)=>String(input).includes("timesheet-periods")?periodResponse():new Response(JSON.stringify({notes:"Sample Contractor A (ID: SAMPLE-CTR-001): 2 hours",previewOnly:true})))
  vi.stubGlobal("fetch",request);render(<NoteInput onParsed={()=>{}}/>)
  await userEvent.click(screen.getByRole("button",{name:"AI notes"}))
  await userEvent.click(screen.getByRole("button",{name:"Try a sample"}))
  expect(screen.getByRole("textbox",{name:"Time worked notes"})).toHaveAttribute("readonly")
  expect(screen.queryByRole("button",{name:"Extract entries"})).not.toBeInTheDocument()
  expect(screen.getByText(/Display-only sample/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button",{name:"Clear sample"}))
  expect(screen.getByRole("textbox",{name:"Time worked notes"})).not.toHaveAttribute("readonly")
})
it("requests the selected multi-entry sample size",async()=>{
  const request=vi.fn(async(input:string|URL|Request)=>String(input).includes("timesheet-periods")?periodResponse():new Response(JSON.stringify({notes:"Twelve sample entries"})))
  vi.stubGlobal("fetch",request);render(<NoteInput onParsed={()=>{}}/>)
  await userEvent.click(screen.getByRole("button",{name:"AI notes"}))
  await userEvent.selectOptions(screen.getByLabelText("Sample entry count per person"),"12")
  await userEvent.click(screen.getByRole("button",{name:"Try a sample"}))
  expect(request).toHaveBeenCalledWith(expect.stringContaining("count=12"),{cache:"no-store"})
})
it("sends the selected configured period with AI extraction",async()=>{
  const onParsed=vi.fn(async()=>{})
  const request=vi.fn(async(input:string|URL|Request)=>String(input).includes("timesheet-periods")?periodResponse():String(input).includes("/api/projects")?Response.json({projects:[{id:"p1",name:"Project",description:""}]}):Response.json({entries:[{contractor:"Own Person",date:"2026-10-17",hours:2,project:"Project",description:"Work"}]}))
  vi.stubGlobal("fetch",request);render(<NoteInput onParsed={onParsed}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"AI notes"}))
  await user.type(screen.getByRole("textbox",{name:"Time worked notes"}),"2 hours on Project")
  await user.click(screen.getByRole("button",{name:"Extract entries"}))
  expect(request).toHaveBeenCalledWith("/tanovo-time/api/parse",expect.objectContaining({method:"POST",body:JSON.stringify({notes:"2 hours on Project",periodId:period.id})}))
  expect(onParsed).toHaveBeenCalledWith([expect.objectContaining({date:"2026-10-17",project:"Project"})],period.id)
})
it("creates AI-discovered projects when authorized before saving entries",async()=>{
  const onParsed=vi.fn(async()=>{})
  let projectReads=0
  const request=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input)
    if(url.includes("timesheet-periods"))return periodResponse()
    if(url.endsWith("/api/projects")&&init?.method==="POST")return Response.json({project:{id:"new-id",name:"New field project",description:""}},{status:201})
    if(url.includes("/api/parse"))return Response.json({entries:[{contractor:"Self",date:"2026-10-17",hours:2,project:"New field project",description:"Work"}]})
    projectReads++;return Response.json({projects:projectReads===1?[]:[{id:"new-id",name:"New field project",description:""}]})
  })
  vi.stubGlobal("fetch",request);render(<NoteInput canCreateProjects onParsed={onParsed}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"AI notes"}));await user.type(screen.getByRole("textbox",{name:"Time worked notes"}),"2 hours on New field project");await user.click(screen.getByRole("button",{name:"Extract entries"}))
  expect(request).toHaveBeenCalledWith("/tanovo-time/api/projects",expect.objectContaining({method:"POST",body:JSON.stringify({name:"New field project"})}))
  expect(onParsed).toHaveBeenCalledWith([expect.objectContaining({project:"New field project"})],period.id)
})
it("does not attempt project creation for unauthorized AI notes",async()=>{
  const onParsed=vi.fn(async()=>{})
  const request=vi.fn(async(input:string|URL|Request)=>String(input).includes("timesheet-periods")?periodResponse():String(input).includes("/api/projects")?Response.json({projects:[]}):Response.json({entries:[{contractor:"Self",date:"2026-10-17",hours:2,project:"Unassigned",description:"Work"}]}))
  vi.stubGlobal("fetch",request);render(<NoteInput onParsed={onParsed}/>);const user=userEvent.setup()
  await user.click(screen.getByRole("button",{name:"AI notes"}));await user.type(screen.getByRole("textbox",{name:"Time worked notes"}),"2 hours on Unassigned");await user.click(screen.getByRole("button",{name:"Extract entries"}))
  expect(onParsed).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalledWith("/tanovo-time/api/projects",expect.objectContaining({method:"POST"}))
  expect(await screen.findByRole("alert")).toHaveTextContent(/Ask your manager to assign them/)
})
it("creates a manual entry only after the user explicitly saves the queued row",async()=>{
  const onParsed=vi.fn(async()=>{})
  vi.stubGlobal("fetch",vi.fn(async(input:string|URL|Request)=>String(input).includes("timesheet-periods")?periodResponse():new Response(JSON.stringify({projects:[{id:"project-id",name:"Field operations",description:""}]}))))
  render(<NoteInput onParsed={onParsed}/>);const user=userEvent.setup()
  await user.selectOptions(await screen.findByLabelText("Assigned project"),"Field operations")
  await user.type(screen.getByLabelText("Hours"),"7.5")
  await user.type(screen.getByLabelText("Work description"),"Completed site inspection")
  await user.click(screen.getByRole("button",{name:"Add to timesheet"}))
  expect(onParsed).not.toHaveBeenCalled()
  expect(screen.getByText(/Field operations · 7.5h/)).toBeVisible()
  await user.click(screen.getByRole("button",{name:"Save entries"}))
  expect(onParsed).toHaveBeenCalledWith([expect.objectContaining({date:expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),project:"Field operations",hours:7.5,description:"Completed site inspection"})],period.id)
})
