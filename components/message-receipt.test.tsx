/**
 * Confirms truthful account-level receipts and blue/grey tick styling.
 * Fixtures distinguish server acceptance from delivery and explicit reading.
 */
import {render,screen} from "@testing-library/react"
import {expect,it} from "vitest"
import {MessageReceipt} from "./message-receipt"
import type {AppMessage} from "@/lib/message-policy"
const message:AppMessage={id:"test",sender_email:"sender@example.com",recipient_email:"other@example.com",body:"Test",created_at:"2026-10-15T12:00:00Z"}
it("uses one grey tick without visible receipt wording before delivery",()=>{
  render(<MessageReceipt message={message}/> )
  expect(screen.getByLabelText("Sent").querySelector("svg")).toHaveClass("text-gray-500","lucide-check")
  expect(screen.getByLabelText("Sent")).toHaveTextContent("")
})
it("uses grey double ticks for delivered unread messages",()=>{
  render(<MessageReceipt message={{...message,delivered_at:message.created_at}}/> )
  expect(screen.getByLabelText("Delivered, unread").querySelector("svg")).toHaveClass("text-gray-500","lucide-check-check")
  expect(screen.getByLabelText("Delivered, unread")).toHaveTextContent("")
})
it("uses blue double ticks only after an explicit read receipt",()=>{
  render(<MessageReceipt message={{...message,read_at:message.created_at}}/> )
  expect(screen.getByLabelText("Read").querySelector("svg")).toHaveClass("text-blue-600","lucide-check-check")
  expect(screen.getByLabelText("Read")).toHaveTextContent("")
})
