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
it("loads sample identity from the server without supplying another person's name",async()=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({notes:"Own Person: 2 hours on Sample Project"})))
  vi.stubGlobal("fetch",request);render(<NoteInput onParsed={()=>{}}/>)
  await userEvent.click(screen.getByRole("button",{name:"Try a sample"}))
  expect(screen.getByRole("textbox",{name:"Time worked notes"})).toHaveValue("Own Person: 2 hours on Sample Project")
  expect(request).toHaveBeenCalledWith(expect.stringContaining("/api/samples"),{cache:"no-store"})
})
it("does not expose extraction for account-manager sample preview",()=>{
  render(<NoteInput previewOnly onParsed={()=>{}}/>)
  expect(screen.queryByRole("button",{name:"Extract entries"})).not.toBeInTheDocument()
})
