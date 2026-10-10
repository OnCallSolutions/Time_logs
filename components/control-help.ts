/**
 * Defines short explanations for common application commands and navigation.
 * Descriptions explain consequences without granting rights or changing behavior.
 * Callers can supply more specific help when a control has contextual meaning.
 */
import { Children, isValidElement, type ReactNode } from "react"

/**
 * Extracts visible labels from text and ordinary React child elements.
 * @param children - Button content, including icons and conditional text.
 * @returns Plain label text without evaluating components or reading user data.
 */
export function controlLabel(children:ReactNode):string {
  return Children.toArray(children).map(child=>typeof child==="string"||typeof child==="number"?String(child):isValidElement<{children?:ReactNode}>(child)?controlLabel(child.props.children):"").join(" ").replace(/\s+/g," ").trim()
}
const help:[RegExp,string][]=[
  [/sign in.*microsoft/i,"Sign in securely with your Microsoft account. Your assigned role determines available controls."],
  [/sign out/i,"End your application session and return to sign-in."],
  [/employee access|actor rights|user directory/i,"View people and manage their assigned access. Changes require Edit and Save."],
  [/access lifecycle/i,"Schedule access changes and manage temporary coverage when people join, leave, or change duties."],
  [/temporary coverage/i,"Grant time-limited operational rights for authorized colleagues."],
  [/security|app activity/i,"Inspect authorized security reports or activity records. Open individual records for full details."],
  [/unlock messages/i,"Unlock encrypted message content on this device using your recovery passphrase."],
  [/lock messages/i,"Remove unlocked messaging keys from this session on this device."],
  [/send message/i,"Send the composed message to the chosen audience after encryption and permission checks."],
  [/new message/i,"Open the composer and choose the people who should receive your message."],
  [/message settings/i,"Manage message notifications and encrypted-message access for this device."],
  [/mark.*read/i,"Update the read status of the selected conversation or messages."],
  [/messages/i,"Open conversations, choose recipients, and read or send messages according to your rights."],
  [/profile|picture|avatar/i,"Open your profile to review or update saved personal details and picture."],
  [/business accounts/i,"Review approved work handed to account managers for financial evidence checks."],
  [/ai review|ai suggestion|analyze|prepare.*review/i,"Request AI advice on available evidence. Advice does not approve work or release funds."],
  [/review handoff|confirm.*handoff/i,"Assign selected approved work to the chosen account manager. No payment is released."],
  [/review queue|review selected|review suggestion/i,"Inspect submitted work and choose an explicit review outcome."],
  [/approve|approval/i,"Review the selected work before recording approval. Your own work requires an independent reviewer."],
  [/reject|rejection/i,"Review the work and provide a reason before recording rejection."],
  [/team report|workflow totals|directory totals/i,"Open a summary of the records you are authorized to view."],
  [/workspace overview/i,"Open a summary of your workspace and available role controls."],
  [/log time|add entry|new entry/i,"Record work details for a timesheet entry before submission."],
  [/submit/i,"Send your work for independent review. Submitted evidence may be locked against editing."],
  [/select all|select visible/i,"Select the eligible records currently offered by this view, up to its stated limit."],
  [/clear selection/i,"Remove the current selection without deleting records."],
  [/refresh/i,"Reload the latest authorized records from the server."],
  [/edit/i,"Open editable properties. Changes take effect only after saving."],
  [/save|confirm review/i,"Save the displayed changes after server permission and validation checks."],
  [/delete|remove/i,"Review the deletion carefully. Available actions depend on your permissions."],
  [/export|download/i,"Download the records or report available in this view."],
  [/cancel|back/i,"Return to the previous view without confirming this action."],
  [/expand|maximize|full.?screen/i,"Open this window at full size."],
  [/minimize|restore|compact/i,"Return this window to its compact size."],
  [/details|view .*evidence/i,"Open the complete record and its available metadata."],
  [/^review$/i,"Open this record for a reasoned human review before saving an outcome."],
  [/role defaults/i,"Reset these permission choices to the defaults for the selected role."],
]
/**
 * Resolves a known command explanation without guessing sensitive consequences.
 * @param label - Visible or accessible control name.
 * @returns Matching description, or undefined when explicit help is needed.
 */
export function controlHelp(label:string):string|undefined {
  return help.find(([pattern])=>pattern.test(label))?.[1]
}
