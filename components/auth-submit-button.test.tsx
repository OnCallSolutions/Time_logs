/**
 * Verifies branded authentication controls retain their labels and pending safety.
 * Server authentication itself is mocked; the tests exercise only presentation.
 */
import {render,screen} from "@testing-library/react"
import {beforeEach,expect,it,vi} from "vitest"
const state=vi.hoisted(()=>({pending:false}))
vi.mock("react-dom",async()=>({...await vi.importActual("react-dom"),useFormStatus:()=>({pending:state.pending})}))
import {AuthSubmitButton} from "./auth-submit-button"
beforeEach(()=>{state.pending=false})
it("shows the Microsoft submit control and self-hosted official symbol",()=>{
  render(<AuthSubmitButton mode="signin"/>)
  expect(screen.getByRole("button",{name:"Sign in with Microsoft"})).toHaveAttribute("type","submit")
  expect(document.querySelector("img")).toHaveAttribute("src","/tanovotime/microsoft-symbol.png")
})
it("prevents duplicate sign-in while the form is pending",()=>{
  state.pending=true;render(<AuthSubmitButton mode="signin"/>)
  expect(screen.getByRole("button",{name:"Connecting to Microsoft..."})).toBeDisabled()
  expect(screen.getByRole("status")).toHaveTextContent("Opening Microsoft sign-in.")
})
it("shows an accessible pending sign-out state",()=>{
  state.pending=true;render(<AuthSubmitButton mode="signout"/>)
  expect(screen.getByRole("button",{name:"Signing out..."})).toBeDisabled()
})
