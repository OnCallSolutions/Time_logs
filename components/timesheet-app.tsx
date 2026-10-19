"use client"

/**
 * Provides the main role-aware timesheet workspace and navigation.
 *
 * This client component owns the visible application state after authentication:
 * loaded entries, current tab, sync errors, and confirmed edit behavior. It also
 * translates the user's role into visible navigation choices so the UI matches
 * the permissions enforced by the API routes.
 */
import { Fragment,useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { getSession } from "next-auth/react"
import { AssistantPanel } from "@/components/assistant-panel"
import { AssistantRunReport } from "@/components/assistant-run-report"
import { DataExportMenu } from "@/components/data-export-menu"
import { ReviewerHelpDialog } from "@/components/reviewer-help-dialog"
import { ManagerRejectionArchive } from "@/components/manager-rejection-archive"
import { Brand } from "@/components/brand"
import { EmployeeWorkspace, RoleWorkspaceHome } from "@/components/employee-workspace"
import { ApprovalSelection } from "@/components/approval-selection"
import { BusinessAccounts } from "@/components/business-accounts"
import { FinalApprovedTimesheets } from "@/components/final-approved-timesheets"
import { EmployeeRightsPanel, MessagesPanel } from "@/components/collaboration-panel"
import { useMessageInbox } from "@/components/use-message-inbox"
import { useMessageEncryption } from "@/components/use-message-encryption"
import { MessageNotifications } from "@/components/message-notifications"
import { notifyPermissionsChanged } from "@/lib/permission-events"
import { EntryReviewDialog, ManagerWorkspace } from "@/components/manager-workspace"
import { permissionLabels, resolvePermissions, type Permission, type PermissionOverrides } from "@/lib/permissions"
import { ProjectManagement } from "@/components/project-management"
import { accessChangeRequiresStepUp } from "@/lib/admin-policy"
import { openEntraReauthentication } from "@/lib/entra-reauth-popup"
import { AdminWorkspace } from "@/components/admin-workspace"
import { AdminIssuesWorkspace, IssueReportWindow, type IssueContext } from "@/components/issue-workspaces"
import { PeriodExpirationNotice } from "@/components/period-expiration-notice"
import { AccessLifecyclePanel } from "@/components/access-lifecycle-panel"
import { SecurityRiskWindow } from "@/components/security-risk-window"
import { SubmissionDeadlineSettings } from "@/components/submission-deadline-settings"
import { SubmissionDeadlineNotice } from "@/components/submission-deadline-notice"
import { PatronAccountActivity } from "@/components/patron-account-activity"
import { WindowSurface } from "@/components/window-surface"
import { WindowAssistantProvider } from "@/components/window-assistant-context"
import { WorkspaceUtilities } from "@/components/workspace-utilities"
import {
  ArrowRight,
  Activity,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Layers3,
  CircleHelp,
  BarChart3,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ListChecks,
  MessageSquare,
  KeyRound,
  Pencil,
  Save,
  Send,
  Sparkles,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Trash2,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react"
import { AccountProfile } from "@/components/account-profile"
import { AddPerson } from "./add-person"
import { NoteInput } from "@/components/note-input"
import { EntriesLog } from "@/components/entries-log"
import { TimesheetPeriodLanding } from "@/components/timesheet-period-landing"
import { SubmissionExtensionPanel } from "@/components/submission-extension-panel"
import { ManagerReport } from "@/components/manager-report"
import { SignOutButton } from "@/components/sign-out-button"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import { invalidateClientData, readClientData } from "@/lib/client-data-cache"
import { reportClientFailure } from "@/lib/client-error-report"
import type {
  AccessStatus,
  EntryStatus,
  ParsedEntry,
  TimeEntry,
  UserRole,
} from "@/lib/types"

type View = "home" | "period-index" | "log" | "personal" | "approvals" | "report" | "my-report" | "activity" | "admin" | "messages" | "permissions" | "accounts" | "periods"
type AdminStartSection = "landing" | "admin" | "reports" | "timesheets"
type WorkspaceHistoryFrame = { view: View; adminStartSection: AdminStartSection; pageWindow: boolean }
type WorkspacePageSnapshot = {
  view: View
  adminStartSection: AdminStartSection
  pageWindow: boolean
  workspaceHistory: WorkspaceHistoryFrame[]
  workspaceWindow: "overview" | "workflow" | "notes" | "ai-extract" | "projects" | null
  accountManagerTool: "periods" | "projects" | null
  initialTimesheetPeriod: string
}
const workspacePageStoragePrefix = "tanovo-time:workspace-page:"
const workspaceViews: View[] = ["home","period-index","log","personal","approvals","report","my-report","activity","admin","messages","permissions","accounts","periods"]
const adminStartSections: AdminStartSection[] = ["landing","admin","reports","timesheets"]

const manageableRoles: UserRole[] = ["admin", "manager", "account_manager", "employee", "contractor"]
const manageableStatuses: AccessStatus[] = ["active", "suspended", "retired", "blocked", "denied"]
const permissionGroups:{label:string;tone:"orange"|"blue"|"green"|"red"|"sky";permissions:Permission[]}[]=[
  {label:"Timesheet entry",tone:"orange",permissions:["create_entries","create_projects","edit_entries","delete_entries","submit_entries"]},
  {label:"Project catalog",tone:"green",permissions:["manage_projects"]},
  {label:"Team review and reporting",tone:"blue",permissions:["review_entries","view_team","view_all_timesheets","view_reports","export_entries","ai_review","view_manager_entries","review_manager_entries","view_other_manager_entries","review_other_manager_entries"]},
  {label:"Messages and review support",tone:"sky",permissions:["send_messages","request_review_help","accept_review_requests"]},
  {label:"Finance and periods",tone:"green",permissions:["send_to_accounts","view_accounts","review_accounts","ai_accounts","authorize_payouts","manage_timesheet_periods"]},
  {label:"Access and personal reporting",tone:"red",permissions:["delegate_permissions","view_personal_reports"]},
]
const pendingAccessChangeKey = "tanovo-time:pending-access-change"
const pendingClearEntriesKey = "tanovo-time:pending-clear-entries"

function canAssignPermission(role:UserRole,permission:Permission):boolean{
  if(permission==="create_projects"&&(role==="contractor"||role==="employee"))return true
  return resolvePermissions(role,{[permission]:true})[permission]
}

/**
 * User directory row returned by the administrator users API.
 *
 * The row combines env-configured access information with persisted profile and
 * timesheet activity so admins can audit both permission state and product usage.
 */
type AdminDirectoryUser = {
  environmentAdmin?: boolean
  permissions?: PermissionOverrides
  /** Normalized user email shown as the stable identity. */
  email: string
  /** Effective role from environment-backed access policy. */
  role: UserRole | "none"
  /** Current access state for this user. */
  accessStatus: AccessStatus | "observed"
  /** Source of the user's visible access state. */
  accessSource: "managed" | "environment" | "observed"
  /** Whether the email is explicitly present in an access environment variable. */
  accessConfigured: boolean
  /** Optional administrator note explaining managed access decisions. */
  note: string
  /** Administrator who last updated managed access. */
  updatedBy: string | null
  /** ISO timestamp for the last managed access update. */
  updatedAt: string | null
  /** Persisted profile display name, when available. */
  displayName: string
  /** Short company-scoped reference separate from the immutable account ID. */
  companyReference?: string | null
  /** Permanent, server-generated account/contractor identifier. */
  contractorNumber?: string | null
  /** Optional company-issued employee identifier. */
  employeeId?: string | null
  /** Persisted profile image data URL, when available. */
  imageDataUrl: string | null
  /** Total entries owned by the user. */
  totalEntries: number
  /** Owned entries still in draft. */
  draftEntries: number
  /** Owned entries waiting for manager review. */
  submittedEntries: number
  /** Owned entries approved by a manager or admin. */
  approvedEntries: number
  /** Owned entries rejected by a manager or admin. */
  rejectedEntries: number
  /** ISO timestamp for the user's most recently created entry. */
  lastEntryAt: string | null
}

/**
 * Draft state for the admin access editor window.
 *
 * Admins change this state with buttons and inputs inside the modal. Nothing is
 * persisted until the Save button calls the user-management API.
 */
type AccessEditorState = {
  protectedAdmin?: boolean
  environmentAdmin?: boolean
  permissions?: PermissionOverrides
  /** Whether the editor is creating a new row or changing an existing user. */
  mode: "add" | "edit"
  /** Email being created or edited. */
  email: string
  /** Draft role selected by the admin. */
  role: UserRole
  /** Draft permission state selected by the admin. */
  accessStatus: AccessStatus
  /** Draft note explaining the role or permission decision. */
  note: string
}

/**
 * Security audit event returned by the administrator audit API.
 *
 * Events are append-only server records of sensitive actions. Metadata is compact
 * by design so the audit log identifies what changed without duplicating private
 * entry descriptions or profile image payloads.
 */
type AdminAuditEvent = {
  /** Stable audit event id generated by the database. */
  id: string
  /** Email of the signed-in actor who performed the action. */
  actorEmail: string
  /** Machine-readable action label. */
  action: string
  /** Type of entity affected by the action. */
  targetType: string
  /** Optional id of the affected entity. */
  targetId: string | null
  /** Sanitized contextual data about the action. */
  metadata: Record<string, unknown>
  /** Request IP address when available. */
  ipAddress: string | null
  /** Request user agent when available. */
  userAgent: string | null
  /** HTTP method associated with the request when available. */
  requestMethod: string | null
  /** Request pathname, explicitly excluding query parameters. */
  requestPath: string | null
  /** Hosting or proxy request identifier when available. */
  requestId: string | null
  /** ISO timestamp for when the event occurred. */
  occurredAt: string
}

type AdminAuditReport = "access" | "periods" | "projects" | "api-errors"
type OperationalFilters={search:string;from:string;through:string;category:string;status:string}
type OperationalEventWire={id:string;correlationId:string;actorEmail:string;category:string;operation:string;route:string;method:string|null;httpStatus:number|null;errorCode:string|null;message:string;requestId:string|null;occurredAt:string}
function mapOperationalEvents(events:OperationalEventWire[]):AdminAuditEvent[]{return events.map(event=>({id:event.id,actorEmail:event.actorEmail,action:event.category==="client_error"?"client_error_reported":"operational_failure",targetType:event.category,targetId:event.correlationId,metadata:{category:event.category,operation:event.operation,route:event.route,httpMethod:event.method,httpStatus:event.httpStatus,errorCode:event.errorCode,message:event.message},ipAddress:null,userAgent:null,requestMethod:event.method,requestPath:event.route,requestId:event.requestId,occurredAt:event.occurredAt}))}

/**
 * Coordinates the signed-in user's role-aware timesheet workspace.
 *
 * The app receives the effective role from the server-rendered page and uses it
 * to decide which tabs, descriptions, and bulk actions to expose. Data mutations
 * still go through the API, so this component improves ergonomics without being
 * the source of authorization truth.
 *
 * @param props - Role and signed-in user identity for the current session.
 * @param props.role - Effective role used to choose visible navigation.
 * @param props.userName - Display name from Microsoft authentication.
 * @param props.userEmail - Email from Microsoft authentication.
 * @returns The interactive timesheet application shell.
 */
export function TimesheetApp({
  role: initialRole,
  userName,
  userEmail,
  organizationName = "DevOnCall",
}: {
  role: UserRole
  userName?: string | null
  userEmail?: string | null
  organizationName?: string
}) {
  const [role,setRole] = useState(initialRole)
  const [permissions,setPermissions] = useState(() => resolvePermissions(null))
  const [accessDenied,setAccessDenied] = useState(false)
  const [permissionsLoaded,setPermissionsLoaded] = useState(false)
  const messageInbox=useMessageInbox(permissionsLoaded&&!accessDenied)
  const messageEncryption=useMessageEncryption(accessDenied?"":messageInbox.email,messageInbox.messages)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const entryReadEpoch=useRef(0),pendingEntryWrites=useRef(0)
  const [view, setView] = useState<View>(role === "admin" ? "admin" : "home")
  const [pageRestoreReady,setPageRestoreReady]=useState(false)
  const previousRole = useRef(initialRole)
  const [messagesOpen,setMessagesOpen]=useState(false)
  const [announcementCompose,setAnnouncementCompose]=useState(false)
  const assistantDockRef=useRef<HTMLDivElement>(null)
  const assistantResizeStart=useRef<{pointerId:number;y:number;height:number;left:number;bottom:number}|null>(null)
  const assistantWidthResizeStart=useRef<{pointerId:number;x:number;width:number;right:number}|null>(null)
  const assistantDragStart=useRef<{pointerId:number;x:number;y:number;left:number;top:number}|null>(null)
  const assistantWasManuallyResized=useRef(false)
  const [assistantHeight,setAssistantHeight]=useState(380)
  const [assistantWidth,setAssistantWidth]=useState(0)
  const [assistantPosition,setAssistantPosition]=useState<{left:number;top:number}|null>(null)
  const [assistantDockOpen,setAssistantDockOpen]=useState(false)
  const [assistantFocusRequest,setAssistantFocusRequest]=useState(0)
  const [assistantMessageContext,setAssistantMessageContext]=useState("")
  const [assistantHandoff,setAssistantHandoff]=useState("")
  const [assistantCompose,setAssistantCompose]=useState<{recipient:string;body:string;confirmed:boolean}|null>(null)
  function focusAssistant():void {
    setAssistantDockOpen(true)
    setAssistantFocusRequest(value=>value+1)
  }
  /**
   * Starts resizing the dock by dragging its top edge.
   * @param event - Pointer gesture on the assistant resize grip.
   * @returns void after capturing the pointer and initial dimensions.
   */
  function beginAssistantResize(event:ReactPointerEvent<HTMLDivElement>):void {
    const bounds=assistantDockRef.current?.getBoundingClientRect()
    const measuredHeight=bounds?.height
    assistantResizeStart.current={pointerId:event.pointerId,y:event.clientY,height:measuredHeight&&measuredHeight>0?measuredHeight:assistantHeight,left:bounds?.left??12,bottom:bounds?.bottom??window.innerHeight-12}
    if(bounds)setAssistantPosition({left:bounds.left,top:bounds.top})
    assistantWasManuallyResized.current=true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  /**
   * Grows or shrinks the dock within the visible viewport bounds.
   * @param event - Active pointer movement from the resize grip.
   * @returns void after applying the bounded dock height.
   */
  function moveAssistantResize(event:ReactPointerEvent<HTMLDivElement>):void {
    const start=assistantResizeStart.current
    if(!start||start.pointerId!==event.pointerId)return
    const maximum=Math.max(220,window.innerHeight-24)
    const minimum=Math.min(300,maximum)
    const height=Math.max(minimum,Math.min(maximum,start.height+start.y-event.clientY))
    setAssistantHeight(height)
    setAssistantPosition({left:Math.max(8,Math.min(start.left,window.innerWidth-80)),top:Math.max(8,start.bottom-height)})
  }
  /**
   * Ends the current assistant resize gesture.
   * @param event - Pointer release or cancellation event.
   * @returns void after clearing the active resize state.
   */
  function endAssistantResize(event:ReactPointerEvent<HTMLDivElement>):void {
    if(assistantResizeStart.current?.pointerId===event.pointerId)assistantResizeStart.current=null
  }
  function beginAssistantWidthResize(event:ReactPointerEvent<HTMLDivElement>):void {
    const bounds=assistantDockRef.current?.getBoundingClientRect()
    const width=bounds?.width??Math.min(window.innerWidth*.5,704)
    assistantWidthResizeStart.current={pointerId:event.pointerId,x:event.clientX,width,right:bounds?.right??window.innerWidth-12}
    if(bounds)setAssistantPosition({left:bounds.left,top:bounds.top})
    event.currentTarget.setPointerCapture?.(event.pointerId);event.preventDefault()
  }
  function moveAssistantWidthResize(event:ReactPointerEvent<HTMLDivElement>):void {
    const start=assistantWidthResizeStart.current
    if(!start||start.pointerId!==event.pointerId)return
    const maximum=Math.max(240,window.innerWidth-24),minimum=Math.min(320,maximum)
    const width=Math.max(minimum,Math.min(maximum,start.width+start.x-event.clientX))
    setAssistantWidth(width)
    setAssistantPosition(position=>({left:Math.max(8,start.right-width),top:position?.top??assistantDockRef.current?.getBoundingClientRect().top??8}))
  }
  function endAssistantWidthResize(event:ReactPointerEvent<HTMLDivElement>):void {
    if(assistantWidthResizeStart.current?.pointerId===event.pointerId)assistantWidthResizeStart.current=null
  }
  function beginAssistantDrag(event:ReactPointerEvent<HTMLElement>):void {
    if((event.target as HTMLElement).closest("button,a,input,select,textarea"))return
    const bounds=assistantDockRef.current?.getBoundingClientRect()
    if(!bounds)return
    assistantDragStart.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:bounds.left,top:bounds.top}
    setAssistantPosition({left:bounds.left,top:bounds.top})
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  function moveAssistantDrag(event:ReactPointerEvent<HTMLElement>):void {
    const start=assistantDragStart.current
    const bounds=assistantDockRef.current?.getBoundingClientRect()
    if(!start||!bounds||start.pointerId!==event.pointerId)return
    const maxLeft=Math.max(8,window.innerWidth-bounds.width-8),maxTop=Math.max(8,window.innerHeight-bounds.height-8)
    setAssistantPosition({left:Math.max(8,Math.min(maxLeft,start.left+event.clientX-start.x)),top:Math.max(8,Math.min(maxTop,start.top+event.clientY-start.y))})
  }
  function endAssistantDrag(event:ReactPointerEvent<HTMLElement>):void {
    if(assistantDragStart.current?.pointerId===event.pointerId)assistantDragStart.current=null
  }
  function resizeAssistantHeightByKeyboard(delta:number):void {
    assistantWasManuallyResized.current=true
    const bounds=assistantDockRef.current?.getBoundingClientRect()
    const maximum=Math.max(180,window.innerHeight-24),minimum=Math.min(300,maximum)
    setAssistantHeight(height=>{
      const next=Math.max(minimum,Math.min(maximum,height+delta))
      if(bounds)setAssistantPosition(position=>({left:position?.left??bounds.left,top:Math.max(8,(position?.top??bounds.top)+bounds.height-next)}))
      return next
    })
  }
  function resizeAssistantWidthByKeyboard(delta:number):void {
    const bounds=assistantDockRef.current?.getBoundingClientRect()
    const maximum=Math.max(240,window.innerWidth-24),minimum=Math.min(320,maximum)
    setAssistantWidth(width=>{
      const next=Math.max(minimum,Math.min(maximum,(width||bounds?.width||Math.min(window.innerWidth*.5,704))+delta))
      if(bounds)setAssistantPosition(position=>({left:Math.max(8,(position?.left??bounds.left)+bounds.width-next),top:position?.top??bounds.top}))
      return next
    })
  }
  useEffect(()=>{
    if(!assistantDockOpen)return
    const clampToViewport=()=>{
      const bounds=assistantDockRef.current?.getBoundingClientRect()
      const maxHeight=Math.max(180,window.innerHeight-24),maxWidth=Math.max(240,window.innerWidth-24)
      setAssistantHeight(height=>Math.min(height,maxHeight))
      setAssistantWidth(width=>width?Math.min(width,maxWidth):0)
      if(bounds)setAssistantPosition(position=>position?{
        left:Math.max(8,Math.min(position.left,window.innerWidth-bounds.width-8)),
        top:Math.max(8,Math.min(position.top,window.innerHeight-bounds.height-8)),
      }:null)
    }
    window.addEventListener("resize",clampToViewport)
    return()=>window.removeEventListener("resize",clampToViewport)
  },[assistantDockOpen])
  const permissionRequest=useRef(0)
  useEffect(()=>{
    if(role!==previousRole.current) {
      if(role==="admin")setView("admin")
      else setView("home")
    }
    previousRole.current=role
  },[role,permissions.view_accounts])
  const [entriesRefresh,setEntriesRefresh]=useState(0)
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [issueContext, setIssueContext] = useState<IssueContext | null>(null)
  const [issueReportOpen, setIssueReportOpen] = useState(false)
  useEffect(()=>{if(!syncError)return;const timeout=window.setTimeout(()=>setSyncError(null),9000);return()=>window.clearTimeout(timeout)},[syncError])
  function showTrackedFailure(cause:unknown,operation:string,route:string,status?:number,method?:"GET"|"POST"|"PUT"|"PATCH"|"DELETE"):void{
    const message=cause instanceof Error?cause.message:"The action could not be completed."
    const rawCode=cause&&typeof cause==="object"&&"code" in cause?cause.code:undefined
    const code=typeof rawCode==="string"&&/^[A-Z0-9_.-]{1,40}$/.test(rawCode)?rawCode:undefined
    const reference=reportClientFailure({operation,route,status,method,code,message})
    setIssueContext({reference,operation,route,status,method,code,message})
    setSyncError(message.includes(reference)?message:`${message} Reference: ${reference}`)
  }
  const [clearEntriesConfirmationOpen, setClearEntriesConfirmationOpen] = useState(false)
  const [clearEntriesBusy, setClearEntriesBusy] = useState(false)
  const [clearEntriesScope,setClearEntriesScope]=useState<"all_entries"|"preview_reset">("all_entries")
  const [previewResetPhrase,setPreviewResetPhrase]=useState("")
  const reauthenticationPopup=useRef<Window|null>(null)
  const [savedStatus,setSavedStatus]=useState("")
  const [personalStatus, setPersonalStatus] = useState<EntryStatus | "all">("all")
  const [suggestedReview,setSuggestedReview] = useState<{entry:TimeEntry;decision:"approved"|"rejected";reason:string}|null>(null)
  const [reviewerHelp,setReviewerHelp]=useState<TimeEntry[]|null>(null)
  const [technologyReports,setTechnologyReports] = useState(false)
  const [lifecycleOpen,setLifecycleOpen]=useState(false)
  const [directoryRequest,setDirectoryRequest] = useState(0)
  const [adminStartSection,setAdminStartSection]=useState<AdminStartSection>("landing")
  const [pageWindow,setPageWindow] = useState(false)
  const [workspaceHistory,setWorkspaceHistory]=useState<WorkspaceHistoryFrame[]>([])
  const [workspaceWindow,setWorkspaceWindow] = useState<"overview"|"workflow"|"notes"|"ai-extract"|"projects"|null>(null)
  const [accountManagerTool,setAccountManagerTool]=useState<"periods"|"projects"|null>(null)
  const [extensionPanelOpen,setExtensionPanelOpen]=useState(false)
  const [initialTimesheetPeriod,setInitialTimesheetPeriod]=useState("current")
  const workspacePageStorageKey=userEmail?`${workspacePageStoragePrefix}${userEmail.toLowerCase()}`:null
  useEffect(()=>{
    if(!workspacePageStorageKey){setPageRestoreReady(true);return}
    try{
      const raw=window.sessionStorage.getItem(workspacePageStorageKey)
      if(raw){
        const saved=JSON.parse(raw) as Partial<WorkspacePageSnapshot>
        if(saved.view&&workspaceViews.includes(saved.view))setView(saved.view)
        if(saved.adminStartSection&&adminStartSections.includes(saved.adminStartSection))setAdminStartSection(saved.adminStartSection)
        if(typeof saved.pageWindow==="boolean")setPageWindow(saved.pageWindow)
        if(Array.isArray(saved.workspaceHistory))setWorkspaceHistory(saved.workspaceHistory.filter((frame):frame is WorkspaceHistoryFrame=>Boolean(frame&&workspaceViews.includes(frame.view)&&adminStartSections.includes(frame.adminStartSection)&&typeof frame.pageWindow==="boolean")))
        if(saved.workspaceWindow===null||saved.workspaceWindow==="overview"||saved.workspaceWindow==="workflow"||saved.workspaceWindow==="notes"||saved.workspaceWindow==="ai-extract"||saved.workspaceWindow==="projects")setWorkspaceWindow(saved.workspaceWindow)
        if(saved.accountManagerTool===null||saved.accountManagerTool==="periods"||saved.accountManagerTool==="projects")setAccountManagerTool(saved.accountManagerTool)
        if(typeof saved.initialTimesheetPeriod==="string")setInitialTimesheetPeriod(saved.initialTimesheetPeriod)
      }
    }catch{/* Ignore stale or malformed navigation snapshots. */}
    setPageRestoreReady(true)
  },[workspacePageStorageKey])
  useEffect(()=>{
    if(!pageRestoreReady||!workspacePageStorageKey)return
    const snapshot:WorkspacePageSnapshot={view,adminStartSection,pageWindow,workspaceHistory,workspaceWindow,accountManagerTool,initialTimesheetPeriod}
    try{window.sessionStorage.setItem(workspacePageStorageKey,JSON.stringify(snapshot))}catch{/* Navigation still works when session storage is unavailable. */}
  },[pageRestoreReady,workspacePageStorageKey,view,adminStartSection,pageWindow,workspaceHistory,workspaceWindow,accountManagerTool,initialTimesheetPeriod])
  const entriesEndpoint = apiPath("/api/entries")
  /**
   * Opens a complete role page while preserving its parent command group for Back.
   * @param next - Authorized workspace view selected by a user or assistant action.
   * @returns void after scheduling the requested page state.
   */
  function openWorkspacePage(next:View, section?:AdminStartSection):void {
    setWorkspaceHistory(previous=>[...previous,{view,adminStartSection,pageWindow}])
    if(section)setAdminStartSection(section)
    setView(next)
    setPageWindow(true)
  }
  /**
   * Returns from a nested role page to its command group or role home.
   * @returns void after closing the child page window.
   */
  function closeWorkspacePage():void {
    const previous=workspaceHistory.at(-1)
    if(previous){
      setWorkspaceHistory(history=>history.slice(0,-1))
      setView(previous.view)
      setAdminStartSection(previous.adminStartSection)
      setPageWindow(previous.pageWindow)
      return
    }
    setPageWindow(false)
    setView(role==="admin"?"admin":role==="account_manager"?"accounts":"home")
  }
  useEffect(() => {
    if (!userEmail) return
    const onMessage=async(event:MessageEvent)=>{
      if(event.origin!==window.location.origin||event.source!==reauthenticationPopup.current||event.data?.type!=="tanovo:microsoft-reauth-complete")return
      reauthenticationPopup.current=null
      const stored=window.sessionStorage.getItem(pendingClearEntriesKey)
      window.sessionStorage.removeItem(pendingClearEntriesKey)
      try{
        const pending=stored?JSON.parse(stored) as {email?:string;expiresAt?:number;scope?:"all_entries"|"preview_reset";state?:string}:null
        const session=await getSession()
        if(!event.data.ok||!pending||pending.state!==event.data.state||typeof pending.expiresAt!=="number"||pending.expiresAt<Date.now()||pending.email?.toLowerCase()!==userEmail.toLowerCase()||session?.user?.email?.toLowerCase()!==userEmail.toLowerCase())throw new Error()
        setClearEntriesScope(pending.scope??"all_entries")
        setPreviewResetPhrase("")
        setClearEntriesConfirmationOpen(true)
      }catch{setSyncError("Microsoft reauthentication was cancelled, expired, or returned a different account. No data was changed.")}
    }
    window.addEventListener("message",onMessage)
    return()=>window.removeEventListener("message",onMessage)
  }, [userEmail])
  /** Clears this account's brief entries snapshot after authorization or writes change. */
  const invalidateEntriesCache = () => {
    if (userEmail) invalidateClientData(userEmail, entriesEndpoint)
  }

  useEffect(() => {
    const controller = new AbortController()
    /**
     * Refreshes server rights and role after admin saves or browser focus changes.
     * @returns Promise<void> after live authorization state is applied.
     */
    async function refreshPermissions(): Promise<void> {
      const requestId=++permissionRequest.current
      try {
        const response = await fetch(apiPath("/api/permissions"),{cache:"no-store",signal:controller.signal})
        const data = await response.json()
        if(requestId!==permissionRequest.current)return
        if (!response.ok || !data.role) {
          invalidateEntriesCache()
          setPermissionsLoaded(true); setAccessDenied(true); setPermissions(resolvePermissions(null)); setEntries([]); return
        }
        invalidateEntriesCache()
        setPermissionsLoaded(true); setAccessDenied(false); setRole(data.role); setPermissions(data.permissions)
      } catch { if (!controller.signal.aborted&&requestId===permissionRequest.current) { setAccessDenied(true); setEntries([]); setPermissions(resolvePermissions(null)) } }
    }
    void refreshPermissions()
    const timer = window.setInterval(refreshPermissions,5000)
    window.addEventListener("focus",refreshPermissions)
    window.addEventListener("permissions-changed",refreshPermissions)
    const channel=typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("permissions-changed") : null
    if(channel)channel.onmessage=()=>void refreshPermissions()
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus",refreshPermissions); window.removeEventListener("permissions-changed",refreshPermissions); channel?.close() }
  },[])

  useEffect(() => {
    if (accessDenied) return
    let active = true
    let fetching=false
    const controller=new AbortController()

    /**
     * Loads saved entries visible to the signed-in user's role.
     *
     * The API decides whether the caller receives personal entries or team-wide
     * entries. The local active flag prevents state updates after unmounting while
     * the request is still in flight.
     *
     * @returns A promise that resolves after entries are loaded or an error is stored.
     */
    async function loadEntries() {
      if(fetching||pendingEntryWrites.current)return
      fetching=true
      const epoch=entryReadEpoch.current
      try {
        const data = await readClientData<{ entries?: TimeEntry[]; error?: string }>(entriesEndpoint, userEmail ?? "anonymous", 1500)
        if (active&&epoch===entryReadEpoch.current&&!pendingEntryWrites.current) setEntries(previous=>JSON.stringify(previous)===JSON.stringify(data.entries??[])?previous:data.entries??[])
      } catch (err) {
        if (active) {
          setSyncError(
            err instanceof Error ? err.message : "Failed to load entries.",
          )
        }
      } finally {
        fetching=false
        if (active) setLoadingEntries(false)
      }
    }

    loadEntries()
    /** Forces a fresh server read when the user returns to an active tab. */
    const refresh=()=>{if(document.visibilityState==="visible"){invalidateEntriesCache();void loadEntries()}}
    const timer=window.setInterval(refresh,15000)
    window.addEventListener("focus",refresh)

    return () => {
      active = false
      controller.abort();window.clearInterval(timer);window.removeEventListener("focus",refresh)
    }
  }, [role,permissions.view_team,permissions.view_all_timesheets,permissions.view_manager_entries,permissions.review_manager_entries,permissions.view_other_manager_entries,permissions.review_other_manager_entries,permissions.accept_review_requests,entriesRefresh,messageInbox.messages,accessDenied,entriesEndpoint,userEmail])

  const canViewTeamReports = permissions.view_reports
  const canViewAdmin = role === "admin" && !accessDenied
  const canClearVisibleEntries = role === "admin" && permissions.delete_entries && permissions.view_team
  useEffect(() => {
    if (clearEntriesConfirmationOpen && permissionsLoaded && !canClearVisibleEntries) {
      setClearEntriesConfirmationOpen(false)
      setSyncError("Administrator clear permission is no longer active. No entries were cleared.")
    }
  }, [clearEntriesConfirmationOpen, permissionsLoaded, canClearVisibleEntries])
  const canReviewEntries = permissions.review_entries||permissions.review_manager_entries
  const canAIReview = permissions.ai_review||(role==="account_manager"&&permissions.review_manager_entries&&permissions.ai_accounts)
  const canSubmitEntries = permissions.submit_entries
  useEffect(() => {
    if (!canReviewEntries) setSuggestedReview(null)
  },[canReviewEntries])
  const roleLabel = {
    admin: "Administrator",
    manager: "Manager",
    account_manager: "Business accounts manager",
    employee: "Employee",
    contractor: "Contractor",
  }[role]

  useEffect(() => {
    if (!permissionsLoaded) return
    if (view === "report" && !canViewTeamReports) setView("log")
    if (view === "my-report" && !permissions.view_personal_reports) setView("log")
    if (view === "approvals" && !canReviewEntries && !canAIReview) setView("log")
    if (view === "admin" && !canViewAdmin) setView("log")
    if (view === "permissions" && (!permissions.delegate_permissions || (role !== "admin" && role !== "manager"))) setView("log")
    if (view === "periods" && !permissions.manage_timesheet_periods) setView("log")
    if (accessDenied && view === "messages") setView("log")
    if(view==="accounts"&&(accessDenied||!((permissions.view_accounts&&(role==="admin"||role==="account_manager")))))setView("log")
  }, [canReviewEntries, canViewAdmin, canViewTeamReports, view,permissionsLoaded,permissions.ai_review,permissions.delegate_permissions,permissions.manage_timesheet_periods,permissions.send_to_accounts,permissions.view_accounts,permissions.view_personal_reports,role,accessDenied])

  useEffect(()=>{
    if(!permissionsLoaded)return
    if(accessDenied){setWorkspaceWindow(null);setAccountManagerTool(null);setMessagesOpen(false);return}
    if(workspaceWindow==="projects"&&!permissions.manage_projects&&!permissions.create_projects)setWorkspaceWindow(null)
    if((workspaceWindow==="notes"||workspaceWindow==="ai-extract")&&!permissions.create_entries)setWorkspaceWindow(null)
    if(accountManagerTool==="projects"&&(role!=="account_manager"||!permissions.manage_projects))setAccountManagerTool(null)
  },[permissionsLoaded,accessDenied,workspaceWindow,accountManagerTool,permissions.manage_projects,permissions.create_projects,permissions.create_entries,role])

  /**
   * Persists newly parsed entries and prepends them to the local view.
   *
   * Parsed entries come from the note input and do not have ids yet. The API
   * stores them under the current user and returns database-backed entries that
   * can be edited or deleted immediately.
   *
   * @param parsed - Entries returned by the AI parser.
   * @returns A promise that resolves after entries are saved and local state updates.
   */
  async function addParsed(parsed: ParsedEntry[],periodId:string) {
    invalidateEntriesCache()
    pendingEntryWrites.current++;entryReadEpoch.current++
    try{
    const res = await fetch(apiPath("/api/entries"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: parsed,periodId }),
    })
    const data = await res.json()
      if (!res.ok) throw Object.assign(new Error(`${data.error ?? "Failed to save entries."}${data.reference?` Reference: ${data.reference}`:""}`),{code:data.code})
    setEntries((prev) => [...(data.entries ?? []), ...prev])
    setSyncError(null)
    }catch(cause){showTrackedFailure(cause,"entry.create","/api/entries",undefined,"POST");throw cause
    }finally{invalidateEntriesCache();pendingEntryWrites.current--;entryReadEpoch.current++}
  }

  /**
   * Persists a complete edit or workflow transition without per-keystroke mutation.
   * Only the confirmed row is replaced; failures never roll back unrelated rows.
   * @param id - Persisted entry identifier.
   * @param patch - Explicitly confirmed field or status changes.
   * @param expectedRevision - Snapshot revision captured at edit/review start.
   * @returns Promise<void> after server confirmation; rejects on failure.
   */
  async function updateEntry(id: string, patch: Partial<TimeEntry>, expectedRevision?: string): Promise<void> {
    invalidateEntriesCache()
    pendingEntryWrites.current++;entryReadEpoch.current++
    let statusCode:number|undefined
    try {
      const response = await fetch(apiPath(`/api/entries/${id}`), {
        method: "PATCH",
        signal: AbortSignal.timeout(30000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, expectedRevision: expectedRevision ?? entries.find(entry => entry.id === id)?.revision }),
      })
      statusCode=response.status
      const data = await response.json()
      if (!response.ok) throw Object.assign(new Error(`${data.error??"Failed to update entry."}${data.reference?` Reference: ${data.reference}`:""}`),{code:data.code})
      setEntries(previous => role==="manager"&&data.entry.ownerEmail?.toLowerCase()!==userEmail?.toLowerCase()&&data.entry.status!=="submitted" ? previous.filter(entry=>entry.id!==id) : previous.map(entry => entry.id === id ? { ...entry, ...data.entry } : entry))
      setSyncError(null)
      if(patch.status)setSavedStatus(patch.status==="approved"?"Manager approval recorded; forwarded for final account review.":patch.status==="rejected"?"Returned to the submitter for correction.":patch.status==="submitted"?"Submitted for independent review.":"Recalled to draft.")
    } catch (cause) {
      const error = cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name)
        ? new Error("Request timed out. Refresh entries before retrying; the server may have saved the update.")
        : cause instanceof Error ? cause : new Error("Failed to update entry.")
      showTrackedFailure(error,patch.status?`entry.${patch.status}`:"entry.update","/api/entries/[id]",statusCode,"PATCH")
      throw error
    }finally{invalidateEntriesCache();pendingEntryWrites.current--;entryReadEpoch.current++}
  }

  /**
   * Awaits an explicit workflow decision using the selected evidence revision.
   * @param id - Entry identifier.
   * @param status - Requested workflow state.
   * @param reviewNote - Optional approval note or required rejection reason.
   * @param expectedRevision - Evidence revision displayed in the dialog.
   * @returns Promise<void> after persistence; rejects so dialogs remain open.
   */
  function changeEntryStatus(id: string, status: EntryStatus, reviewNote?: string, expectedRevision?: string, manager?:string): Promise<void> {
    return updateEntry(id, { status, reviewNote, ...(manager?{reviewManagerEmail:manager}:{}) }, expectedRevision)
  }

  /**
   * Optimistically removes one entry and restores it if deletion fails.
   *
   * Deletion follows the same optimistic pattern as editing. The API still checks
   * ownership and role scope, so a locally visible row cannot be removed unless
   * the server confirms permission.
   *
   * @param id - Entry id to delete.
   * @returns Nothing; local state and API sync happen as side effects.
   */
  function deleteEntry(id: string) {
    invalidateEntriesCache()
    pendingEntryWrites.current++;entryReadEpoch.current++
    const previous = entries
    setEntries((prev) => prev.filter((e) => e.id !== id))

    let statusCode:number|undefined
    fetch(apiPath(`/api/entries/${id}`), { method: "DELETE" })
      .then(async (res) => {
        statusCode=res.status
        const data = await res.json()
        if (!res.ok) throw Object.assign(new Error(data.error ?? "Failed to delete entry."),{code:data.code})
        setSyncError(null)
      })
      .catch((err) => {
        setEntries(previous)
        showTrackedFailure(err,"entry.delete","/api/entries/[id]",statusCode,"DELETE")
      })
      .finally(()=>{invalidateEntriesCache();pendingEntryWrites.current--;entryReadEpoch.current++})
  }

  /** Starts the five-minute Entra step-up flow; it does not mutate timesheets. */
  async function clearEntries() {
    if (!canClearVisibleEntries || !userEmail) return
    setSyncError(null)
    try {
      setClearEntriesScope("all_entries")
      const state=crypto.randomUUID()
      window.sessionStorage.setItem(pendingClearEntriesKey, JSON.stringify({ email: userEmail.toLowerCase(), expiresAt: Date.now() + 5 * 60_000,scope:"all_entries",state }))
      const popup=openEntraReauthentication(state,()=>{window.sessionStorage.removeItem(pendingClearEntriesKey);setSyncError("Microsoft reauthentication could not start. No entries were cleared.")})
      if(!popup){window.sessionStorage.removeItem(pendingClearEntriesKey);setSyncError("Allow the Microsoft verification popup to continue. No entries were cleared.");return}
      reauthenticationPopup.current=popup
    } catch {
      window.sessionStorage.removeItem(pendingClearEntriesKey)
      setSyncError("Microsoft reauthentication did not complete. No entries were cleared.")
    }
  }

  async function startPreviewDataReset(){
    if(role!=="admin"||!userEmail)return
    setSyncError(null)
    try{
      setClearEntriesScope("preview_reset")
      const state=crypto.randomUUID()
      window.sessionStorage.setItem(pendingClearEntriesKey,JSON.stringify({email:userEmail.toLowerCase(),expiresAt:Date.now()+5*60_000,scope:"preview_reset",state}))
      const popup=openEntraReauthentication(state,()=>{window.sessionStorage.removeItem(pendingClearEntriesKey);setSyncError("Microsoft reauthentication could not start. No preview data was cleared.")})
      if(!popup){window.sessionStorage.removeItem(pendingClearEntriesKey);setSyncError("Allow the Microsoft verification popup to continue. No preview data was cleared.");return}
      reauthenticationPopup.current=popup
    }catch{
      window.sessionStorage.removeItem(pendingClearEntriesKey)
      setSyncError("Microsoft reauthentication did not complete. No preview data was cleared.")
    }
  }

  /** Executes a clear only after fresh Entra authentication and a second explicit confirmation. */
  async function confirmClearEntries() {
    if (!canClearVisibleEntries || clearEntriesBusy) return
    if(clearEntriesScope==="preview_reset"&&previewResetPhrase!=="RESET PREVIEW DATA")return
    setClearEntriesBusy(true)
    invalidateEntriesCache()
    pendingEntryWrites.current++;entryReadEpoch.current++
    const previous = entries
    setEntries([])
    let statusCode:number|undefined
    try {
      const res = clearEntriesScope==="preview_reset"
        ? await fetch(apiPath("/api/admin/preview-reset"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmation:previewResetPhrase})})
        : await fetch(apiPath("/api/entries"), { method: "DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope:"all_entries"}) })
      statusCode=res.status
      const data = await res.json()
      if (!res.ok) throw Object.assign(new Error(data.error ?? "Failed to clear entries."),{code:data.code})
      const refresh = await fetch(apiPath("/api/entries"), { cache: "no-store" })
      const current = await refresh.json()
      if (!refresh.ok) throw new Error(current.error ?? "Unable to refresh entries after clearing.")
      setEntries(current.entries ?? [])
      setSyncError(null)
    } catch (err) {
      setEntries(previous)
      showTrackedFailure(err,"entries.clear","/api/entries",statusCode,clearEntriesScope==="preview_reset"?"POST":"DELETE")
    } finally {
      setClearEntriesBusy(false)
      setClearEntriesConfirmationOpen(false)
      setPreviewResetPhrase("")
      invalidateEntriesCache()
      pendingEntryWrites.current--
      entryReadEpoch.current++
    }
  }

  const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0)
  const pendingEntries = entries.filter((entry) => entry.status === "submitted"&&entry.reviewEligible!==false&&(role==="account_manager"||entry.ownerEmail?.toLowerCase()!==userEmail?.toLowerCase()))
  const approvedEntries = entries.filter((entry) => entry.status === "approved")
  const rejectedEntries = entries.filter((entry) => entry.status === "rejected")
  const draftEntries = entries.filter((entry) => entry.status === "draft")
  const personalStatuses:[EntryStatus|"all",string][]=[["all","All entries"],["draft","Drafts"],["submitted","Awaiting approval"],["rejected","Needs correction"],["approved","Approved"]]
  const isPersonalEntriesView=view==="personal"||((role==="employee"||role==="contractor")&&view==="log")
  const isTimesheetEntriesView=view==="log"||view==="personal"
  const ownEntries=entries.filter(entry=>entry.ownerEmail?.toLowerCase()===userEmail?.toLowerCase())
  const visibleOwnEntries=personalStatus==="all"?ownEntries:ownEntries.filter(entry=>entry.status===personalStatus)
  const personalStatusLabel=personalStatuses.find(([status])=>status===personalStatus)?.[1]??"All entries"
  const personalTimesheetView=role==="employee"||role==="contractor"||(role==="manager"&&!permissions.view_team)
  function openPeriodTimesheets(periodId:string):void {
    setInitialTimesheetPeriod(periodId)
    setPersonalStatus("all")
    openWorkspacePage(personalTimesheetView?"personal":"log")
  }

  const accountsContent=<FinalApprovedTimesheets key={`${userEmail??"account"}:${entries.length}`} email={userEmail??""} entries={entries} onUpdated={entry=>{entryReadEpoch.current++;setEntries(previous=>previous.map(current=>current.id===entry.id?entry:current))}}/>
  const assistantPane=accessDenied||!assistantDockOpen?null:<div ref={assistantDockRef} data-assistant-overlay="true" style={{height:assistantHeight,width:assistantWidth||undefined,left:assistantPosition?.left,top:assistantPosition?.top,right:assistantPosition?"auto":12,bottom:assistantPosition?"auto":12,minHeight:"min(18rem, calc(100dvh - 1.5rem))",maxWidth:"calc(100vw - 1.5rem)",maxHeight:"calc(100dvh - 1.5rem)"}} className="fixed z-[60] min-w-0 w-[min(50vw,44rem)] max-sm:w-[calc(100vw-1.5rem)]">
    <div role="separator" aria-label="Resize assistant width" aria-orientation="vertical" aria-valuenow={assistantWidth||undefined} tabIndex={0} onPointerDown={beginAssistantWidthResize} onPointerMove={moveAssistantWidthResize} onPointerUp={endAssistantWidthResize} onPointerCancel={endAssistantWidthResize} onKeyDown={event=>{if(event.key==="ArrowLeft")resizeAssistantWidthByKeyboard(32);if(event.key==="ArrowRight")resizeAssistantWidthByKeyboard(-32)}} className="absolute -left-2 top-1/2 z-10 hidden h-16 w-4 -translate-y-1/2 cursor-ew-resize rounded-full bg-transparent after:absolute after:left-1/2 after:top-1/2 after:h-10 after:w-1 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-emerald-500/50 hover:after:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:block" />
    <div role="separator" aria-label="Resize assistant panel" aria-orientation="horizontal" aria-valuenow={assistantHeight} tabIndex={0} onPointerDown={beginAssistantResize} onPointerMove={moveAssistantResize} onPointerUp={endAssistantResize} onPointerCancel={endAssistantResize} onKeyDown={event=>{if(event.key==="ArrowUp")resizeAssistantHeightByKeyboard(32);if(event.key==="ArrowDown")resizeAssistantHeightByKeyboard(-32)}} className="absolute -top-2 left-1/2 z-10 h-4 w-16 -translate-x-1/2 cursor-ns-resize rounded-full bg-transparent after:absolute after:left-1/2 after:top-1/2 after:h-1 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-emerald-500/50 hover:after:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
    <AssistantPanel organizationName={organizationName} workspaceContext="main" handoffContext={assistantHandoff} onHandoffUsed={()=>setAssistantHandoff("")} onClose={()=>setAssistantDockOpen(false)} onDragStart={beginAssistantDrag} onDragMove={moveAssistantDrag} onDragEnd={endAssistantDrag} docked={!assistantPosition} onToggleDock={()=>{if(assistantPosition){setAssistantPosition(null)}else{const bounds=assistantDockRef.current?.getBoundingClientRect();if(bounds)setAssistantPosition({left:bounds.left,top:bounds.top})}}} onNavigate={(destination,handoff)=>{if(handoff)setAssistantHandoff(handoff);if(destination==="messages")setMessagesOpen(true);else openWorkspacePage(destination as View)}} onRefresh={()=>{setEntriesRefresh(value=>value+1);messageInbox.refresh()}} messageContext={assistantMessageContext} onContextUsed={()=>setAssistantMessageContext("")} onCompose={draft=>{setAssistantCompose(draft);setMessagesOpen(true)}} focusRequest={assistantFocusRequest} onPreferredHeight={height=>{if(!assistantWasManuallyResized.current)setAssistantHeight(current=>current===height?current:height)}}/>
  </div>
  const pageTitle=view==="home"?`${role.replaceAll("_"," ")} dashboard`:view==="period-index"?"Timesheet periods":view==="personal"?`${role==="manager"?"My managerial timesheets":"My timesheets"} · ${personalStatusLabel}`:view==="log"&&(role==="employee"||role==="contractor")?`My timesheets · ${personalStatusLabel}`:view==="log"?(permissions.view_all_timesheets?"Organization timesheets":permissions.view_team?"Team entries":role==="contractor"?"Contractor time submissions":"Employee time entries"):view==="approvals"?"Timesheet approvals":view==="report"||view==="my-report"?"Reports":view==="activity"?"Account activity":view==="permissions"?"Manage employees and contractors":view==="accounts"?"Final approved timesheets":view==="periods"?"Timesheet periods":view==="admin"?adminStartSection==="reports"?"Reports":adminStartSection==="timesheets"?"Timesheets":"Admin dashboard":"Workspace"
  return (
    <WindowAssistantProvider renderAssistant={(workspace,onClose,onPreferredHeight,controls)=><AssistantPanel organizationName={organizationName} workspaceContext={workspace} handoffContext={assistantHandoff} onHandoffUsed={()=>setAssistantHandoff("")} onClose={onClose} {...(controls??{})} onNavigate={(destination,handoff)=>{if(handoff)setAssistantHandoff(handoff);if(destination==="messages")setMessagesOpen(true);else openWorkspacePage(destination as View)}} onRefresh={()=>{setEntriesRefresh(value=>value+1);messageInbox.refresh()}} messageContext="" onContextUsed={()=>{}} onCompose={draft=>{setAssistantCompose(draft);setMessagesOpen(true)}} onPreferredHeight={onPreferredHeight}/> }>
    <main className={`app-workspace tech-surface flex h-dvh min-h-0 w-full min-w-0 flex-col gap-3 ${isTimesheetEntriesView||view==="accounts"?"overflow-hidden":"overflow-x-hidden overflow-y-auto overscroll-y-auto"} bg-background px-3 pb-8 pt-3 sm:px-5 md:pt-4`}>
      {syncError&&<div role="alert" className="fixed right-4 top-4 z-[160] flex w-[min(36rem,calc(100vw-2rem))] items-start gap-3 border border-red-300 bg-white px-4 py-3 text-sm text-red-950 shadow-xl"><span className="min-w-0 flex-1 break-words">{syncError}</span>{issueContext&&<Button type="button" variant="outline" size="sm" className="h-7 shrink-0 border-orange-300 bg-orange-50 px-2 text-orange-900 hover:bg-orange-100" onClick={()=>setIssueReportOpen(true)}>Report to admins</Button>}<button type="button" aria-label="Dismiss error message" title="Dismiss error message" onClick={()=>setSyncError(null)} className="grid size-7 shrink-0 place-items-center rounded border border-red-200 text-red-800 hover:bg-red-50"><X className="size-4"/></button></div>}
      {issueReportOpen&&issueContext&&<IssueReportWindow context={issueContext} onClose={()=>{setIssueReportOpen(false);setIssueContext(null)}}/>}
      {!accessDenied&&messagesOpen&&<WindowSurface title="Messages" onBack={()=>setMessagesOpen(false)}><section className="min-h-0 w-full overflow-auto bg-background p-3 sm:p-5"><MessagesPanel inbox={messageInbox} encryption={messageEncryption} canSend={permissions.send_messages} canBroadcast={role==="admin"||role==="manager"} initialAnnouncement={announcementCompose} onAnnouncementComposeConsumed={()=>setAnnouncementCompose(false)} initialDraft={assistantCompose} onDraftConsumed={()=>setAssistantCompose(null)} onExplainMessage={text=>{setAssistantMessageContext(text);setMessagesOpen(false);focusAssistant()}}/></section></WindowSurface>}
      <header className="workspace-header flex flex-col gap-2 border-b border-border pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><Brand/><span aria-hidden="true" className="hidden h-5 border-l border-orange-200 sm:block"/><h1 className="text-base font-semibold text-slate-900">{role === "admin" ? "Technology management" : role === "account_manager" ? "Final timesheet approvals" : role === "manager" ? "Manager workspace" : role === "contractor" ? "Contractor workspace" : "Employee workspace"}</h1></div>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {!accessDenied&&<Button variant="outline" size="icon-lg" aria-label={`Go to ${organizationName} assistant`} title={`Go to ${organizationName} assistant`} onClick={focusAssistant}><Sparkles className="size-5"/></Button>}
            {!accessDenied&&<MessageNotifications inbox={messageInbox} onOpen={()=>setMessagesOpen(true)} messagesOpen={messagesOpen} canCreateAnnouncement={permissions.send_messages&&(role==="admin"||role==="manager")} onCreateAnnouncement={()=>{setAnnouncementCompose(true);setMessagesOpen(true)}} onManagePeriods={permissions.manage_timesheet_periods?()=>role==="account_manager"?setAccountManagerTool("periods"):openWorkspacePage("admin","timesheets"):undefined}/>}
            {!accessDenied&&<WorkspaceUtilities unread={messageInbox.unread} onMessages={()=>setMessagesOpen(true)}/>}
            <AccountProfile
              email={userEmail}
              fallbackName={userName}
              role={roleLabel}
            />
            <SignOutButton />
          </div>
        </div>
      </header>

      {!accessDenied && <nav aria-label="Workspaces" className="flex flex-wrap gap-2 border-b pb-3">
          {role==="admin" ? <>
          {view==="admin"&&adminStartSection==="landing"&&permissions.create_entries&&<Button className="border border-orange-800 bg-orange-700 font-semibold text-white shadow-sm hover:bg-orange-800" onClick={()=>setWorkspaceWindow("ai-extract")}><Sparkles className="size-4"/>Extract timesheet with AI<ArrowRight className="size-4"/></Button>}
          <Button variant="outline" onClick={()=>openWorkspacePage("admin","admin")}><ShieldCheck className="size-4"/>Admin</Button>
          <Button variant="outline" onClick={()=>openWorkspacePage("admin","reports")}><BarChart3 className="size-4"/>Reports</Button>
          <Button variant="outline" onClick={()=>openWorkspacePage("admin","timesheets")}><Layers3 className="size-4"/>Timesheets</Button>
          {permissions.manage_projects&&<Button variant="outline" onClick={()=>setWorkspaceWindow("projects")}><FolderKanban className="size-4"/>Projects</Button>}
        </> : <>
          {role!=="account_manager"&&<Button variant="outline" onClick={()=>openWorkspacePage("period-index")}><Layers3 className="size-4"/>Timesheets</Button>}
          {role==="manager"&&<Button variant="outline" onClick={()=>openWorkspacePage("personal")}><Clock3 className="size-4"/>My timesheets</Button>}
          {(canReviewEntries||canAIReview)&&<Button variant="outline" onClick={()=>openWorkspacePage("approvals")}><CheckCircle2 className="size-4"/>Approvals</Button>}
          {role==="account_manager"&&permissions.view_all_timesheets&&<Button variant="outline" onClick={()=>openWorkspacePage("period-index")}><Layers3 className="size-4"/>Timesheets</Button>}
          {role==="account_manager"&&permissions.view_accounts&&<Button variant="outline" onClick={()=>openWorkspacePage("accounts")}><ShieldCheck className="size-4"/>Final timesheets</Button>}
          {(role==="account_manager"||role==="manager")&&(permissions.review_entries||role==="manager"&&permissions.submit_entries)&&<Button variant="outline" onClick={()=>setExtensionPanelOpen(true)}><Timer className="size-4"/>{role==="manager"&&permissions.submit_entries&&!permissions.review_entries?"Request extension":"Extensions"}</Button>}
          <Button variant="outline" onClick={()=>openWorkspacePage(canViewTeamReports?"report":"my-report")}><BarChart3 className="size-4"/>{canViewTeamReports?"Reports":"My report"}</Button>
          {canViewAdmin&&<Button variant="outline" onClick={()=>openWorkspacePage("admin","admin")}><ShieldCheck className="size-4"/>Admin</Button>}
          {permissions.view_personal_reports&&role==="contractor"&&<Button variant="outline" onClick={()=>openWorkspacePage("activity")}><Activity className="size-4"/>Account activity</Button>}
          {permissions.delegate_permissions&&role==="manager"&&<Button variant="outline" onClick={()=>openWorkspacePage("permissions")}><KeyRound className="size-4"/>Manage team access</Button>}
          {(permissions.manage_projects||permissions.create_projects)&&<Button variant="outline" onClick={()=>setWorkspaceWindow("projects")}><FolderKanban className="size-4"/>{permissions.manage_projects?"Projects":"My projects"}</Button>}
        </>}
      </nav>}
      {!accessDenied&&!(view==="log"||view==="personal"||view==="period-index"||(view==="admin"&&adminStartSection==="timesheets"))&&<SubmissionDeadlineNotice/>}
      {lifecycleOpen&&!accessDenied&&(canViewAdmin||(role==="manager"&&permissions.delegate_permissions))&&<WindowSurface title={canViewAdmin?"Access lifecycle":"Temporary coverage"} onBack={()=>setLifecycleOpen(false)}><section className="min-h-0 w-full overflow-auto bg-white"><AccessLifecyclePanel key={role} admin={canViewAdmin} permissions={permissions}/></section></WindowSurface>}
      {canViewAdmin && technologyReports && <SecurityRiskWindow onClose={() => setTechnologyReports(false)} />}
      {!accessDenied&&extensionPanelOpen&&((role==="account_manager"||role==="manager")&&permissions.review_entries||((role==="employee"||role==="contractor"||role==="manager")&&permissions.submit_entries))&&<SubmissionExtensionPanel reviewer={(role==="account_manager"||role==="manager")&&permissions.review_entries} canRequest={permissions.submit_entries&&(role==="employee"||role==="contractor"||role==="manager")} requesterRole={role==="manager"?"manager":role==="employee"?"employee":"contractor"} onClose={()=>{setExtensionPanelOpen(false);setEntriesRefresh(value=>value+1)}}/>}

      {!accessDenied&&workspaceWindow&&<WindowSurface title={workspaceWindow==="notes"?"Create timesheet entries":workspaceWindow==="ai-extract"?"Extract timesheet with AI":workspaceWindow==="projects"?(permissions.manage_projects?role==="manager"?"My projects and team assignments":"Organization projects and assignments":"My projects"):workspaceWindow==="overview"?"Workspace overview":"Workflow totals"} onBack={()=>setWorkspaceWindow(null)} compact={workspaceWindow!=="notes"&&workspaceWindow!=="ai-extract"}><section className={"flex min-h-0 w-full flex-col bg-white "+(workspaceWindow==="notes"||workspaceWindow==="ai-extract"||workspaceWindow==="projects"?"max-w-none":"mx-auto max-w-6xl")}><div className="min-h-0 flex-1 overflow-auto p-4">
      {workspaceWindow==="projects"?(permissions.manage_projects||permissions.create_projects?<ProjectManagement fullWidth canManage={permissions.manage_projects} canCreate={permissions.manage_projects||permissions.create_projects} organizationWide={role==="admin"||role==="account_manager"}/>:<p role="status" className="m-4 border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">Project access was updated. Returning to your available workspace…</p>):workspaceWindow==="overview"?<RoleOverview role={role}/>:workspaceWindow==="notes"||workspaceWindow==="ai-extract"?(permissions.create_entries?<NoteInput canCreateProjects={permissions.create_projects} initialMode={workspaceWindow==="ai-extract"?"notes":"manual"} onParsed={async (parsed,periodId)=>{await addParsed(parsed,periodId);setWorkspaceWindow(null);if(role!=="admin"||view!=="admin")openWorkspacePage(role==="manager"?"personal":"log")}}/>:<p role="status" className="m-4 border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">Time-entry access was updated. Returning to your available workspace…</p>):<WorkflowOverview
        approvedCount={approvedEntries.length}
        draftCount={draftEntries.length}
        pendingCount={pendingEntries.length}
        rejectedCount={rejectedEntries.length}
        role={role}
      />}
      </div></section></WindowSurface>}
      {!accessDenied&&role==="account_manager"&&accountManagerTool&&(accountManagerTool==="periods"?permissions.manage_timesheet_periods:permissions.manage_projects)&&<WindowSurface title={accountManagerTool==="periods"?"Timesheet periods and submission windows":"Projects and workforce assignments"} onBack={()=>setAccountManagerTool(null)}><section className={accountManagerTool==="periods"?"flex h-full min-h-0 w-full flex-col overflow-hidden bg-white":"min-h-0 w-full overflow-auto bg-white"}>{accountManagerTool==="periods"?<div className="flex min-h-0 flex-1 flex-col p-3 sm:p-5"><SubmissionDeadlineSettings defaultOpen/></div>:<ProjectManagement fullWidth canManage={permissions.manage_projects} canCreate={permissions.manage_projects} organizationWide/>}</section></WindowSurface>}
      {!accessDenied&&reviewerHelp&&role==="manager"&&permissions.request_review_help&&permissions.delegate_permissions&&permissions.send_messages&&<ReviewerHelpDialog entries={reviewerHelp} email={userEmail??""} encryption={messageEncryption} onClose={()=>setReviewerHelp(null)} onComplete={()=>{setReviewerHelp(null);messageInbox.refresh();setEntriesRefresh(value=>value+1)}}/>}
      {suggestedReview && <EntryReviewDialog entry={suggestedReview.entry} decision={suggestedReview.decision} initialNote={suggestedReview.reason} onCancel={() => setSuggestedReview(null)} onConfirm={async note => {
        await changeEntryStatus(suggestedReview.entry.id,suggestedReview.decision,note || undefined,suggestedReview.entry.revision)
        setSuggestedReview(null)
      }} />}
      {accessDenied && <p role="alert">Access is unavailable. Contact your administrator.</p>}
      {view === "admin" ? (
        <WorkspacePageSurface open={false} title={pageTitle} onBack={closeWorkspacePage}><AdminPanel initialSection={adminStartSection==="landing"?undefined:adminStartSection} onExit={closeWorkspacePage} role={role} entries={entries} pendingEntries={pendingEntries} userEmail={userEmail??""} onEntryUpdate={updateEntry} onEntryStatusChange={changeEntryStatus} onEntryDelete={deleteEntry} onEntryClear={clearEntries} onPreviewDataReset={startPreviewDataReset} onRefreshEntries={()=>setEntriesRefresh(value=>value+1)} onOpenEntryCapture={()=>setWorkspaceWindow("notes")} onApprovalUpdated={entry=>{entryReadEpoch.current++;setEntries(previous=>previous.map(current=>current.id===entry.id?entry:current))}} canCreateEntries={permissions.create_entries} canEditEntries={permissions.edit_entries} canDeleteEntries={permissions.delete_entries} canClearEntries={canClearVisibleEntries} canReviewEntries={canReviewEntries} canAIReview={canAIReview} canSubmitEntries={canSubmitEntries} canExportEntries={permissions.export_entries} canManagePeriods={permissions.manage_timesheet_periods} openRequest={directoryRequest} reportContent={<ManagerReport entries={entries} stateKey={`admin-report:${userEmail?.toLowerCase()??"user"}`}/>} onSecurity={()=>setTechnologyReports(true)} onLifecycle={()=>setLifecycleOpen(true)} /></WorkspacePageSurface>
      ) : view === "permissions" && role === "admin" ? (
        <WorkspacePageSurface open={false} title={pageTitle} onBack={closeWorkspacePage}><AdminPanel onExit={closeWorkspacePage} role={role} entries={entries} pendingEntries={pendingEntries} userEmail={userEmail??""} onEntryUpdate={updateEntry} onEntryStatusChange={changeEntryStatus} onEntryDelete={deleteEntry} onEntryClear={clearEntries} onPreviewDataReset={startPreviewDataReset} onRefreshEntries={()=>setEntriesRefresh(value=>value+1)} onOpenEntryCapture={()=>setWorkspaceWindow("notes")} onApprovalUpdated={entry=>{entryReadEpoch.current++;setEntries(previous=>previous.map(current=>current.id===entry.id?entry:current))}} canCreateEntries={permissions.create_entries} canEditEntries={permissions.edit_entries} canDeleteEntries={permissions.delete_entries} canClearEntries={canClearVisibleEntries} canReviewEntries={canReviewEntries} canAIReview={canAIReview} canSubmitEntries={canSubmitEntries} canExportEntries={permissions.export_entries} canManagePeriods={permissions.manage_timesheet_periods} rightsOnly openRequest={directoryRequest} reportContent={<ManagerReport entries={entries}/>} onSecurity={()=>setTechnologyReports(true)} onLifecycle={()=>setLifecycleOpen(true)} /></WorkspacePageSurface>
      ) : <WorkspacePageSurface open={pageWindow} title={pageTitle} onBack={closeWorkspacePage}><div className={`flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-stretch gap-2 ${(isTimesheetEntriesView||view==="period-index"||view==="accounts")?"overflow-hidden":"overflow-y-auto"}`}>
        <div className={`flex min-w-0 flex-col ${isTimesheetEntriesView||view==="period-index"||view==="accounts"?"min-h-0 flex-1 gap-2":"gap-4"}`}>
          {view==="home"&&(role==="contractor"||role==="employee"||role==="manager"||role==="account_manager")&&<RoleWorkspaceHome
            role={role}
            entries={entries.filter(entry=>entry.ownerEmail?.toLowerCase()===userEmail?.toLowerCase())}
            teamEntries={role==="manager"?entries.filter(entry=>entry.ownerEmail?.toLowerCase()!==userEmail?.toLowerCase()):[]}
            pending={pendingEntries.length}
            canCreate={permissions.create_entries}
            canReview={canReviewEntries||canAIReview}
            canReports={canViewTeamReports}
            canExport={permissions.export_entries}
            canManageProjects={permissions.manage_projects}
            canCreateProjects={permissions.create_projects}
            canManageAccess={permissions.delegate_permissions}
            canViewActivity={permissions.view_personal_reports}
            canManagePeriods={permissions.manage_timesheet_periods}
            canViewAllTimesheets={permissions.view_all_timesheets}
            canViewAccounts={permissions.view_accounts}
            canRequestExtension={role==="manager"&&permissions.submit_entries}
            onTimesheets={()=>openWorkspacePage(role==="manager"?"personal":"period-index")}
            onReviews={()=>openWorkspacePage("approvals")}
            onLogTime={()=>setWorkspaceWindow("ai-extract")}
            onReport={()=>openWorkspacePage(canViewTeamReports?"report":"my-report")}
            onProjects={()=>setWorkspaceWindow("projects")}
            onTeamAccess={()=>openWorkspacePage("permissions")}
            onActivity={()=>openWorkspacePage("activity")}
            onPeriodSettings={()=>setAccountManagerTool("periods")}
            onFinalApprovals={()=>openWorkspacePage("accounts")}
            onRequestExtension={()=>setExtensionPanelOpen(true)}
          />}
          {view!=="home"&&<>
          {savedStatus&&!syncError&&<p role="status" className="border-y border-green-200 bg-green-50 px-4 py-2 text-sm text-green-900">{savedStatus}</p>}
          {loadingEntries && <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground" role="status">Loading saved entries...</div>}

      {view==="period-index"&&<TimesheetPeriodLanding entries={personalTimesheetView?ownEntries:entries} onSelect={openPeriodTimesheets} canCreate={permissions.create_entries} canRequestExtension={permissions.submit_entries} personalReadiness={role==="contractor"} role={role} onLogTime={()=>setWorkspaceWindow("notes")} onRefresh={()=>setEntriesRefresh(value=>value+1)} onRequestExtension={()=>setExtensionPanelOpen(true)}/>}

      {view === "log" || view === "personal" ? (
        <>
        {isPersonalEntriesView&&<section aria-label={`${personalStatusLabel} timesheet workspace`} className="mb-0 w-full border-b border-orange-200 bg-gradient-to-r from-orange-50 via-sky-50 to-emerald-50 px-2 py-1 sm:px-3">
          <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200/80 pb-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2"><p className="text-[10px] font-semibold uppercase text-orange-800">{role==="contractor"?"Contractor timesheets":role==="manager"?"Manager personal timesheets":"Employee timesheets"}</p><h2 className="text-base font-semibold text-slate-950">{personalStatusLabel}</h2><p className="text-[11px] text-slate-600">Your entries, submissions, search and history.</p></div>
            <div className="flex flex-wrap gap-1.5">
              {permissions.create_entries&&<Button className="h-7 px-2.5" size="sm" onClick={()=>setWorkspaceWindow("notes")}><Pencil className="size-3.5"/>{role==="contractor"?"Log project time":"Log time"}</Button>}
              <Button className="h-7 px-2.5" size="sm" variant="outline" onClick={()=>setEntriesRefresh(value=>value+1)}><Activity className="size-3.5"/>Refresh</Button>
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 py-1">
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Timesheet summary">
              <div className="flex items-center gap-2 border-l-2 border-orange-500 bg-white/70 px-2 py-0.5"><p className="text-[10px] text-slate-600">Entries</p><p className="text-xs font-semibold tabular-nums">{visibleOwnEntries.length}</p></div>
              <div className="flex items-center gap-2 border-l-2 border-blue-500 bg-white/70 px-2 py-0.5"><p className="text-[10px] text-slate-600">Hours</p><p className="text-xs font-semibold tabular-nums">{visibleOwnEntries.reduce((sum,entry)=>sum+Number(entry.hours||0),0).toLocaleString(undefined,{maximumFractionDigits:2})}h</p></div>
              <div className="flex items-center gap-2 border-l-2 border-emerald-500 bg-white/70 px-2 py-0.5"><p className="text-[10px] text-slate-600">Projects</p><p className="text-xs font-semibold tabular-nums">{new Set(visibleOwnEntries.map(entry=>entry.project)).size}</p></div>
              <div className="flex items-center gap-2 border-l-2 border-violet-500 bg-white/70 px-2 py-0.5"><p className="text-[10px] text-slate-600">Latest work</p><p className="truncate text-[11px] font-semibold">{visibleOwnEntries.map(entry=>entry.date).sort().at(-1)??"No entries"}</p></div>
            </div>
            <nav aria-label="My timesheet views" className="ml-auto flex flex-wrap gap-1">
              {personalStatuses.map(([status,label])=><Button key={status} className="h-7 gap-1 px-2 text-xs" size="sm" variant={personalStatus===status?"default":"outline"} aria-pressed={personalStatus===status} onClick={()=>setPersonalStatus(status)}>{label}<span className="tabular-nums">{status==="all"?ownEntries.length:ownEntries.filter(entry=>entry.status===status).length}</span></Button>)}
            </nav>
          </div>
        </section>}
        <EntriesLog
          stateKey={`${userEmail?.toLowerCase()??"user"}:${view}`}
          refreshKey={entriesRefresh}
          showPatronBulkActions={role==="employee"||role==="contractor"||role==="account_manager"}
          userEmail={userEmail ?? undefined}
          submissionDestination={role==="account_manager"?"self":role==="manager"?"account_manager":"manager"}
          canRequestReview={role==="manager"&&permissions.request_review_help&&permissions.delegate_permissions&&permissions.send_messages}
          onRequestReview={setReviewerHelp}
          entries={view==="personal"?entries.filter(entry=>entry.ownerEmail?.toLowerCase()===userEmail?.toLowerCase()&&(personalStatus==="all"||entry.status===personalStatus)):(role === "employee" || role === "contractor") && personalStatus !== "all" ? entries.filter(entry => entry.status === personalStatus) : entries}
          onUpdate={updateEntry}
          onStatusChange={changeEntryStatus}
          onDelete={deleteEntry}
          onClear={clearEntries}
          canClear={view!=="personal"&&canClearVisibleEntries}
          canReview={false}
          canSubmit={canSubmitEntries}
          readOnlyArchivedForOwner={role==="employee"||role==="contractor"}
          canSubmitOthers={role==="manager"&&view==="log"}
          periodView={view==="log"||view==="personal"}
          initialPeriodSelection={initialTimesheetPeriod}
          hideHeader={view==="personal"&&role==="contractor"}
          canExport={permissions.export_entries}
          canEdit={permissions.edit_entries}
          canDelete={permissions.delete_entries}
          deleteOwnOnly={role==="manager"}
          description={
            permissions.view_team
              ? "Review, edit, and manage team entries for your role."
              : "Review, edit, and submit your own saved time entries."
          }
          title={view==="personal"?role==="manager"?"My managerial time — independent review required":role==="contractor"?"My contractor timesheets":"My employee timesheets":permissions.view_all_timesheets?"Organization timesheets":permissions.view_team ? "Team entries" : role==="contractor"?"Contractor time submissions":"Internal employee time"}
        />
        </>
      ) : view === "approvals" ? (
        role==="account_manager"? <section aria-label="Approval workspace" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><div className="min-h-0 flex-1 overflow-auto p-3"><section aria-label="Direct account-manager approvals" className="mb-4 border-l-4 border-blue-500 bg-blue-50/60 px-3 py-2"><h2 className="text-sm font-semibold">Direct account-manager approvals</h2><p className="mb-2 text-xs text-muted-foreground">Manager personal timesheets come here for final review. Existing direct assignments are also kept visible; manager-approved workforce batches are in the handoff queue below.</p>{pendingEntries.length?<ApprovalSelection entries={pendingEntries} email={userEmail??""} canReview={canReviewEntries} canAI={canAIReview} allowSelfApproval finalApprover onUpdated={entry=>{entryReadEpoch.current++;setEntries(previous=>previous.map(current=>current.id===entry.id?entry:current))}}/>:<p className="py-2 text-sm text-muted-foreground">No direct submissions are awaiting review.</p>}</section><div className="min-h-[50dvh]"><BusinessAccounts canSend={false} canReview={permissions.review_accounts&&permissions.review_entries} canAI={permissions.ai_accounts} canAuthorize={permissions.authorize_payouts} onManagePeriods={permissions.manage_timesheet_periods?()=>setAccountManagerTool("periods"):undefined} onManageProjects={permissions.manage_projects?()=>setAccountManagerTool("projects"):undefined} onDataChanged={()=>setEntriesRefresh(value=>value+1)}/></div></div></section> : <section aria-label="Approval workspace" className="min-w-0 space-y-4">
        {role==="manager"&&<div className="flex flex-wrap items-center justify-between gap-2 border-y border-red-200 bg-red-50/60 px-3 py-2"><div><h2 className="text-sm font-semibold text-red-950">Manager review archive</h2><p className="text-xs text-red-900">Rejection decisions and return reasons, searchable and grouped by person or date.</p></div><ManagerRejectionArchive/></div>}
        {(canReviewEntries||canAIReview||canViewTeamReports)&&<ManagerWorkspace canReview={canReviewEntries} canReports={canViewTeamReports} canAI={canAIReview} pending={pendingEntries.length} entries={pendingEntries} onApprovals={()=>{}} onReports={()=>openWorkspacePage("report")} onRecommendation={(entry,decision,reason)=>setSuggestedReview({entry,decision,reason})}/>}
        {pendingEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <p className="text-sm font-medium">No entries waiting for approval</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Submitted time will appear here for manager review.
            </p>
          </div>
        ) : canReviewEntries ? (
          <ApprovalSelection entries={pendingEntries} email={userEmail??""} canReview={canReviewEntries} canAI={canAIReview} onUpdated={entry=>{entryReadEpoch.current++;setEntries(previous=>previous.map(current=>current.id===entry.id?entry:current))}}/>
        ) : (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">You can view these submitted timesheets but do not have the approval permission needed to decide them.</p>
        )
        }
        </section>
      ) : view === "report" ? (
        <section aria-label="Reports" className="min-w-0 space-y-3">
          <header className="border-y border-orange-200 bg-orange-50 px-4 py-3">
            <h2 className="font-semibold text-orange-950">Reports</h2>
            <p className="text-xs text-orange-900">Organized summaries and analysis of timesheet activity. Open Timesheets for individual source entries.</p>
          </header>
          <ManagerReport entries={entries} stateKey={`team-report:${userEmail?.toLowerCase()??"user"}`}/>
        </section>
      ) : view === "my-report" ? (
        <section aria-label="My timesheet report" className="min-w-0 space-y-3"><header className="border-y border-blue-200 bg-gradient-to-r from-blue-50 via-white to-orange-50 px-4 py-3"><h2 className="font-semibold text-blue-950">My timesheet analytics</h2><p className="text-xs text-blue-900">Search, group, compare dates, and export a report limited to your own timesheet records.</p></header><ManagerReport entries={ownEntries} stateKey={`personal-report:${userEmail?.toLowerCase()??"user"}`}/></section>
      ) : view === "activity" ? (
        <PatronAccountActivity/>
      ) : view === "accounts" ? (
        <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white p-2 sm:p-3">{role==="account_manager"&&permissions.manage_timesheet_periods&&<div className="shrink-0"><PeriodExpirationNotice onManage={()=>setAccountManagerTool("periods")}/></div>}<div className="min-h-0 flex-1 overflow-hidden">{accountsContent}</div></section>
      ) : view === "periods" ? (
        <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white p-3 sm:p-5"><header className="mb-3 shrink-0 border-b border-orange-200 bg-orange-50 px-4 py-3"><h2 className="font-semibold text-orange-950">Timesheet periods</h2><p className="text-sm text-orange-900">Create new work-date ranges or edit and save existing periods. New periods become the current view when their dates begin; older timesheets remain archived and retrievable.</p></header><SubmissionDeadlineSettings defaultOpen/></section>
      ) : view === "messages" ? (
        <MessagesPanel inbox={messageInbox} canSend={permissions.send_messages} canBroadcast={role==="admin"||role==="manager"}/>
      ) : view === "permissions" ? (
        <EmployeeRightsPanel permissions={permissions} />
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 text-sm text-slate-700">This workspace is unavailable for the current role.</div>
      )}
          </>}
        </div>
      </div></WorkspacePageSurface>}
      {assistantPane}
      <div aria-hidden="true" className="h-9 shrink-0" />
      <footer className="fixed inset-x-0 bottom-0 z-30 flex min-h-9 items-center justify-center border-t border-sky-300 bg-white/95 px-3 py-2 text-center text-xs text-slate-700 shadow-[0_-3px_12px_rgb(2_132_199_/_0.08)] backdrop-blur-sm">
        {entries.length} entries ·{" "}
        {totalHours.toLocaleString(undefined, { maximumFractionDigits: 2 })}h logged
        total · {approvedEntries.length} approved
      </footer>
      {clearEntriesConfirmationOpen && <WindowSurface title={clearEntriesScope==="preview_reset"?"Reset preview data":"Confirm clearing all timesheets"} compact resizable assistant={false} disabled={clearEntriesBusy} onBack={() => setClearEntriesConfirmationOpen(false)}>
        <section className="flex w-full max-w-xl flex-col bg-white text-slate-950">
          <header className="flex items-start gap-3 border-b border-red-200 bg-red-50 p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-red-700" aria-hidden="true" />
            <div><h2 className="font-semibold text-red-950">Microsoft verification complete</h2><p className="mt-1 text-sm text-red-900">You reauthenticated as {userEmail}. {clearEntriesScope==="preview_reset"?"This action is available only on a Vercel Preview deployment connected to a database explicitly marked as preview.":"Confirm only if you intend to permanently clear all entries visible to this administrator account."}</p></div>
          </header>
          <div className="space-y-3 p-4 text-sm">{clearEntriesScope==="preview_reset"?<><p>This permanently clears preview timesheets, rejection history, audit/authentication events, security reports, AI activity, and deadline reminders. It preserves patrons, active sessions, configured periods, messages, and finance handoff snapshots. One audit record will document this reset. Nothing runs automatically during deployment.</p><label className="block text-xs font-medium text-red-950">Type RESET PREVIEW DATA to enable the reset<input value={previewResetPhrase} onChange={event=>setPreviewResetPhrase(event.target.value)} autoComplete="off" className="mt-1 h-10 w-full rounded-md border border-red-300 bg-white px-3 text-sm" /></label></>:<p>This action cannot be undone. It deletes all source timesheet entries while preserving audit/security logs, patrons, configured periods, and finance handoff snapshots. {entries.length} entries are currently loaded. Cancel leaves all data unchanged.</p>}</div>
          <footer className="flex justify-end gap-2 border-t p-4">
            <Button variant="outline" disabled={clearEntriesBusy} onClick={() => setClearEntriesConfirmationOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={clearEntriesBusy || !permissionsLoaded || !canClearVisibleEntries || (clearEntriesScope==="preview_reset"&&previewResetPhrase!=="RESET PREVIEW DATA")} onClick={() => void confirmClearEntries()}><Trash2 className="size-4" />{clearEntriesBusy ? "Clearing..." : !permissionsLoaded ? "Checking access..." : clearEntriesScope==="preview_reset"?"Reset preview data":"Clear all entries"}</Button>
          </footer>
        </section>
      </WindowSurface>}
    </main>
    </WindowAssistantProvider>
  )
}

/**
 * Opens role content in a complete nested window only when navigation requests it.
 * The non-window path preserves the original landing-page layout.
 * @param props.open - Whether the content should occupy a full-screen work window.
 * @param props.title - Accessible page-window title.
 * @param props.onBack - Returns to the parent command group or role home.
 * @param props.children - Complete role page content, including its authorized actions.
 * @returns The content inline or inside a full-screen application window.
 */
function WorkspacePageSurface({open,title,onBack,children}:{open:boolean;title:string;onBack:()=>void;children:ReactNode}) {
  return open?<WindowSurface title={title} onBack={onBack}>{children}</WindowSurface>:<>{children}</>
}

/**
 * Shows the active role and what that role can do.
 *
 * The panel is intentionally informational: it helps the signed-in user understand
 * why they see a personal log, team report, or admin controls. Permission checks
 * remain enforced in the API layer.
 *
 * @param props - Component props.
 * @param props.role - Effective role for the signed-in user.
 * @returns A role summary panel.
 */
function RoleOverview({ role }: { role: UserRole }) {
  const content = {
    account_manager: {
      title: "Final hours approval",
      body: "Review manager-approved time, resolve evidence checks, and record finance eligibility. Every decision is human-confirmed and audited; this workspace does not move money.",
    },
    admin: {
      title: "Admin access",
      body: "Manage technology access and review operational work. Manager timesheets require an authorized account manager.",
    },
    manager: {
      title: "Manager access",
      body: "You can review submitted time, approve or reject entries, and build team reports.",
    },
    employee: {
      title: "Employee access",
      body: "You can create, edit, and submit your own time entries for manager approval.",
    },
    contractor: {
      title: "Contractor access",
      body: "You can create and submit your own time entries for review.",
    },
  }[role]

  return (
    <section className="border-l-2 border-primary bg-card px-4 py-2">
      <p className="text-sm font-medium">{content.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{content.body}</p>
    </section>
  )
}

/**
 * Shows a compact status dashboard for the current role's visible entries.
 *
 * Counts are derived from the same entry list used by the active table and report
 * views, so employees see their own progress while managers see team workflow load.
 *
 * @param props - Workflow summary counts and current user role.
 * @param props.approvedCount - Number of visible approved entries.
 * @param props.draftCount - Number of visible draft entries.
 * @param props.pendingCount - Number of visible submitted entries.
 * @param props.rejectedCount - Number of visible rejected entries.
 * @param props.role - Effective role for the signed-in user.
 * @returns A role-aware workflow status summary.
 */
function WorkflowOverview({
  approvedCount,
  draftCount,
  pendingCount,
  rejectedCount,
  role,
}: {
  approvedCount: number
  draftCount: number
  pendingCount: number
  rejectedCount: number
  role: UserRole
}) {
  const reviewLabel =
    role === "admin" || role === "manager"
      ? "Waiting for your review"
      : "Waiting for manager review"

  const items = [
    { label: "Draft", value: draftCount, icon: ListChecks },
    { label: reviewLabel, value: pendingCount, icon: Send },
    { label: "Approved", value: approvedCount, icon: CheckCircle2 },
    { label: "Rejected", value: rejectedCount, icon: XCircle },
  ]

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className="border-b border-border bg-card px-3 py-3"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon className="size-3.5" aria-hidden="true" />
            <span>{label}</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            {value}
          </p>
        </div>
      ))}
    </section>
  )
}

/**
 * Shows administrators the users known to the app and access configuration.
 *
 * The panel combines environment configuration, admin-managed access rows, and
 * observed product activity. It orders people by seniority and forces role or
 * permission edits through an explicit editor window and Save action.
 *
 * @param props - Admin panel props.
 * @param props.role - Effective role for the signed-in user.
 * @returns The administrator user directory panel, or null for non-admin roles.
 */
function AdminPanel({ role, entries, pendingEntries, userEmail, onEntryUpdate, onEntryStatusChange, onEntryDelete, onEntryClear,onPreviewDataReset, onRefreshEntries, onOpenEntryCapture, onApprovalUpdated, canCreateEntries, canEditEntries, canDeleteEntries, canClearEntries, canReviewEntries, canAIReview, canSubmitEntries, canExportEntries, canManagePeriods, rightsOnly = false,initialSection,onExit,openRequest = 0,reportContent,onSecurity,onLifecycle }: { role: UserRole; entries:TimeEntry[]; pendingEntries:TimeEntry[]; userEmail:string; onEntryUpdate:(id:string,patch:Partial<TimeEntry>,revision?:string)=>void|Promise<void>; onEntryStatusChange:(id:string,status:EntryStatus,note?:string,revision?:string,manager?:string)=>Promise<void>; onEntryDelete:(id:string)=>void; onEntryClear:()=>void; onPreviewDataReset:()=>void; onRefreshEntries:()=>void; onOpenEntryCapture:()=>void; onApprovalUpdated:(entry:TimeEntry)=>void; canCreateEntries:boolean; canEditEntries:boolean; canDeleteEntries:boolean; canClearEntries:boolean; canReviewEntries:boolean; canAIReview:boolean; canSubmitEntries:boolean; canExportEntries:boolean; canManagePeriods:boolean; rightsOnly?: boolean;initialSection?:"admin"|"reports"|"timesheets";onExit?:()=>void;openRequest?:number;reportContent?:ReactNode;onSecurity?:()=>void;onLifecycle?:()=>void }) {
  const [users, setUsers] = useState<AdminDirectoryUser[]>([])
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([])
  const [allActivityEvents, setAllActivityEvents] = useState<AdminAuditEvent[]>([])
  const [operationalEvents,setOperationalEvents]=useState<AdminAuditEvent[]>([])
  const [operationalCursor,setOperationalCursor]=useState<{occurredAt:string;id:string}|null>(null)
  const [operationalFilters,setOperationalFilters]=useState<OperationalFilters>({search:"",from:"",through:"",category:"",status:""})
  const [auditFilters,setAuditFilters]=useState<OperationalFilters>({search:"",from:"",through:"",category:"",status:""})
  const [activityCursor,setActivityCursor]=useState<{occurredAt:string;id:string}|null>(null)
  const [activityLoadingMore,setActivityLoadingMore]=useState(false)
  const [activityWindowOpen, setActivityWindowOpen] = useState(false)
  const [activityReport,setActivityReport]=useState<AdminAuditReport|null>(null)
  const [directoryOpen,setDirectoryOpen] = useState(rightsOnly)
  const [adminSection,setAdminSection] = useState<"admin"|"reports"|"timesheets"|null>(initialSection??null)
  const [adminSectionHistory,setAdminSectionHistory]=useState<Array<"admin"|"reports"|"timesheets"|null>>([])
  const [adminTimesheetTool,setAdminTimesheetTool]=useState<"periods"|"entries"|null>(null)
  const [reviewQueueOpen,setReviewQueueOpen]=useState(false)
  const [timesheetAboutOpen,setTimesheetAboutOpen]=useState(false)
  const [adminPeriodSelection,setAdminPeriodSelection]=useState("current")
  const [adminPeriodSearch,setAdminPeriodSearch]=useState("")
  const [adminPeriodStateFilter,setAdminPeriodStateFilter]=useState("all")
  const [snapshotProjectSearch,setSnapshotProjectSearch]=useState("")
  const [snapshotManagerSearch,setSnapshotManagerSearch]=useState("")
  const [adminPeriods,setAdminPeriods]=useState<Array<{id:string;name:string;startDate:string;endDate:string}>>([])
  const [adminPeriodsLoading,setAdminPeriodsLoading]=useState(false)
  const [adminPeriodsError,setAdminPeriodsError]=useState("")
  const [adminReportOpen,setAdminReportOpen]=useState(false)
  const [adminIssuesOpen,setAdminIssuesOpen]=useState(false)
  const [issueSummary,setIssueSummary]=useState({open:0,urgent:0,uniqueErrors:0})
  const [assistantRunsOpen,setAssistantRunsOpen]=useState(false)
  const [patronSearch,setPatronSearch]=useState("")
  const [patronRoleFilter,setPatronRoleFilter]=useState("all")
  const [patronStatusFilter,setPatronStatusFilter]=useState("all")
  const [selectedPatron,setSelectedPatron] = useState<AdminDirectoryUser|null>(null)
  const [editingOfficialName,setEditingOfficialName] = useState(false)
  const [officialNameDraft,setOfficialNameDraft] = useState("")
  const [companyEmployeeIdDraft,setCompanyEmployeeIdDraft] = useState("")
  const [savingOfficialName,setSavingOfficialName] = useState(false)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [accessEditor, setAccessEditor] = useState<AccessEditorState | null>(
    null,
  )
  const [accessConfirmationOpen, setAccessConfirmationOpen] = useState(false)
  const [reauthenticatedPendingChange, setReauthenticatedPendingChange] = useState(false)
  const accessReauthenticationPopup=useRef<Window|null>(null)
  const [savingUser, setSavingUser] = useState<string | null>(null)
  useEffect(()=>{
    setAdminSection(initialSection??null)
    setAdminSectionHistory([])
  },[initialSection])
  useEffect(()=>{
    if(role!=="admin")return
    const controller=new AbortController()
    void fetch(apiPath("/api/issues?summary=1"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const payload=await response.json()
      if(response.ok&&payload.summary)setIssueSummary(payload.summary)
    }).catch(()=>{})
    return()=>controller.abort()
  },[role])
  useEffect(()=>{
    if(adminSection!=="timesheets")return
    const controller=new AbortController()
    setAdminPeriodsLoading(true);setAdminPeriodsError("")
    void fetch(apiPath("/api/timesheet-periods"),{cache:"no-store",signal:controller.signal}).then(async response=>{
      const data=await response.json()
      if(!response.ok)throw new Error(data.error??"Could not load timesheet periods.")
      setAdminPeriods(Array.isArray(data.periods)?data.periods:[])
    }).catch(cause=>{if(!controller.signal.aborted)setAdminPeriodsError(cause instanceof Error?cause.message:"Could not load timesheet periods.")}).finally(()=>{if(!controller.signal.aborted)setAdminPeriodsLoading(false)})
    return()=>controller.abort()
  },[adminSection])
  function navigateAdminSection(next:"admin"|"reports"|"timesheets"):void {
    setAdminSectionHistory(history=>[...history,adminSection])
    setAdminSection(next)
  }
  function backAdminSection():void {
    const previous=adminSectionHistory.at(-1)
    if(adminSectionHistory.length){
      setAdminSectionHistory(history=>history.slice(0,-1))
      setAdminSection(previous??null)
    }else if(onExit)onExit()
    else setAdminSection(null)
  }
  const [managementError, setManagementError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(()=>{if(rightsOnly)setDirectoryOpen(true)},[rightsOnly])
  useEffect(()=>{if(openRequest)setDirectoryOpen(true)},[openRequest])

  useEffect(() => {
    if (role !== "admin") return
    const onMessage=async(event:MessageEvent)=>{
      if(event.origin!==window.location.origin||event.source!==accessReauthenticationPopup.current||event.data?.type!=="tanovo:microsoft-reauth-complete")return
      accessReauthenticationPopup.current=null
      const stored=window.sessionStorage.getItem(pendingAccessChangeKey)
      window.sessionStorage.removeItem(pendingAccessChangeKey)
      try{
        const pending=stored?JSON.parse(stored) as AccessEditorState&{expiresAt:number;state:string}:null
        const session=await getSession()
        if(!event.data.ok||!pending||pending.state!==event.data.state||pending.expiresAt<Date.now()||!pending.email||pending.email.toLowerCase()!==userEmail.toLowerCase()||session?.user?.email?.toLowerCase()!==userEmail.toLowerCase()||!manageableRoles.includes(pending.role)||!manageableStatuses.includes(pending.accessStatus)||typeof pending.note!=="string")throw new Error()
        setAccessEditor({ ...pending, mode: "edit" })
        setReauthenticatedPendingChange(true)
        setAccessConfirmationOpen(true)
      }catch{setManagementError("Microsoft reauthentication was cancelled, expired, or returned a different account. No access change was saved.")}
    }
    window.addEventListener("message",onMessage)
    return()=>window.removeEventListener("message",onMessage)
  }, [role,userEmail])

  useEffect(() => {
    let active = true

    if (role !== "admin") {
      setLoading(false)
      return () => {
        active = false
      }
    }

    /**
     * Loads administrator directory and audit data from the server.
     *
     * The APIs enforce admin-only access. Directory data supports operational
     * access review, while audit data supports security investigation.
     *
     * @returns A promise that resolves after admin data loads or an error is stored.
     */
    async function loadAdminData() {
      try {
        const [usersRes, auditRes] = await Promise.all([
          fetch(apiPath("/api/users"), { cache: "no-store" }),
          rightsOnly ? Promise.resolve(Response.json({events:[]})) : fetch(apiPath("/api/audit?limit=25"), { cache: "no-store" }),
        ])
        const usersData = await usersRes.json()
        const auditData = await auditRes.json()
        if (!usersRes.ok) {
          throw new Error(usersData.error ?? "Failed to load users.")
        }
        if (!auditRes.ok) {
          throw new Error(auditData.error ?? "Failed to load audit events.")
        }
        if (active) {
          setUsers(sortAdminDirectoryUsers(usersData.users ?? []))
          setAuditEvents(auditData.events ?? [])
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load admin data.",
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    window.addEventListener("permissions-changed", loadAdminData)
    window.addEventListener("focus", loadAdminData)
    loadAdminData()

    return () => {
      active = false
      window.removeEventListener("permissions-changed", loadAdminData)
      window.removeEventListener("focus", loadAdminData)
    }
  }, [role,rightsOnly])

  if (role !== "admin") {
    return null
  }

  const sortedUsers = sortAdminDirectoryUsers(users)
  const directoryRoleGroups=["admin","account_manager","manager","employee","contractor","none"].map(groupRole=>({role:groupRole,users:sortedUsers.filter(user=>(user.role||"none").toLowerCase()===groupRole)})).filter(group=>group.users.length)
  const landingPatrons=sortedUsers.filter(user=>{
    const search=patronSearch.trim().toLowerCase()
    const matchesSearch=!search||user.displayName.toLowerCase().includes(search)||user.email.toLowerCase().includes(search)
    const needsAttention = !user.accessConfigured || user.accessStatus !== "active" || !user.displayName.trim()
    const matchesStatus = patronStatusFilter === "all" || (patronStatusFilter === "needs_attention" ? needsAttention : user.accessStatus === patronStatusFilter)
    return matchesSearch&&(patronRoleFilter==="all"||user.role===patronRoleFilter)&&matchesStatus
  })

  /**
   * Applies a saved managed access assignment to the visible directory.
   *
   * The user-management API returns the saved access row, not the full directory
   * summary. This helper preserves any activity counts already loaded for that
   * email while updating role, status, note, and source fields.
   *
   * @param managedUser - Saved managed access row returned by the API.
   * @returns Nothing; directory state is updated as a side effect.
   */
  function applyManagedAccessUser(managedUser: {
    permissions?: PermissionOverrides
    email: string
    role: UserRole
    accessStatus: AccessStatus
    note: string
    updatedBy: string | null
    updatedAt: string | null
  }) {
    setUsers((previous) => {
      const normalizedEmail = managedUser.email.toLowerCase()
      const existing = previous.find((user) => user.email === normalizedEmail)
      const nextUser: AdminDirectoryUser = {
        environmentAdmin: existing?.environmentAdmin ?? false,
        email: normalizedEmail,
        role: managedUser.role,
        accessStatus: managedUser.accessStatus,
        accessSource: "managed",
        accessConfigured: true,
        note: managedUser.note,
        permissions: managedUser.permissions ?? {},
        updatedBy: managedUser.updatedBy,
        updatedAt: managedUser.updatedAt,
        displayName: existing?.displayName ?? "",
        imageDataUrl: existing?.imageDataUrl ?? null,
        totalEntries: existing?.totalEntries ?? 0,
        draftEntries: existing?.draftEntries ?? 0,
        submittedEntries: existing?.submittedEntries ?? 0,
        approvedEntries: existing?.approvedEntries ?? 0,
        rejectedEntries: existing?.rejectedEntries ?? 0,
        lastEntryAt: existing?.lastEntryAt ?? null,
      }
      const withoutUser = previous.filter((user) => user.email !== normalizedEmail)
      return sortAdminDirectoryUsers([...withoutUser, nextUser])
    })
  }

  /**
   * Saves a managed access assignment through the admin users API.
   *
   * This function is only called by the editor window's Save button. Successful
   * changes are reflected immediately and audited server-side by the API route.
   *
   * @param payload - Access assignment values to persist.
   * @returns True when the assignment is saved, otherwise false.
   */
  async function saveManagedUserAccess(payload: {
    permissions?: PermissionOverrides
    email: string
    role: UserRole
    accessStatus: AccessStatus
    note?: string
  }) {
    setSavingUser(payload.email.toLowerCase())
    setManagementError(null)

    try {
      const res = await fetch(apiPath("/api/users"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.status === 404 || res.status === 405) {
        throw new Error("This server does not have the access-update endpoint yet. Confirm the Development deployment is current, then refresh and try again.")
      }
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to save user access.")
      }
      applyManagedAccessUser(data.user)
      notifyPermissionsChanged()
      return true
    } catch (err) {
      setManagementError(
        err instanceof Error ? err.message : "Failed to save user access.",
      )
      return false
    } finally {
      setSavingUser(null)
    }
  }

  /**
   * Opens the dynamic access editor for a new employee record.
   *
   * @returns Nothing; editor state is prepared for a new managed user.
   */
  function openAddUserEditor() {
    setManagementError(null)
    setAccessConfirmationOpen(false)
    setReauthenticatedPendingChange(false)
    setAccessEditor({
      mode: "add",
      email: "",
      role: "employee",
      accessStatus: "active",
      note: "",
    })
  }

  /**
   * Opens the dynamic access editor for an existing directory row.
   *
   * Observed users do not have a saved permission state yet, so the editor starts
   * them as active employees until the admin chooses a different role or status.
   *
   * @param user - Directory row to edit.
   * @returns Nothing; editor state is prepared from the selected user.
   */
  function openEditUserEditor(user: AdminDirectoryUser) {
    setManagementError(null)
    setAccessConfirmationOpen(false)
    setReauthenticatedPendingChange(false)
    setAccessEditor({
      mode: "edit",
      email: user.email,
      role: user.role === "none" ? "employee" : user.role,
      accessStatus:
        user.accessStatus === "observed" ? "active" : user.accessStatus,
      note: user.note,
      permissions: user.permissions ?? {},
      environmentAdmin: user.environmentAdmin,
      protectedAdmin: user.environmentAdmin || (user.role === "admin" && user.accessStatus === "active" && users.filter(person=>person.role === "admin" && person.accessStatus === "active").length <= 1),
    })
  }

  /**
   * Saves the current editor draft through the admin users API.
   *
   * The Save button is the only UI path that persists role or permission changes.
   * The modal remains open when validation or the server rejects the request.
   *
   * @returns A promise that resolves after the save attempt finishes.
   */
  async function saveAccessEditor() {
    if (!accessEditor || !accessEditor.email.trim()) return
    setManagementError(null)
    setAccessConfirmationOpen(true)
  }

  /** Reauthenticates for high-impact changes, then saves only after explicit confirmation. */
  async function confirmAccessEditor() {
    if (!accessEditor || !accessEditor.email.trim()) return
    const existing = users.find(user => user.email.toLowerCase() === accessEditor.email.trim().toLowerCase())
    const current = existing && existing.role !== "none"
      ? { role: existing.role, accessStatus: existing.accessStatus === "observed" ? "active" : existing.accessStatus, permissions: existing.permissions }
      : null
    const requiresStepUp = accessChangeRequiresStepUp(current, {
      role: accessEditor.role,
      accessStatus: accessEditor.accessStatus,
      permissions: accessEditor.permissions,
    })

    if (requiresStepUp && !reauthenticatedPendingChange) {
      const state=crypto.randomUUID()
      window.sessionStorage.setItem(pendingAccessChangeKey, JSON.stringify({ ...accessEditor, expiresAt: Date.now() + 5 * 60_000,state }))
      setAccessConfirmationOpen(false)
      const popup=openEntraReauthentication(state,()=>{window.sessionStorage.removeItem(pendingAccessChangeKey);setManagementError("Microsoft reauthentication could not start. No access change was saved.")})
      if(!popup){window.sessionStorage.removeItem(pendingAccessChangeKey);setManagementError("Allow the Microsoft verification popup to continue. No access change was saved.");return}
      accessReauthenticationPopup.current=popup
      return
    }
    const saved = await saveManagedUserAccess({
      email: accessEditor.email.trim(),
      role: accessEditor.role,
      accessStatus: accessEditor.accessStatus,
      note: accessEditor.note.trim(),
      permissions: accessEditor.permissions,
    })

    if (saved) {
      setAccessConfirmationOpen(false)
      setReauthenticatedPendingChange(false)
      setAccessEditor(null)
    }
  }

  /** Saves admin-corrected identity fields while preserving generated identifiers. */
  async function saveOfficialIdentity():Promise<void> {
    if(!selectedPatron)return
    setSavingOfficialName(true);setManagementError(null)
    try{
      const res=await fetch(apiPath("/api/people"),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:selectedPatron.email,officialName:officialNameDraft,employeeId:companyEmployeeIdDraft.trim()||null})})
      const data=await res.json();if(!res.ok)throw new Error(data.error??"Unable to update official name.")
      setUsers(previous=>previous.map(user=>user.email===selectedPatron.email?{...user,displayName:data.identity.officialName,companyReference:data.identity.shortReference,contractorNumber:data.identity.contractorNumber,employeeId:data.identity.employeeId}:user))
      setSelectedPatron(previous=>previous?{...previous,displayName:data.identity.officialName,companyReference:data.identity.shortReference,contractorNumber:data.identity.contractorNumber,employeeId:data.identity.employeeId}:previous)
      setEditingOfficialName(false)
    }catch(err){setManagementError(err instanceof Error?err.message:"Unable to update official name.")}
    finally{setSavingOfficialName(false)}
  }

  /**
   * Opens the full admin activity window and loads extended audit events.
   *
   * The compact admin panel only shows a short preview. This loader fetches the
   * largest bounded audit set supported by the API so administrators can inspect
   * broader app activity without exposing the view to non-admin roles.
   *
   * @returns A promise that resolves after the activity window is populated.
   */
  async function openActivityWindow(report:AdminAuditReport|null=null) {
    setActivityReport(report)
    setActivityWindowOpen(true)
    setActivityError(null)

    if(report==="api-errors"){
      await loadOperationalEvents(operationalFilters,false)
      return
    }

    await loadAuditEvents(auditFilters,false,report)
  }

  async function loadAuditEvents(filters:OperationalFilters,append:boolean,scope:AdminAuditReport|null=activityReport){
    if(append&&!activityCursor)return
    append?setActivityLoadingMore(true):setActivityLoading(true);setActivityError(null)
    try{
      const params=new URLSearchParams({limit:"100"})
      if(filters.search.trim())params.set("search",filters.search.trim())
      if(filters.from)params.set("from",filters.from)
      if(filters.through)params.set("through",filters.through)
      if(filters.category)params.set("targetType",filters.category)
      if(scope&&scope!=="api-errors")params.set("scope",scope)
      if(append&&activityCursor){params.set("beforeAt",activityCursor.occurredAt);params.set("beforeId",activityCursor.id)}
      const response=await fetch(apiPath(`/api/audit?${params}`),{cache:"no-store"}),data=await response.json()
      if(!response.ok)throw new Error(data.error??"Failed to load app activity.")
      setAllActivityEvents(previous=>append?[...previous,...(data.events??[])]:data.events??[])
      setActivityCursor(data.nextCursor??null)
    }catch(error){setActivityError(error instanceof Error?error.message:"Failed to load app activity.")}
    finally{setActivityLoading(false);setActivityLoadingMore(false)}
  }

  async function loadOperationalEvents(filters:OperationalFilters,append:boolean){
    if(append&&!operationalCursor)return
    setActivityError(null)
    append?setActivityLoadingMore(true):setActivityLoading(true)
    try{
      const params=new URLSearchParams({limit:"100"})
      if(filters.search.trim())params.set("search",filters.search.trim())
      if(filters.from)params.set("from",filters.from)
      if(filters.through)params.set("through",filters.through)
      if(filters.category)params.set("category",filters.category)
      if(filters.status)params.set("status",filters.status)
      if(append&&operationalCursor){params.set("beforeAt",operationalCursor.occurredAt);params.set("beforeId",operationalCursor.id)}
      const response=await fetch(apiPath(`/api/operational-events?${params}`),{cache:"no-store"}),data=await response.json()
      if(!response.ok)throw new Error(data.error??"Failed to load operational events.")
      const mapped=mapOperationalEvents(data.events??[])
      setOperationalEvents(previous=>append?[...previous,...mapped]:mapped)
      setOperationalCursor(data.nextCursor??null)
    }catch(error){setActivityError(error instanceof Error?error.message:"Operational events could not be loaded.")}
    finally{setActivityLoading(false);setActivityLoadingMore(false)}
  }

  async function loadMoreActivity():Promise<void>{
    if(activityReport==="api-errors"){
      if(activityLoadingMore)return
      await loadOperationalEvents(operationalFilters,true)
      return
    }
    if(!activityCursor||activityLoadingMore)return
    setActivityLoadingMore(true);setActivityError(null)
    await loadAuditEvents(auditFilters,true,activityReport)
  }

  const activityEvents = allActivityEvents.length > 0 ? allActivityEvents : auditEvents
  const patronsNeedingAttention=users.filter(user=>!user.accessConfigured||user.accessStatus!=="active"||!user.displayName.trim())
  const activeAdminCount=users.filter(user=>user.role==="admin"&&user.accessStatus==="active").length
  const activeManagerCount=users.filter(user=>user.role==="manager"&&user.accessStatus==="active").length
  const adminPeriodToday=new Date().toLocaleDateString("en-CA")
  const sortedAdminPeriods=[...adminPeriods].sort((a,b)=>b.startDate.localeCompare(a.startDate))
  const visibleAdminPeriods=sortedAdminPeriods.filter(period=>{
    const current=period.startDate<=adminPeriodToday&&period.endDate>=adminPeriodToday
    const upcoming=period.startDate>adminPeriodToday
    const matchesState=adminPeriodStateFilter==="all"||adminPeriodStateFilter==="current"&&current||adminPeriodStateFilter==="upcoming"&&upcoming||adminPeriodStateFilter==="archived"&&period.endDate<adminPeriodToday
    return matchesState&&(!adminPeriodSearch.trim()||`${period.name} ${period.startDate} ${period.endDate}`.toLowerCase().includes(adminPeriodSearch.trim().toLowerCase()))
  })
  const activeAdminPeriod=sortedAdminPeriods.find(period=>period.startDate<=adminPeriodToday&&period.endDate>=adminPeriodToday)
  const selectedAdminPeriod=adminPeriodSelection==="all"
    ? null
    : sortedAdminPeriods.find(period=>period.id===adminPeriodSelection)
      ?? (adminPeriodSelection==="current"?activeAdminPeriod:null)
      ?? sortedAdminPeriods[0]
  const selectedPeriodEntries=selectedAdminPeriod
    ? entries.filter(entry=>entry.date>=selectedAdminPeriod.startDate&&entry.date<=selectedAdminPeriod.endDate)
    : entries
  const selectedPeriodHours=selectedPeriodEntries.reduce((total,entry)=>total+Number(entry.hours||0),0)
  const selectedPeriodPeople=new Set(selectedPeriodEntries.map(entry=>entry.contractor)).size
  const selectedPeriodProjects=new Set(selectedPeriodEntries.map(entry=>entry.project).filter(Boolean)).size
  const selectedPeriodStatuses={
    draft:selectedPeriodEntries.filter(entry=>entry.status==="draft").length,
    submitted:selectedPeriodEntries.filter(entry=>entry.status==="submitted").length,
    approved:selectedPeriodEntries.filter(entry=>entry.status==="approved").length,
    rejected:selectedPeriodEntries.filter(entry=>entry.status==="rejected").length,
  }
  const selectedPeriodRecent=[...selectedPeriodEntries].sort((a,b)=>b.date.localeCompare(a.date))
  const selectedProjectSnapshot=[...selectedPeriodEntries.reduce((projects,entry)=>{
    const project=entry.project||"No project"
    const summary=projects.get(project)||{entries:0,hours:0,latestDate:entry.date}
    summary.entries+=1;summary.hours+=Number(entry.hours)||0
    if(entry.date>summary.latestDate)summary.latestDate=entry.date
    projects.set(project,summary);return projects
  },new Map<string,{entries:number;hours:number;latestDate:string}>())].sort((a,b)=>b[1].latestDate.localeCompare(a[1].latestDate)||a[0].localeCompare(b[0]))
  const selectedReviewManagers=[...selectedPeriodEntries.reduce((managers,entry)=>{
    const name=entry.reviewManagerName||entry.reviewManagerEmail||"Manager not assigned"
    managers.set(name,(managers.get(name)||0)+1);return managers
  },new Map<string,number>())].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
  const visibleProjectSnapshot=selectedProjectSnapshot.filter(([project])=>project.toLowerCase().includes(snapshotProjectSearch.trim().toLowerCase()))
  const visibleReviewManagers=selectedReviewManagers.filter(([manager])=>manager.toLowerCase().includes(snapshotManagerSearch.trim().toLowerCase()))

  return (
    <div style={rightsOnly?undefined:{minHeight:"calc(100dvh - 13rem)"}} className="tech-surface flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 bg-white text-slate-950">
      {!rightsOnly&&<AdminWorkspace activeSection={adminSection} onAdmin={()=>navigateAdminSection("admin")} onReports={()=>navigateAdminSection("reports")} onTimesheets={()=>navigateAdminSection("timesheets")}/>}
      <div className="grid min-h-0 min-w-0 flex-1 items-stretch gap-3 lg:grid-cols-2">
        <div className="flex min-h-0 min-w-0 flex-col">
          {rightsOnly?<div className="flex flex-wrap items-center gap-2 border-y border-orange-200 bg-orange-50/70 px-3 py-2"><Button variant="outline" size="sm" className="border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100" onClick={()=>setDirectoryOpen(true)}><Users className="size-4"/>Patron rights</Button><span className="ml-auto text-xs text-slate-600">{users.length} actors · {users.filter(user=>user.role==="admin"&&user.accessStatus==="active").length} active admins</span></div>:adminSection===null&&<section aria-label="People and access" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-orange-200 bg-white shadow-sm shadow-orange-950/5">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-200 bg-gradient-to-r from-orange-50 via-white to-sky-50 px-3 py-1.5">
              <div><h2 className="text-sm font-semibold text-orange-950">People and access</h2><p className="text-[11px] text-slate-600">Resolve identity, access, and account health issues</p></div>
              <div className="flex flex-wrap gap-1.5"><AddPerson admin/><Button size="sm" variant="outline" onClick={()=>setDirectoryOpen(true)}><Users className="size-4"/>Directory</Button></div>
            </header>
            <details open className="group flex min-h-0 min-w-0 flex-1 flex-col">
            <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-orange-100 bg-orange-50/50 px-3 py-2 text-xs font-medium text-orange-950 hover:bg-orange-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 [&::-webkit-details-marker]:hidden"><ChevronRight className="size-3.5 transition-transform group-open:rotate-90"/><span className="flex-1">Patron directory</span><span className="tabular-nums text-slate-600">{users.length} accounts · {patronsNeedingAttention.length} need attention</span></summary>
            <div className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-slate-50/70 p-2">
              <label className="sr-only" htmlFor="patron-search">Search patrons by name or email</label><input id="patron-search" type="search" value={patronSearch} onChange={event=>setPatronSearch(event.target.value)} placeholder="Search name or email" className="h-8 min-w-0 flex-1 basis-52 rounded-md border border-slate-300 px-2.5 text-sm"/>
              <label className="sr-only" htmlFor="patron-role-filter">Filter patrons by role</label><select id="patron-role-filter" value={patronRoleFilter} onChange={event=>setPatronRoleFilter(event.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="all">All roles</option>{["admin","manager","account_manager","employee","contractor","none"].map(value=><option key={value} value={value}>{value==="none"?"Unassigned":value.replaceAll("_"," ")}</option>)}</select>
              <label className="sr-only" htmlFor="patron-status-filter">Filter people by access status</label><select id="patron-status-filter" value={patronStatusFilter} onChange={event=>setPatronStatusFilter(event.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="all">All access states</option><option value="needs_attention">Needs attention</option>{["active","suspended","retired","blocked","denied","observed"].map(value=><option key={value} value={value}>{value==="observed"?"Observed":accessStatusLabel(value as AccessStatus)}</option>)}</select>
              <DataExportMenu title="Patron directory" filename="patron-directory" rows={landingPatrons.map(user=>({name:displayOfficialName(user.displayName),email:user.email,role:user.role,accessStatus:user.accessStatus,accessSource:user.accessSource,configured:user.accessConfigured,lastUpdated:user.updatedAt??""}))} summary={{patrons:landingPatrons.length,role:patronRoleFilter,status:patronStatusFilter,search:patronSearch||"None"}}/>
            </div>
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              {loading?<p role="status" className="p-3 text-sm text-slate-600">Loading organization patrons...</p>:error?<p role="alert" className="p-3 text-sm text-red-700">{error}</p>:landingPatrons.length===0?<p className="p-3 text-sm text-slate-600">No patrons match these filters.</p>:<table className="w-full min-w-[500px] text-left text-sm"><thead className="sticky top-0 z-[1] bg-sky-50"><tr className="border-b border-sky-200 text-[11px] uppercase text-sky-950"><th className="px-2.5 py-1.5 font-medium">Patron</th><th className="px-2.5 py-1.5 font-medium">Role</th><th className="px-2.5 py-1.5 font-medium">Access</th><th className="px-2.5 py-1.5 text-right font-medium">Edit</th></tr></thead><tbody>{landingPatrons.map(user=><tr key={user.email} className="border-b border-slate-100 odd:bg-white even:bg-sky-50/30 hover:bg-orange-50"><td className="px-2.5 py-1.5"><button type="button" className="max-w-full truncate text-left text-sm font-medium text-slate-900 underline-offset-2 hover:underline" onClick={()=>setSelectedPatron(user)}>{displayOfficialName(user.displayName)}</button></td><td className="px-2.5 py-1.5"><span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[11px] font-medium capitalize ${roleBadgeClass(user.role)}`}>{user.role.replaceAll("_"," ")}</span></td><td className="px-2.5 py-1.5 text-xs">{user.accessStatus==="observed"?"Observed":accessStatusLabel(user.accessStatus)}</td><td className="px-2.5 py-1 text-right"><Button type="button" variant="outline" size="sm" className="h-7 border-orange-300 bg-orange-50 px-2 text-orange-900 hover:bg-orange-100" onClick={()=>openEditUserEditor(user)} disabled={savingUser===user.email}><Pencil className="size-3.5"/><span className="sr-only">Edit access for {displayOfficialName(user.displayName)}</span></Button></td></tr>)}</tbody></table>}
            </div>
            </details>
          </section>}
        </div>
        {!rightsOnly&&adminSection===null&&<aside aria-label="Organization health" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 shadow-sm shadow-sky-950/5">
          <header className="border-b border-sky-200 bg-sky-100/70 px-3 py-2"><h2 className="text-sm font-semibold text-sky-950">Organization health</h2><p className="text-[11px] text-sky-900">Key attention counts and operations</p></header>
          {canManagePeriods&&<div className="px-2 pt-2"><PeriodExpirationNotice onManage={()=>setAdminTimesheetTool("periods")}/></div>}
          <div className="grid grid-cols-3 gap-1.5 p-2">
            <div className="border-l-2 border-sky-500 bg-white/90 px-2 py-1.5"><span className="block text-[11px] text-sky-800">Patrons</span><strong className="block text-lg text-sky-950">{users.length}</strong></div>
            <button type="button" onClick={()=>setPatronStatusFilter("needs_attention")} className="border-l-2 border-orange-500 bg-orange-50 px-2 py-1.5 text-left hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"><span className="block text-[11px] text-orange-900">Needs attention</span><strong className="block text-lg text-orange-950">{patronsNeedingAttention.length}</strong></button>
            <div className="border-l-2 border-emerald-500 bg-emerald-50 px-2 py-1.5"><span className="block text-[11px] text-emerald-900">Active admins</span><strong className="block text-lg text-emerald-950">{activeAdminCount}</strong></div>
          </div>
          <details className="group mx-2 mb-2 border-t border-sky-100">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-xs font-semibold text-sky-950 hover:text-sky-700 [&::-webkit-details-marker]:hidden"><ChevronRight className="size-3.5 transition-transform group-open:rotate-90"/>Support priorities<span className="ml-auto font-normal text-slate-600">{patronsNeedingAttention.length+activeManagerCount+activeAdminCount} indicators</span></summary>
          <div className="mb-2 border-l-4 border-orange-500 bg-white/80 p-2">
            <h3 className="text-sm font-semibold text-slate-900">Support priorities</h3>
            <ul className="mt-2 space-y-2 text-xs text-slate-700">
              <li className="flex items-center justify-between gap-3"><span>Access or profile needs review</span><strong className={patronsNeedingAttention.length?"text-orange-800":"text-emerald-800"}>{patronsNeedingAttention.length}</strong></li>
              <li className="flex items-center justify-between gap-3"><span>Active managers available</span><strong className="text-sky-900">{activeManagerCount}</strong></li>
              <li className="flex items-center justify-between gap-3"><span>Active administrators</span><strong className="text-emerald-800">{activeAdminCount}</strong></li>
            </ul>
            <Button type="button" variant="outline" size="sm" className="mt-3 w-full justify-center border-orange-300 bg-orange-50 text-orange-950 hover:bg-orange-100" onClick={()=>setPatronStatusFilter("needs_attention")}><Users className="size-4"/>Review people needing attention</Button>
          </div>
          </details>
          <button type="button" onClick={()=>setAdminIssuesOpen(true)} className="mx-2 mb-2 mt-auto flex items-center justify-between gap-2 border border-red-200 bg-red-50/80 px-2.5 py-2 text-left hover:bg-red-100"><span className="text-xs font-medium text-red-950">Issues and requests</span><span className="text-xs font-semibold text-red-800">{issueSummary.open} open · {issueSummary.urgent} urgent</span></button>
        </aside>}
      </div>
      {!rightsOnly&&adminSection==="admin"&&<WindowSurface title="Admin" onBack={backAdminSection}>
        <section className="flex min-h-0 w-full flex-col gap-3 overflow-auto bg-white p-4 sm:p-6">
          <header className="border-b border-orange-200 bg-orange-50 px-3 py-2"><h2 className="font-semibold text-orange-950">Administration</h2><p className="text-xs text-orange-900">People, account rights, access lifecycle, and security.</p></header>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
            <section className="space-y-3 border-l-4 border-orange-500 bg-orange-50/60 p-3">
              <div><h3 className="text-sm font-semibold text-orange-950">People and rights</h3><p className="text-xs text-orange-900">Create patron identities or manage roles and control permissions.</p></div>
              <div className="flex flex-wrap gap-2"><AddPerson admin/><Button variant="outline" onClick={()=>setDirectoryOpen(true)}><Users className="size-4"/>Patron access and rights</Button></div>
            </section>
            <section className="space-y-2 border-l-4 border-sky-500 bg-sky-50/80 p-3">
              <h3 className="text-sm font-semibold text-sky-950">Account operations</h3>
              <div className="grid gap-2"><Button variant="outline" className="justify-start" onClick={()=>onLifecycle?.()}><CalendarClock className="size-4"/>Access lifecycle</Button>{role==="admin"&&<Button variant="destructive" className="justify-start" onClick={onPreviewDataReset}><Trash2 className="size-4"/>Reset preview data</Button>}</div>
            </section>
          </div>
        </section>
      </WindowSurface>}
      {!rightsOnly&&adminSection==="reports"&&<WindowSurface title="Reports" onBack={backAdminSection}>
        <section className="flex min-h-0 w-full flex-col gap-3 overflow-auto bg-white p-4 sm:p-6">
          <header className="border-b border-blue-200 bg-blue-50 px-3 py-2"><h2 className="font-semibold text-blue-950">Reports</h2><p className="text-xs text-blue-900">Admin reporting hub: operational analytics, activity history, and security risk findings. Raw entries stay in Timesheets.</p></header>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <section className="flex flex-col items-start gap-2 border-l-4 border-blue-600 bg-blue-50/70 p-3"><h3 className="text-sm font-semibold text-blue-950">Timesheet analytics</h3><p className="flex-1 text-xs text-blue-900">Organized summaries and analysis across the available timesheet records.</p><Button variant="outline" className="justify-start border-blue-200 bg-white text-blue-900 hover:bg-blue-100" onClick={()=>setAdminReportOpen(true)}><BarChart3 className="size-4"/>Open analytics report</Button></section>
            <section className="flex flex-col items-start gap-2 border-l-4 border-orange-500 bg-orange-50/70 p-3"><h3 className="text-sm font-semibold text-orange-950">Activity and audit log</h3><p className="flex-1 text-xs text-orange-900">Investigate who did what, when, and which request or record was involved.</p><Button variant="outline" className="justify-start border-orange-200 bg-white text-orange-900 hover:bg-orange-100" onClick={()=>void openActivityWindow()}><Activity className="size-4"/>Open activity log</Button></section>
            <section className="flex flex-col items-start gap-2 border-l-4 border-red-500 bg-red-50/70 p-3"><h3 className="text-sm font-semibold text-red-950">Security risk report</h3><p className="flex-1 text-xs text-red-900">Review AI-highlighted activity patterns and security findings before taking action.</p><Button variant="outline" className="justify-start border-red-200 bg-white text-red-900 hover:bg-red-100" onClick={()=>onSecurity?.()}><ShieldCheck className="size-4"/>Open security risks</Button></section>
            <section className="flex flex-col items-start gap-2 border-l-4 border-sky-600 bg-sky-50/70 p-3"><h3 className="text-sm font-semibold text-sky-950">Access change history</h3><p className="flex-1 text-xs text-sky-900">See who changed a patron’s role, account access, or permissions and when.</p><Button variant="outline" className="justify-start border-sky-200 bg-white text-sky-900 hover:bg-sky-100" onClick={()=>void openActivityWindow("access")}><Users className="size-4"/>View rights changes</Button></section>
            <section className="flex flex-col items-start gap-2 border-l-4 border-emerald-600 bg-emerald-50/70 p-3"><h3 className="text-sm font-semibold text-emerald-950">Timesheet period history</h3><p className="flex-1 text-xs text-emerald-900">See who created or changed a period and when, including the saved before-and-after settings.</p><Button variant="outline" className="justify-start border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-100" onClick={()=>void openActivityWindow("periods")}><CalendarClock className="size-4"/>View period history</Button></section>
            <section className="flex flex-col items-start gap-2 border-l-4 border-orange-600 bg-orange-50/70 p-3"><h3 className="text-sm font-semibold text-orange-950">Project history</h3><p className="flex-1 text-xs text-orange-900">See who created, assigned, or archived projects and when.</p><Button variant="outline" className="justify-start border-orange-200 bg-white text-orange-900 hover:bg-orange-100" onClick={()=>void openActivityWindow("projects")}><FolderKanban className="size-4"/>View project history</Button></section>
            <section className="flex flex-col items-start gap-2 border-l-4 border-red-600 bg-red-50/70 p-3"><h3 className="text-sm font-semibold text-red-950">API errors</h3><p className="flex-1 text-xs text-red-900">Inspect failed calls, HTTP statuses, diagnostic codes, and request references.</p><Button variant="outline" className="justify-start border-red-200 bg-white text-red-900 hover:bg-red-100" onClick={()=>void openActivityWindow("api-errors")}><Activity className="size-4"/>Open API error report</Button></section>
            <section className="flex flex-col items-start gap-2 border-l-4 border-orange-600 bg-orange-50/70 p-3"><div className="flex w-full items-center justify-between gap-2"><h3 className="text-sm font-semibold text-orange-950">Issues and requests</h3><span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">{issueSummary.open} open · {issueSummary.urgent} urgent</span></div><p className="flex-1 text-xs text-orange-900">Review {issueSummary.uniqueErrors} unique failure patterns, compare repeated reports, track repairs, and dequeue resolved issues. Report and repair history is available to the admin assistant for scrutiny.</p><Button variant="outline" className="justify-start border-orange-200 bg-white text-orange-900 hover:bg-orange-100" onClick={()=>setAdminIssuesOpen(true)}><Activity className="size-4"/>Open issue queue</Button></section>
            <section className="flex flex-col items-start gap-2 border-l-4 border-emerald-600 bg-emerald-50/70 p-3"><h3 className="text-sm font-semibold text-emerald-950">AI workflow activity</h3><p className="flex-1 text-xs text-emerald-900">Inspect sanitized response times, outcomes, proposal counts, and failure categories.</p><Button variant="outline" className="justify-start border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-100" onClick={()=>setAssistantRunsOpen(true)}><Activity className="size-4"/>Open AI activity</Button></section>
          </div>
        </section>
      </WindowSurface>}
      {!rightsOnly&&adminSection==="timesheets"&&<WindowSurface title="Timesheets" onBack={backAdminSection}>
        <section className="flex min-h-0 w-full flex-col gap-3 overflow-auto bg-white p-4 sm:p-6">
          <header className="flex shrink-0 items-center justify-end gap-1 border-b border-green-200 bg-green-50/60 px-2 py-1.5">{canManagePeriods&&<Button variant="outline" size="icon" aria-label="Period settings" title="Period settings" onClick={()=>setAdminTimesheetTool("periods")}><CalendarClock className="size-4"/></Button>}<Button variant="outline" size="icon" aria-label="About timesheet periods" title="About this page" onClick={()=>setTimesheetAboutOpen(true)}><CircleHelp className="size-4"/></Button><Button variant="outline" size="icon" aria-label="Refresh timesheets" title="Refresh timesheets" onClick={onRefreshEntries}><Activity className="size-4"/></Button></header>
          {canReviewEntries&&pendingEntries.length>0&&<section className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-l-4 border-orange-500 bg-orange-50 px-2 py-1"><span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-orange-950"><Layers3 className="size-4 shrink-0"/>Admin attention · {pendingEntries.length} pending</span><span className="flex shrink-0 items-center gap-1"><Button variant="ghost" size="icon" aria-label="About admin escalations" title="Managers normally approve their own teams. Admins step in for coverage, troubleshooting, or a documented override." onClick={()=>setTimesheetAboutOpen(true)}><CircleHelp className="size-4"/></Button><Button size="sm" variant="outline" className="h-7 border-orange-300 bg-white px-2 text-xs text-orange-950 hover:bg-orange-100" onClick={()=>setAdminTimesheetTool("entries")}><Layers3 className="size-3.5"/>Review</Button></span></section>}
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)]">
            <nav aria-label="Timesheet periods" className="min-h-0 overflow-auto rounded-lg border border-sky-200 bg-sky-50/40 p-2">
              <h3 className="px-2 py-1 text-xs font-semibold uppercase text-sky-950">Period archive</h3>
              <div className="mt-1 grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_10rem]"><label className="sr-only" htmlFor="admin-period-search">Search periods</label><input id="admin-period-search" type="search" value={adminPeriodSearch} onChange={event=>setAdminPeriodSearch(event.target.value)} placeholder="Search periods" className="h-8 min-w-0 border border-slate-300 bg-white px-2 text-xs"/><label className="sr-only" htmlFor="admin-period-state">Filter periods</label><select id="admin-period-state" value={adminPeriodStateFilter} onChange={event=>setAdminPeriodStateFilter(event.target.value)} className="h-8 border border-slate-300 bg-white px-2 text-xs"><option value="all">All period states</option><option value="current">Current</option><option value="upcoming">Upcoming</option><option value="archived">Archived</option></select></div>
              {adminPeriodsLoading?<p role="status" className="px-2 py-3 text-sm text-slate-600">Loading periods…</p>:adminPeriodsError?<p role="alert" className="px-2 py-3 text-sm text-red-800">{adminPeriodsError}</p>:<div className="mt-1 space-y-1">
                <button type="button" aria-pressed={adminPeriodSelection==="all"} onClick={()=>setAdminPeriodSelection("all")} className={`flex w-full items-center justify-between rounded-md border-l-2 px-2.5 py-2 text-left transition ${adminPeriodSelection==="all"?"border-blue-600 bg-blue-100":"border-blue-400 bg-white hover:bg-blue-50"}`}><span><span className="block text-sm font-semibold text-blue-950">All periods</span><span className="text-[11px] text-slate-600">Every saved source entry</span></span><span className="text-xs tabular-nums text-blue-900">{entries.length}</span></button>
                {visibleAdminPeriods.map(period=>{const current=period.startDate<=adminPeriodToday&&period.endDate>=adminPeriodToday;const upcoming=period.startDate>adminPeriodToday;const count=entries.filter(entry=>entry.date>=period.startDate&&entry.date<=period.endDate).length;const selected=selectedAdminPeriod?.id===period.id;return <button key={period.id} type="button" aria-pressed={selected} onClick={()=>setAdminPeriodSelection(period.id)} className={`flex w-full items-center justify-between gap-3 rounded-md border-l-2 px-2.5 py-2 text-left transition ${selected?"border-orange-600 bg-orange-100":current?"border-emerald-500 bg-emerald-50 hover:bg-emerald-100":upcoming?"border-sky-400 bg-white hover:bg-sky-50":"border-orange-400 bg-white hover:bg-orange-50"}`}><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-950">{period.name}{current?" · Current":upcoming?" · Upcoming":" · Archived"}</span><span className="block text-[11px] text-slate-600">{period.startDate} – {period.endDate}</span></span><span className="shrink-0 text-xs tabular-nums text-slate-700">{count} {count===1?"sheet":"sheets"}</span></button>})}
                {!visibleAdminPeriods.length&&<p className="px-2 py-3 text-xs text-slate-600">No periods match these filters.</p>}
                {!adminPeriods.length&&<p className="px-2 py-3 text-xs text-slate-600">No periods configured. All saved timesheets remain available above.</p>}
              </div>}
            </nav>
            <section aria-label="Selected timesheet period" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-orange-300 bg-gradient-to-br from-orange-50/70 via-white to-sky-50">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-200 px-4 py-3"><div className="min-w-0"><p className="text-[11px] font-semibold uppercase text-orange-800">{selectedAdminPeriod?(selectedAdminPeriod.id===activeAdminPeriod?.id?"Current period":"Selected period"):"Timesheet overview"}</p><h3 className="truncate text-lg font-semibold text-slate-950">{selectedAdminPeriod?.name??"All periods"}</h3><p className="text-xs text-slate-600">{selectedAdminPeriod?`${selectedAdminPeriod.startDate} – ${selectedAdminPeriod.endDate}`:"Every saved source entry across all periods"}</p></div><Button size="sm" onClick={()=>{setAdminPeriodSelection(selectedAdminPeriod?.id??"all");setAdminTimesheetTool("entries")}}><Layers3 className="size-4"/>Open timesheets<ChevronRight className="size-4"/></Button></header>
              <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-4"><div className="bg-white/90 px-3 py-2"><p className="text-[11px] text-slate-600">Entries</p><p className="text-lg font-semibold tabular-nums">{selectedPeriodEntries.length}</p></div><div className="bg-white/90 px-3 py-2"><p className="text-[11px] text-slate-600">Hours</p><p className="text-lg font-semibold tabular-nums">{selectedPeriodHours.toLocaleString(undefined,{maximumFractionDigits:2})}h</p></div><div className="bg-white/90 px-3 py-2"><p className="text-[11px] text-slate-600">People</p><p className="text-lg font-semibold tabular-nums">{selectedPeriodPeople}</p></div><div className="bg-white/90 px-3 py-2"><p className="text-[11px] text-slate-600">Projects</p><p className="text-lg font-semibold tabular-nums">{selectedPeriodProjects}</p></div></div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2 text-xs"><span className="text-orange-900">{selectedPeriodStatuses.draft} drafts</span><span className="text-sky-900">{selectedPeriodStatuses.submitted} awaiting review</span><span className="text-emerald-900">{selectedPeriodStatuses.approved} approved</span><span className="text-red-800">{selectedPeriodStatuses.rejected} returned</span></div>
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur"><h4 className="text-xs font-semibold text-slate-800">Latest entries</h4><span className="text-[11px] text-slate-600">Showing {selectedPeriodRecent.length} of {selectedPeriodEntries.length}</span></div>
                {selectedPeriodRecent.length?<div aria-label="Latest entries list" className="max-h-72 overflow-y-auto overscroll-contain"><ul className="divide-y divide-slate-200">{selectedPeriodRecent.map(entry=><li key={entry.id} className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-xs"><time dateTime={entry.date} className="tabular-nums text-slate-600">{entry.date}</time><span className="min-w-0"><span className="block truncate font-medium text-slate-900" title={entry.project}>{entry.project||"No project"}</span><span className="block truncate text-[11px] text-slate-600" title={entry.description}>{entry.description||"No description"}</span></span><span className="flex items-center gap-2"><span className="tabular-nums">{Number(entry.hours||0).toLocaleString(undefined,{maximumFractionDigits:2})}h</span><span className="rounded-full bg-slate-100 px-2 py-0.5 capitalize text-slate-700">{entry.status}</span></span></li>)}</ul></div>:<p className="px-4 py-5 text-sm text-slate-600">No time entries have been recorded for this period yet.</p>}
                <div className="grid min-w-0 gap-3 border-t border-slate-200 p-3 xl:grid-cols-2">
                  <section aria-label="Recent projects snapshot" className="min-w-0 border border-emerald-200 bg-white/90">
                    <header className="flex items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50/70 px-3 py-2"><h4 className="text-xs font-semibold text-emerald-950">Recent projects</h4><span className="text-[10px] text-slate-600">{selectedProjectSnapshot.length} in period</span></header>
                    <label className="block border-b border-emerald-100 px-2 py-1"><span className="sr-only">Search recent projects</span><input type="search" value={snapshotProjectSearch} onChange={event=>setSnapshotProjectSearch(event.target.value)} placeholder="Search projects" className="h-7 w-full bg-transparent px-1 text-xs outline-none"/></label>
                    {visibleProjectSnapshot.length?<ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto overscroll-contain">{visibleProjectSnapshot.map(([project,summary])=><li key={project} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-xs"><span className="min-w-0"><span className="block truncate font-medium text-slate-950" title={project}>{project}</span><span className="text-[10px] text-slate-600">Latest activity {summary.latestDate}</span></span><span className="shrink-0 text-right tabular-nums text-slate-700">{summary.entries} {summary.entries===1?"entry":"entries"} · {summary.hours.toLocaleString(undefined,{maximumFractionDigits:2})}h</span></li>)}</ul>:<p className="px-3 py-3 text-xs text-slate-600">No matching projects.</p>}
                  </section>
                  <section aria-label="Review managers" className="min-w-0 border border-blue-200 bg-white/90">
                    <header className="flex items-center justify-between gap-2 border-b border-blue-100 bg-blue-50/70 px-3 py-2"><h4 className="text-xs font-semibold text-blue-950">Review managers</h4><span className="text-[10px] text-slate-600">{selectedReviewManagers.length} assigned</span></header>
                    <label className="block border-b border-blue-100 px-2 py-1"><span className="sr-only">Search review managers</span><input type="search" value={snapshotManagerSearch} onChange={event=>setSnapshotManagerSearch(event.target.value)} placeholder="Search managers" className="h-7 w-full bg-transparent px-1 text-xs outline-none"/></label>
                    {visibleReviewManagers.length?<ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto overscroll-contain">{visibleReviewManagers.map(([manager,count])=><li key={manager} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-xs"><span className="min-w-0 truncate font-medium text-slate-950" title={manager}>{manager}</span><span className="shrink-0 tabular-nums text-slate-700">{count} {count===1?"entry":"entries"}</span></li>)}</ul>:<p className="px-3 py-3 text-xs text-slate-600">No matching managers.</p>}
                  </section>
                </div>
              </div>
            </section>
          </div>
        </section>
      </WindowSurface>}
      {!rightsOnly&&adminTimesheetTool==="periods"&&<WindowSurface title="Timesheet periods" onBack={()=>setAdminTimesheetTool(null)}><section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white p-2 sm:p-3"><SubmissionDeadlineSettings defaultOpen/></section></WindowSurface>}
      {!rightsOnly&&adminTimesheetTool==="entries"&&<WindowSurface title="Timesheet view" onBack={()=>setAdminTimesheetTool(null)}><section className="flex min-h-0 w-full flex-col gap-1 overflow-hidden bg-white p-2 sm:p-3">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-green-200 bg-green-50 px-3 py-1.5"><div className="flex min-w-0 flex-wrap items-baseline gap-x-2"><h2 className="font-semibold text-green-950">Raw timesheet entries</h2><p className="text-xs text-green-900">Search, filter, group, review, and export time records.</p></div><div className="flex flex-wrap gap-1">{canCreateEntries&&<Button variant="outline" size="icon-sm" aria-label="Log time" title="Log time" onClick={onOpenEntryCapture}><Pencil className="size-4"/></Button>}<Button variant="outline" size="icon-sm" aria-label="Refresh entries" title="Refresh entries" onClick={onRefreshEntries}><Activity className="size-4"/></Button></div></header>
        <EntriesLog stateKey={`admin-timesheets:${userEmail.toLowerCase()}`} userEmail={userEmail} entries={entries} onUpdate={onEntryUpdate} onStatusChange={onEntryStatusChange} onDelete={onEntryDelete} onClear={onEntryClear} canEdit={canEditEntries} canDelete={canDeleteEntries} canClear={canClearEntries} canReview={false} canSubmit={canSubmitEntries} canSubmitOthers canExport={canExportEntries} periodView initialPeriodSelection={adminPeriodSelection} hideHeader periodToolbarCenter={canReviewEntries&&pendingEntries.length>0&&<details className="group relative mx-auto"><summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 border border-orange-200 bg-orange-50 px-2 text-xs font-medium text-orange-950 hover:bg-orange-100 [&::-webkit-details-marker]:hidden"><ShieldCheck className="size-3.5"/>Exceptional actions <span className="rounded-full bg-white px-1.5 tabular-nums">{pendingEntries.length}</span><ChevronDown className="size-3.5 transition-transform group-open:rotate-180"/></summary><div className="absolute left-0 top-full z-30 mt-1 border border-orange-200 bg-white p-1 shadow-lg"><Button type="button" variant="ghost" size="sm" className="whitespace-nowrap" onClick={()=>setReviewQueueOpen(true)}><CheckCircle2 className="size-4"/>Resolve pending timesheets</Button></div></details>} title="Raw timesheet entries" description="Search, filter, group, and export time records."/>
      </section></WindowSurface>}
      {!rightsOnly&&adminTimesheetTool==="entries"&&reviewQueueOpen&&<WindowSurface title="Review queue" onBack={()=>setReviewQueueOpen(false)}><section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white"><header className="shrink-0 border-b border-orange-200 bg-orange-50 px-4 py-3"><h2 className="font-semibold text-orange-950">Timesheets awaiting review</h2><p className="text-xs text-orange-900">{pendingEntries.length} awaiting · Admin actions require an intervention reason and remain in the audit history.</p></header><div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5"><ApprovalSelection entries={pendingEntries} email={userEmail} canReview={canReviewEntries} canAI={canAIReview} adminOverride onUpdated={onApprovalUpdated}/></div></section></WindowSurface>}
      {!rightsOnly&&adminSection==="timesheets"&&timesheetAboutOpen&&<WindowSurface title="About timesheets" onBack={()=>setTimesheetAboutOpen(false)} compact assistant={false}><section className="w-full space-y-3 bg-white p-4 text-sm"><p>Select a period to review its raw timesheets, approval tools, exports, and manual or AI-assisted workflows.</p><p>Managers normally review their assigned teams. Admins use the escalation queue for coverage, troubleshooting, or a requested override; intervention reasons are recorded in the audit history.</p></section></WindowSurface>}
      {!rightsOnly&&adminReportOpen&&<WindowSurface title="Analytics reports" onBack={()=>setAdminReportOpen(false)}><section className="min-h-0 w-full overflow-auto bg-white p-4 sm:p-6">{reportContent}</section></WindowSurface>}
      {!rightsOnly&&adminIssuesOpen&&<WindowSurface title="Issues and requests" onBack={()=>setAdminIssuesOpen(false)}><AdminIssuesWorkspace onSummaryChange={setIssueSummary}/></WindowSurface>}
      {!rightsOnly&&assistantRunsOpen&&<WindowSurface title="AI workflow activity" onBack={()=>setAssistantRunsOpen(false)}><AssistantRunReport/></WindowSurface>}
      {directoryOpen&&<WindowSurface title={rightsOnly?"Manage employees/contractors":"User directory"} onBack={()=>rightsOnly&&onExit?onExit():setDirectoryOpen(false)}>
      <section className="flex min-h-0 w-full flex-col overflow-hidden bg-white">
        <div className="border-b border-orange-200 bg-orange-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-orange-100 text-orange-800"><ShieldCheck className="size-4" aria-hidden="true" /></span>
          <div><h2 className="text-sm font-semibold text-orange-950">Admin user directory</h2><p className="text-xs text-orange-800">Patron identity and access controls</p></div>
        </div>
      </div>


        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-blue-950">Patron access</h3>
            <p className="mt-1 text-xs text-slate-600">Select a name for details; edit access explicitly with Edit and Save.</p>
          </div>
          <AddPerson admin/>
          {managementError && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {managementError}
            </p>
          )}
        </div>

      {loading || error ? (
        <div
          className={`m-4 rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
          }`}
          role={error ? "alert" : "status"}
        >
          {error ?? "Loading users..."}
        </div>
      ) : users.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium">No known users yet</p>
          <p className="mt-1 text-xs text-slate-600">
            Configured users and profile activity will appear here.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-blue-50">
              <tr className="border-b border-blue-200 text-xs uppercase tracking-wide text-blue-900">
                <th className="px-4 py-2 font-medium">Patron</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="sticky right-0 bg-blue-50 px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {directoryRoleGroups.map(group=><Fragment key={group.role}><tr className="border-y border-blue-200 bg-blue-50"><th colSpan={3} className="px-4 py-1.5 text-left text-xs font-semibold uppercase text-blue-950">{group.role.replaceAll("_"," ")} · {group.users.length}</th></tr>{group.users.map(user=><tr key={user.email} className="border-b border-slate-200 odd:bg-white even:bg-slate-50/70 last:border-0 hover:bg-orange-50"><td className="px-4 py-2"><button type="button" className="font-medium text-left text-slate-900 underline-offset-2 hover:underline" onClick={()=>setSelectedPatron(user)}>{displayOfficialName(user.displayName)}</button></td><td className="px-4 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${roleBadgeClass(user.role)}`}>{user.role}</span></td><td className="sticky right-0 bg-inherit px-4 py-2 text-right"><Button type="button" variant="outline" size="sm" className="border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100" onClick={()=>openEditUserEditor(user)} disabled={savingUser===user.email}><Pencil className="size-3.5" aria-hidden="true"/>Edit</Button></td></tr>)}</Fragment>)}
            </tbody>
          </table>
        </div>
      )}
      </section>
      </WindowSurface>}

      {selectedPatron&&<PatronDetailsDialog user={selectedPatron} editingName={editingOfficialName} nameDraft={officialNameDraft} employeeIdDraft={companyEmployeeIdDraft} error={managementError} saving={savingOfficialName} onClose={()=>{if(!savingOfficialName){setSelectedPatron(null);setEditingOfficialName(false);setManagementError(null)}}} onStartNameEdit={()=>{setOfficialNameDraft(selectedPatron.displayName.startsWith("Name Not Set ")?"":selectedPatron.displayName);setCompanyEmployeeIdDraft(selectedPatron.employeeId??"");setManagementError(null);setEditingOfficialName(true)}} onNameChange={setOfficialNameDraft} onEmployeeIdChange={setCompanyEmployeeIdDraft} onNameCancel={()=>{setEditingOfficialName(false);setManagementError(null)}} onNameSave={saveOfficialIdentity}/>}

      {activityWindowOpen && (
        <AdminActivityWindow
          events={activityReport==="api-errors"?operationalEvents:activityEvents}
          error={activityError}
          loading={activityLoading}
          hasMore={activityReport==="api-errors"?operationalCursor!==null:activityCursor!==null}
          loadingMore={activityLoadingMore}
          onLoadMore={()=>void loadMoreActivity()}
          operationalFilters={operationalFilters}
          onOperationalFilters={filters=>{setOperationalFilters(filters);void loadOperationalEvents(filters,false)}}
          auditFilters={auditFilters}
          onAuditFilters={filters=>{setAuditFilters(filters);void loadAuditEvents(filters,false,activityReport)}}
          report={activityReport}
          onClose={() => setActivityWindowOpen(false)}
        />
      )}
      {accessEditor && (
        <AdminUserAccessEditor
          editor={accessEditor}
          error={managementError}
          saving={savingUser === accessEditor.email.toLowerCase()}
          onChange={(nextEditor) => setAccessEditor(nextEditor)}
          onClose={() => {
            if (!savingUser) {
              setAccessEditor(null)
              setAccessConfirmationOpen(false)
              setReauthenticatedPendingChange(false)
            }
          }}
          onSave={saveAccessEditor}
        />
      )}
      {accessEditor && accessConfirmationOpen && <AccessChangeConfirmation
        editor={accessEditor}
        currentRole={users.find(user => user.email.toLowerCase() === accessEditor.email.toLowerCase())?.role ?? null}
        currentStatus={users.find(user => user.email.toLowerCase() === accessEditor.email.toLowerCase())?.accessStatus ?? "observed"}
        currentPermissions={users.find(user => user.email.toLowerCase() === accessEditor.email.toLowerCase())?.permissions ?? {}}
        reauthenticated={reauthenticatedPendingChange}
        saving={savingUser === accessEditor.email.toLowerCase()}
        error={managementError}
        onClose={() => setAccessConfirmationOpen(false)}
        onConfirm={confirmAccessEditor}
      />}
    </div>
  )
}

/** Renders secondary patron details and the admin-only official-name editor. */
function PatronDetailsDialog({user,editingName,nameDraft,employeeIdDraft,error,saving,onClose,onStartNameEdit,onNameChange,onEmployeeIdChange,onNameCancel,onNameSave}:{user:AdminDirectoryUser;editingName:boolean;nameDraft:string;employeeIdDraft:string;error:string|null;saving:boolean;onClose:()=>void;onStartNameEdit:()=>void;onNameChange:(value:string)=>void;onEmployeeIdChange:(value:string)=>void;onNameCancel:()=>void;onNameSave:()=>void}) {
  const rights=Object.values(resolvePermissions(user.role==="none"||user.accessStatus!=="active"?null:user.role,user.permissions)).filter(Boolean).length
  return <WindowSurface title={displayOfficialName(user.displayName)} onBack={onClose} disabled={saving} compact>
    <section aria-labelledby="patron-details-title" className="flex min-h-0 w-full flex-col overflow-auto bg-white text-slate-950">
      <header className="border-b border-blue-200 bg-blue-50 p-4"><h2 id="patron-details-title" className="font-semibold text-blue-950">{displayOfficialName(user.displayName)}</h2><p className="mt-1 text-xs text-blue-800">{user.role} · {user.accessStatus === "observed" ? "Observed" : accessStatusLabel(user.accessStatus)}</p></header>
      <div className="grid gap-x-5 gap-y-3 p-4 text-sm sm:grid-cols-2">
        <DetailField label="Company reference" value={user.companyReference??"Not assigned"}/>
        <DetailField label="Permanent account ID" value={user.contractorNumber??"Not assigned"}/>
        <DetailField label="Official email" value={user.email}/>
        <DetailField label="Company-issued ID" value={user.employeeId||"Not provided"}/>
        <DetailField label="Access source" value={user.accessSource}/>
        <DetailField label="Effective rights" value={`${rights} allowed`}/>
        <DetailField label="Access note" value={user.note||"None"}/>
        {user.updatedBy&&<DetailField label="Last access update" value={`${user.updatedBy}${user.updatedAt?` · ${formatAdminDateTime(user.updatedAt)}`:""}`}/>}
      </div>
      <div className="border-t p-4">
        {editingName?<form onSubmit={event=>{event.preventDefault();onNameSave()}} className="space-y-3"><label className="block text-sm font-medium">Official name<input autoFocus required minLength={2} maxLength={80} value={nameDraft} onChange={event=>onNameChange(event.target.value)} className="mt-1 h-10 w-full rounded border border-slate-300 px-3 font-normal"/></label><label className="block text-sm font-medium">Company-issued ID<input aria-label="Company-issued ID" maxLength={64} value={employeeIdDraft} onChange={event=>onEmployeeIdChange(event.target.value)} className="mt-1 h-10 w-full rounded border border-slate-300 px-3 font-normal"/><span className="mt-1 block text-xs font-normal text-slate-500">Leave blank to clear this company ID. Generated account and company reference IDs cannot be changed.</span></label>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onNameCancel}>Cancel</Button><Button type="submit" disabled={saving}>{saving?"Saving...":"Save changes"}</Button></div></form>:<div className="flex items-center justify-between gap-3"><p className="text-xs text-slate-500">Official name and company-issued ID are visible to authorized company users.</p><Button variant="outline" size="sm" onClick={onStartNameEdit}><Pencil className="size-3.5"/>Edit identity</Button></div>}
      </div>
    </section>
  </WindowSurface>
}

/** Renders a single label/value item in the compact patron details window. */
function DetailField({label,value}:{label:string;value:string}) {
  return <div className="min-w-0"><p className="text-[11px] font-medium uppercase text-slate-500">{label}</p><p className="mt-0.5 break-words">{value}</p></div>
}

/**
 * Renders the admin-only user access editor window.
 *
 * The editor deliberately separates selecting role or permission values from
 * saving them. Admins can click through choices in this window, but the server is
 * contacted only when they press Save.
 *
 * @param props - Access editor props.
 * @param props.editor - Current editor draft state.
 * @param props.error - Optional save error returned by the admin API.
 * @param props.saving - Whether the current editor row is being saved.
 * @param props.onChange - Callback for updating draft editor state.
 * @param props.onClose - Callback invoked when the editor is dismissed.
 * @param props.onSave - Callback invoked by the Save button.
 * @returns The dynamic role and permission editor window.
 */
function AdminUserAccessEditor({
  editor,
  error,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  editor: AccessEditorState
  error: string | null
  saving: boolean
  onChange: (nextEditor: AccessEditorState) => void
  onClose: () => void
  onSave: () => void
}) {
  const title =
    editor.mode === "add" ? "Add patron access" : "Edit patron access"

  return (
    <WindowSurface title={title} onBack={onClose} disabled={saving} compact resizable>
      <section
        tabIndex={-1}
        className="tech-surface flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-950 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-orange-200 bg-orange-50 px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-orange-100 text-orange-800"><Users className="size-4" aria-hidden="true" /></span>
              <h2 className="text-base font-semibold text-orange-950">{title}</h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Set the account role, lifecycle status, and control rights, then
              save to apply the change.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={onClose}
            disabled={saving}
            title="Close access editor"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close access editor</span>
          </Button>
        </div>

        <div className="grid min-h-0 content-start gap-4 overflow-y-auto overscroll-contain p-4 lg:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">
            Account email
            <input
              type="email"
              value={editor.email}
              onChange={(event) =>
                onChange({ ...editor, email: event.target.value })
              }
              placeholder="employee@company.com"
              disabled={editor.mode === "edit" || saving}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </label>

          <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
            <p className="text-xs font-semibold text-blue-900">Role</p>
            <div className="role-choice-grid mt-2">
              {manageableRoles.map((roleOption) => (
                <button
                  key={roleOption}
                  type="button"
                  onClick={() => onChange({ ...editor, role: roleOption })}
                  aria-pressed={editor.role === roleOption}
                  disabled={saving || editor.protectedAdmin}
                  className={`min-h-12 min-w-0 whitespace-normal break-words rounded-md border px-2 py-2 text-xs font-medium capitalize transition sm:px-3 sm:text-sm ${
                    editor.role === roleOption
                      ? roleSelectionClass(roleOption)
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {roleDisplayName(roleOption)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {roleRights(editor.role).join(" · ")}
            </p>
            {editor.protectedAdmin&&<p className="mt-2 text-xs text-primary">{editor.environmentAdmin?"Recovery administrators are managed in deployment settings.":"At least one active admin is required. Add another admin before changing this role or access state."}</p>}
          </div>

          <div className="rounded-md border border-orange-200 bg-orange-50/60 p-3">
            <p className="text-xs font-semibold text-orange-900">
              Account status
            </p>
            <div className="status-choice-grid mt-2">
              {manageableStatuses.map((statusOption) => (
                <button
                  key={statusOption}
                  type="button"
                  onClick={() =>
                    onChange({ ...editor, accessStatus: statusOption })
                  }
                  title={accessStatusDescription(statusOption)}
                  aria-pressed={editor.accessStatus === statusOption}
                  disabled={saving || editor.protectedAdmin}
                  className={`min-h-10 rounded-md border px-2 py-2 text-xs font-semibold transition sm:px-3 sm:text-sm ${
                    editor.accessStatus === statusOption
                      ? accessStatusClass(statusOption)
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {accessStatusLabel(statusOption)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-orange-950">{accessStatusDescription(editor.accessStatus)}</p>
          </div>

          <label className="text-xs font-medium text-slate-600">
            Administrator note (required when changing rights)
            <textarea
              value={editor.note}
              onChange={(event) =>
                onChange({ ...editor, note: event.target.value })
              }
              placeholder="Explain why these access rights are changing"
              maxLength={500}
              disabled={saving}
              className="mt-1 min-h-24 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </label>

          <fieldset className="min-w-0 rounded-md border border-emerald-200 bg-emerald-50/30 p-3 lg:col-span-2">
            <legend className="mb-2 px-1 text-sm font-semibold text-emerald-950">Patron controls</legend>
            <p className="mb-3 text-xs text-slate-600">Set access by work area. Controls that conflict with the selected role stay disabled; saved changes require confirmation.</p>
            <div className="grid gap-x-5 gap-y-1 md:grid-cols-2">
              {permissionGroups.map(group=>{
                const effective=resolvePermissions(editor.role,editor.permissions)
                const assignable=group.permissions.filter(permission=>canAssignPermission(editor.role,permission))
                const enabled=assignable.filter(permission=>effective[permission]).length
                const tone={orange:"border-orange-400",blue:"border-blue-400",green:"border-emerald-400",red:"border-red-400",sky:"border-sky-400"}[group.tone]
                return <details key={group.label} aria-label={group.label} className={`group min-w-0 border-l-2 ${tone} py-1 pl-3`}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-90" aria-hidden="true" />
                    <span className="min-w-0 flex-1 font-semibold text-slate-900">{group.label}<span className="ml-2 font-normal text-slate-500">{enabled}/{assignable.length} enabled</span></span>
                  </summary>
                  <div className="pb-2 pl-1">
                  <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex gap-1"><Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={saving||!assignable.length||enabled===assignable.length} onClick={()=>onChange({...editor,permissions:{...editor.permissions,...Object.fromEntries(assignable.map(permission=>[permission,true]))}})}>Enable all</Button><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving||!assignable.length||enabled===0} onClick={()=>onChange({...editor,permissions:{...editor.permissions,...Object.fromEntries(assignable.map(permission=>[permission,false]))}})}>Disable all</Button></div>
                  </header>
                  <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                    {group.permissions.map(permission=>{
                      const allowed=canAssignPermission(editor.role,permission)
                      return <label key={permission} title={allowed?permissionLabels[permission]:`Unavailable to the ${roleDisplayName(editor.role)} role`} className={`flex min-w-0 items-start gap-2 text-xs ${allowed?"text-slate-800":"text-slate-400"}`}>
                        <input className="mt-0.5 accent-emerald-700" type="checkbox" disabled={saving||!allowed} checked={effective[permission]} onChange={event=>onChange({...editor,permissions:{...editor.permissions,[permission]:event.target.checked}})} />
                        <span className="min-w-0">{permissionLabels[permission]}{!allowed&&<span className="ml-1 text-[10px]">(role-limited)</span>}</span>
                      </label>
                    })}
                  </div>
                  </div>
                </details>
              })}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3" disabled={saving||Object.keys(editor.permissions??{}).length===0} onClick={() => onChange({...editor,permissions:{}})}>Use role defaults</Button>
          </fieldset>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-orange-200 bg-orange-50 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-orange-600 text-white hover:bg-orange-700"
            onClick={onSave}
            disabled={saving || !editor.email.trim()}
          >
            <Save className="size-4" aria-hidden="true" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </section>
    </WindowSurface>
  )
}

/** Requires a deliberate review before saving an administrator access draft. */
function AccessChangeConfirmation({editor,currentRole,currentStatus,currentPermissions,reauthenticated,saving,error,onClose,onConfirm}: {
  editor: AccessEditorState
  currentRole: UserRole | "none" | null
  currentStatus: AccessStatus | "observed"
  currentPermissions?: PermissionOverrides
  reauthenticated: boolean
  saving: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const current = currentRole && currentRole !== "none"
    ? { role: currentRole, accessStatus: currentStatus === "observed" ? "active" : currentStatus, permissions: currentPermissions }
    : null
  const highImpact = accessChangeRequiresStepUp(current, { role: editor.role, accessStatus: editor.accessStatus, permissions: editor.permissions })
  const previousRights = resolvePermissions(currentRole && currentRole !== "none" ? currentRole : null, currentPermissions)
  const nextRights = resolvePermissions(editor.role, editor.permissions)
  const changedRights = (Object.keys(permissionLabels) as Permission[]).filter(permission => previousRights[permission] !== nextRights[permission])

  return <WindowSurface title="Confirm access change" onBack={onClose} disabled={saving} compact>
    <section className="flex min-h-0 w-full flex-col overflow-auto bg-white text-slate-950">
      <header className="border-b border-orange-200 bg-orange-50 px-4 py-3">
        <h2 className="font-semibold text-orange-950">Are you sure you want to make this change?</h2>
        <p className="mt-1 text-xs text-orange-900">Review the account and access changes before saving.</p>
      </header>
      <div className="grid gap-3 p-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="border-l-4 border-blue-500 bg-blue-50 px-3 py-2"><p className="text-xs font-medium text-blue-800">Account</p><p className="break-all font-semibold text-blue-950">{editor.email}</p></div>
          <div className="border-l-4 border-orange-500 bg-orange-50 px-3 py-2"><p className="text-xs font-medium text-orange-800">Role</p><p className="font-semibold text-orange-950">{currentRole && currentRole !== "none" ? roleDisplayName(currentRole) : "Not assigned"} → {roleDisplayName(editor.role)}</p></div>
          <div className="border-l-4 border-red-500 bg-red-50 px-3 py-2"><p className="text-xs font-medium text-red-800">Account status</p><p className="font-semibold text-red-950">{currentStatus === "observed" ? "Observed" : accessStatusLabel(currentStatus)} → {accessStatusLabel(editor.accessStatus)}</p></div>
          <div className="border-l-4 border-green-600 bg-green-50 px-3 py-2"><p className="text-xs font-medium text-green-800">Control rights</p><p className="font-semibold text-green-950">{changedRights.length ? `${changedRights.length} change${changedRights.length === 1 ? "" : "s"}` : "No changes"}</p></div>
        </div>
        {changedRights.length > 0 && <p className="text-xs leading-5 text-slate-700">{changedRights.map(permission => `${permissionLabels[permission]}: ${previousRights[permission] ? "allowed" : "not allowed"} → ${nextRights[permission] ? "allowed" : "not allowed"}`).join(" · ")}</p>}
        {editor.note.trim() && <p className="border-t border-slate-200 pt-2 text-xs text-slate-600">Admin note: {editor.note.trim()}</p>}
        {highImpact && <p role="note" className="border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs leading-5 text-red-950">This change affects elevated access or account availability. Confirm your identity with Microsoft before the final save. Tanovo Time never asks for your Microsoft password.</p>}
        {reauthenticated && <p role="status" className="border-l-4 border-green-600 bg-green-50 px-3 py-2 text-xs text-green-950">Microsoft reauthentication completed. Review this change once more, then confirm the save.</p>}
        {error && <p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </div>
      <footer className="mt-auto flex flex-wrap justify-end gap-2 border-t border-orange-200 bg-orange-50 px-4 py-3">
        <Button variant="outline" disabled={saving} onClick={onClose}>Back to editor</Button>
        <Button disabled={saving} onClick={onConfirm} className={highImpact && !reauthenticated ? "bg-blue-700 text-white hover:bg-blue-800" : "bg-orange-600 text-white hover:bg-orange-700"}>
          {saving ? "Saving..." : highImpact && !reauthenticated ? "Verify with Microsoft" : "Confirm and save"}
        </Button>
      </footer>
    </section>
  </WindowSurface>
}

/**
 * Summarizes the currently loaded audit slice using visual severity cues.
 * @param props.label - Audit metric name.
 * @param props.value - Bounded value derived from the loaded event set.
 * @param props.tone - Accent used to distinguish related audit metrics.
 * @returns A compact metric cell for the activity workspace.
 */
function AuditSummary({label,value,tone}:{label:string;value:string;tone:"blue"|"green"|"orange"|"purple"}) {
  const tones={
    blue:"border-blue-200 text-blue-800",
    green:"border-emerald-200 text-emerald-800",
    orange:"border-orange-200 text-orange-800",
    purple:"border-violet-200 text-violet-800",
  }
  return <div className={`min-w-0 border-r px-2 py-1.5 last:border-r-0 ${tones[tone]}`}>
    <p className="text-[10px] font-semibold uppercase tracking-wide">{label}</p>
    <p className="truncate text-xs font-medium text-slate-900" title={value}>{value}</p>
  </div>
}

/**
 * Renders the full administrator activity window.
 *
 * This modal-style window stays inside the admin-only panel and presents a larger
 * audit-event set with detailed target, request, and metadata information. The
 * white surface is intentionally explicit so administrators can distinguish this
 * security review area from the rest of the app workspace.
 *
 * @param props - Activity window props.
 * @param props.events - Audit events to display.
 * @param props.error - Optional loading error.
 * @param props.loading - Whether extended audit events are loading.
 * @param props.onClose - Callback invoked when the window is dismissed.
 * @returns The admin-only full activity window.
 */
function AdminActivityWindow({
  events,
  report,
  error,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  operationalFilters,
  onOperationalFilters,
  auditFilters,
  onAuditFilters,
  onClose,
}: {
  events: AdminAuditEvent[]
  report:AdminAuditReport|null
  error: string | null
  loading: boolean
  hasMore:boolean
  loadingMore:boolean
  onLoadMore:()=>void
  operationalFilters:OperationalFilters
  onOperationalFilters:(filters:OperationalFilters)=>void
  auditFilters:OperationalFilters
  onAuditFilters:(filters:OperationalFilters)=>void
  onClose: () => void
}) {
  const [selectedEvent, setSelectedEvent] = useState<AdminAuditEvent | null>(
    null,
  )
  const [showSecurity, setShowSecurity] = useState(false)
  const [showErrors,setShowErrors]=useState(report==="api-errors")
  const activeFilters=report==="api-errors"?operationalFilters:auditFilters
  const updateFilters=report==="api-errors"?onOperationalFilters:onAuditFilters
  const [search,setSearch]=useState(activeFilters.search)
  const [dateFrom,setDateFrom]=useState(activeFilters.from)
  const [dateThrough,setDateThrough]=useState(activeFilters.through)
  const [categoryFilter,setCategoryFilter]=useState(activeFilters.category)
  const [statusFilter,setStatusFilter]=useState(activeFilters.status)
  const [groupBy,setGroupBy]=useState<"day"|"month"|"year"|"period">("day")
  const [periodFilter,setPeriodFilter]=useState("all")
  const [sortOrder,setSortOrder]=useState<"newest"|"oldest">("newest")
  const [periods,setPeriods]=useState<{id:string;name:string;startDate:string;endDate:string}[]>([])
  const filterMount=useRef(false)
  useEffect(()=>{
    if(!filterMount.current){filterMount.current=true;return}
    const selectedPeriod=periods.find(period=>period.id===periodFilter)
    const timeout=setTimeout(()=>updateFilters({search,from:dateFrom||selectedPeriod?.startDate||"",through:dateThrough||selectedPeriod?.endDate||"",category:categoryFilter,status:statusFilter}),300)
    return()=>clearTimeout(timeout)
  },[search,dateFrom,dateThrough,categoryFilter,statusFilter,periodFilter,report])
  useEffect(()=>{let active=true;void fetch(apiPath("/api/timesheet-periods"),{cache:"no-store"}).then(async response=>response.ok?response.json():null).then(data=>{if(active&&Array.isArray(data?.periods))setPeriods(data.periods)}).catch(()=>{});return()=>{active=false}},[])
  const dayOf=(event:AdminAuditEvent)=>event.occurredAt.slice(0,10)
  const periodOf=(event:AdminAuditEvent)=>periods.find(period=>dayOf(event)>=period.startDate&&dayOf(event)<=period.endDate)
  const visibleEvents=events.filter(event=>{
    const day=dayOf(event),period=periodOf(event)
    const haystack=[event.actorEmail,event.action,event.targetType,event.targetId??"",event.requestPath??"",event.requestMethod??"",event.userAgent??"",formatAuditMetadata(event)].join(" ").toLowerCase()
    const isOperational=event.action==="operational_failure"||event.action==="client_error_reported"
    const matchesReport=report==="api-errors"?isOperational:report===null?true:report==="access"?(event.targetType==="managed_user_access"||event.targetType==="account_identity")&&["user_access_created","user_access_updated"].includes(event.action):report==="periods"?event.targetType==="timesheet_period"&&["timesheet_period_created","timesheet_period_updated"].includes(event.action):event.targetType==="time_project"&&["project_created","project_updated"].includes(event.action)
    const errorsOnly=report==="api-errors"||showErrors
    return matchesReport&&(!errorsOnly||isOperational)&&(!dateFrom||day>=dateFrom)&&(!dateThrough||day<=dateThrough)&&(periodFilter==="all"||period?.id===periodFilter)&&(!search.trim()||haystack.includes(search.trim().toLowerCase()))
  }).sort((a,b)=>sortOrder==="newest"?b.occurredAt.localeCompare(a.occurredAt):a.occurredAt.localeCompare(b.occurredAt))
  const groupedEvents=Array.from(visibleEvents.reduce((groups,event)=>{
    const day=dayOf(event),period=periodOf(event)
    const key=groupBy==="day"?day:groupBy==="month"?day.slice(0,7):groupBy==="year"?day.slice(0,4):period?.id??"unassigned"
    const group=groups.get(key)??{label:groupBy==="day"?formatAdminDateTime(`${day}T00:00:00.000Z`).split(",")[0]:groupBy==="month"?new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined,{month:"long",year:"numeric"}):groupBy==="year"?key:period?.name??"Outside configured timesheet periods",events:[] as AdminAuditEvent[]}
    group.events.push(event);groups.set(key,group);return groups
  },new Map<string,{label:string;events:AdminAuditEvent[]}>()).entries())

  return (
    <WindowSurface title={report===null?"All app activity":report==="access"?"Access change history":report==="periods"?"Timesheet period history":report==="api-errors"?"API error report":"Project history"} onBack={onClose}>
      <section className="tech-surface flex h-full min-h-0 w-full flex-col overflow-hidden border-0 bg-white text-slate-950">
        <div className="flex shrink-0 items-center justify-between gap-3 border-x border-t border-blue-300 bg-blue-50 px-4 py-2">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Activity className="size-4 text-blue-700" aria-hidden="true" />
              <h2 className="mr-1 text-sm font-semibold text-blue-950">{report===null?"All app activity":report==="access"?"Access change history":report==="periods"?"Timesheet period history":report==="api-errors"?"API error report":"Project history"}</h2>
              {report===null&&<><Button variant={showErrors?"default":"outline"} size="sm" onClick={()=>setShowErrors(false)}>All activity</Button>
              <Button variant={showErrors?"default":"outline"} size="sm" className={showErrors?"bg-red-700 hover:bg-red-800":"border-red-200 bg-red-50 text-red-800 hover:bg-red-100"} onClick={()=>setShowErrors(true)}>Application errors ({events.filter(event=>event.action==="client_error_reported"||event.action==="operational_failure").length})</Button>
              <Button variant="outline" className="border-red-200 bg-red-50 text-red-800 hover:bg-red-100" onClick={() => setShowSecurity(true)}>Security risks</Button></>}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={onClose}
            title="Close activity window"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close activity window</span>
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-sky-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-2 py-1.5">
          <label className="min-w-48 flex-1 text-[11px] font-medium text-slate-700">Search logs<input aria-label="Search audit logs" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Actor, action, request, target…" className="mt-0.5 h-7 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"/></label>
          <DataExportMenu title={report===null?"App activity":report==="access"?"Access change history":report==="periods"?"Timesheet period history":report==="api-errors"?"API error report":"Project history"} filename="admin-activity" rows={visibleEvents.map(event=>({occurredAt:event.occurredAt,actor:event.actorEmail,action:formatAuditAction(event.action),targetType:event.targetType,targetId:event.targetId??"",requestMethod:event.requestMethod??"",requestPath:event.requestPath??"",requestId:event.requestId??"",metadata:event.metadata}))} summary={{events:visibleEvents.length,actors:new Set(visibleEvents.map(event=>event.actorEmail)).size,from:dateFrom||"Any",through:dateThrough||"Any",period:periodFilter==="all"?"All periods":`${periods.find(period=>period.id===periodFilter)?.name??"Selected period"} · ${periodFilter}`}}/>
          <details className="group relative z-20 min-w-0">
            <summary className="flex h-7 cursor-pointer list-none items-center rounded-md border border-sky-200 bg-white px-2 text-[11px] font-medium text-sky-950 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden"><SlidersHorizontal className="mr-1 size-3"/>View options<ChevronDown className="ml-1.5 size-3 transition-transform group-open:rotate-180"/></summary>
            <div className="absolute right-0 z-10 mt-1 grid max-h-[min(70vh,32rem)] w-[min(48rem,calc(100vw-1rem))] grid-cols-1 gap-2 overflow-y-auto rounded-md border border-sky-200 bg-white p-3 shadow-lg sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <label className="min-w-0 text-xs font-medium text-slate-700">From<input aria-label="Audit date from" type="date" value={dateFrom} max={dateThrough||undefined} onChange={event=>setDateFrom(event.target.value)} className="mt-1 h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs"/></label>
          <label className="min-w-0 text-xs font-medium text-slate-700">Through<input aria-label="Audit date through" type="date" value={dateThrough} min={dateFrom||undefined} onChange={event=>setDateThrough(event.target.value)} className="mt-1 h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs"/></label>
          <label className="min-w-0 text-xs font-medium text-slate-700">{report==="api-errors"?"Failure category":"Record type"}<select aria-label={report==="api-errors"?"API failure category":"Audit record type"} value={categoryFilter} onChange={event=>setCategoryFilter(event.target.value)} className="mt-1 h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs">
            <option value="">All types</option>
            {report==="api-errors"?<><option value="authorization_denied">Authorization denied</option><option value="validation_failed">Validation failed</option><option value="workflow_conflict">Workflow conflict</option><option value="server_error">Server error</option><option value="request_failed">Other request failure</option><option value="client_error">Reported client error</option></>:<>{["time_entry","timesheet_period","time_project","managed_user_access","account_identity","submission_extension","app_issue","review_request"].map(type=><option key={type} value={type}>{type.replaceAll("_"," ")}</option>)}</>}
          </select></label>
          {report==="api-errors"&&<label className="min-w-0 text-xs font-medium text-slate-700">HTTP status<select aria-label="API HTTP status filter" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)} className="mt-1 h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="">All failures</option>{[400,401,403,404,409,413,422,429,500,502,503,504].map(status=><option key={status} value={String(status)}>{status}</option>)}</select></label>}
          <label className="min-w-0 text-xs font-medium text-slate-700">Timesheet period<select aria-label="Audit timesheet period filter" value={periodFilter} onChange={event=>setPeriodFilter(event.target.value)} className="mt-1 h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="all">All periods</option>{periods.map(period=><option key={period.id} value={period.id}>{period.name}</option>)}</select></label>
          <label className="min-w-0 text-xs font-medium text-slate-700">Group by<select aria-label="Group audit logs by" value={groupBy} onChange={event=>setGroupBy(event.target.value as typeof groupBy)} className="mt-1 h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="day">Day</option><option value="month">Month</option><option value="year">Year</option><option value="period">Timesheet period</option></select></label>
          <label className="min-w-0 text-xs font-medium text-slate-700">Sort<select aria-label="Sort audit logs" value={sortOrder} onChange={event=>setSortOrder(event.target.value as typeof sortOrder)} className="mt-1 h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            </div>
          </details>
          <span className="text-[11px] tabular-nums text-slate-600">{visibleEvents.length} events</span>
        </div>
        {error&&events.length>0&&<p role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        {!loading && !error && visibleEvents.length > 0 && <div className="grid shrink-0 grid-cols-2 border-b border-sky-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 sm:grid-cols-4">
          <AuditSummary label="Events shown" value={String(visibleEvents.length)} tone="blue" />
          <AuditSummary label="Distinct actors" value={String(new Set(visibleEvents.map(event => event.actorEmail)).size)} tone="green" />
          <AuditSummary label="Action types" value={String(new Set(visibleEvents.map(event => event.action)).size)} tone="orange" />
          <AuditSummary label="Latest event" value={formatAdminDateTime(visibleEvents[0].occurredAt)} tone="purple" />
        </div>}

        {showSecurity && <SecurityRiskWindow onClose={() => setShowSecurity(false)} />}
          {loading || (error&&events.length===0) ? (
          <div
            className={`m-4 rounded-lg border px-4 py-3 text-sm ${
              error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
            role={error ? "alert" : "status"}
          >
            {error ?? "Loading app activity..."}
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">{showErrors?"No application errors recorded":report?"No matching audit events recorded":"No app activity recorded yet"}</p>
            <p className="mt-1 text-xs text-slate-600">
              {showErrors?"Failed user actions will appear here with a reference and diagnostic context.":"Audited actions will appear here after users change app data."}
            </p>
          </div>
        ) : (
          <div tabIndex={0} aria-label="Activity table" className="min-h-0 flex-1 overflow-auto overscroll-contain border-x border-b border-slate-300 bg-white shadow-inner">
            <table className="w-full min-w-[1080px] table-fixed border-collapse text-left text-xs">
            <thead className="sticky top-0 z-[1] bg-blue-50 shadow-sm">
                <tr className="border-b border-blue-200 text-[10px] uppercase tracking-wide text-blue-900">
                  <th className="w-[16%] px-4 py-2 font-medium">Time</th>
                  <th className="w-[20%] px-4 py-2 font-medium">Actor</th>
                  <th className="w-[22%] px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">{report==="api-errors"?"API call":report===null?"Target / request":report==="access"?"Patron":"Created record"}</th>
                  {report==="api-errors"&&<><th className="w-28 border-l border-blue-200 px-4 py-2 font-medium">HTTP status</th><th className="w-36 border-l border-blue-200 px-4 py-2 font-medium">Error code</th></>}
                  <th className="w-[12%] px-4 py-2 text-right font-medium">Details</th>
                </tr>
              </thead>
              {groupedEvents.map(([groupKey,group])=><tbody key={groupKey}>
                <tr className="sticky top-7 z-[1] bg-emerald-50 text-[11px] text-emerald-950"><th colSpan={report==="api-errors"?7:5} className="border-y border-emerald-200 px-4 py-2 text-left font-semibold">{group.label}<span className="ml-2 font-normal text-emerald-800">{group.events.length}</span></th></tr>
                {group.events.map((event) => (
                  <Fragment key={event.id}>
                  <tr
                    className={`cursor-pointer border-b border-slate-200 align-middle outline-none odd:bg-white even:bg-sky-50/60 last:border-0 hover:bg-orange-50 focus:bg-blue-100 ${
                      selectedEvent?.id === event.id ? "bg-blue-100" : ""
                    }`}
                    tabIndex={0}
                    aria-expanded={selectedEvent?.id === event.id}
                    onClick={() => setSelectedEvent(current=>current?.id===event.id?null:event)}
                    onKeyDown={(keyboardEvent) => {
                      if (
                        keyboardEvent.key === "Enter" ||
                        keyboardEvent.key === " "
                      ) {
                        keyboardEvent.preventDefault()
                        setSelectedEvent(current=>current?.id===event.id?null:event)
                      }
                    }}
                  >
                    <td className="whitespace-nowrap border-r border-slate-100 px-4 py-2 text-[11px] text-slate-600">
                      {formatAdminDateTime(event.occurredAt)}
                    </td>
                    <td className="border-r border-slate-100 px-4 py-2 font-medium"><span className="inline-flex max-w-full truncate rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-950">{event.actorEmail}</span></td>
                    <td className="border-r border-slate-100 px-4 py-2"><span className={`inline-flex max-w-full truncate rounded border px-1.5 py-0.5 text-[11px] font-semibold capitalize ${auditActionTone(event.action)}`}>{formatAuditAction(event.action)}</span></td>
                    <td className="px-4 py-2 text-[11px] text-slate-600">
                      {report==="api-errors"?<><span className="block truncate font-mono font-semibold text-slate-900">{String(event.metadata.operation??"API request")}</span><span className="block truncate font-mono text-[10px] text-slate-600">{String(event.metadata.httpMethod??"—")} {String(event.metadata.route??event.requestPath??"Unknown route")}</span><span className="block truncate text-[10px] text-slate-500">Ref {event.targetId??"not recorded"}</span></>:report===null?<><span className={`mr-1 inline-flex rounded border px-1 py-0.5 font-medium ${auditTargetTone(event.targetType)}`}>{event.targetType.replaceAll("_", " ")}</span><span className="truncate font-mono">{event.requestMethod??""} {event.requestPath??event.targetId??""}</span></>:<><span className="block truncate font-medium text-slate-900">{report==="access"?event.targetId??"Unknown patron":typeof event.metadata.name==="string"?event.metadata.name:event.targetId??"Unknown record"}</span>{report==="periods"&&<span className="block text-[10px] text-slate-500">{String(event.metadata.startDate??"").slice(0,10)} – {String(event.metadata.endDate??"").slice(0,10)}</span>}</>}
                    </td>
                    {report==="api-errors"&&<><td className="border-l border-slate-100 px-4 py-2"><span className="inline-flex rounded border border-red-200 bg-red-50 px-1.5 py-0.5 font-mono font-semibold text-red-900">{typeof event.metadata.httpStatus==="number"?event.metadata.httpStatus:"—"}</span></td><td className="border-l border-slate-100 px-4 py-2 font-mono text-[11px] text-slate-700">{typeof event.metadata.errorCode==="string"?event.metadata.errorCode:"not supplied"}</td></>}
                    <td className="px-4 py-2 text-right text-[10px] text-slate-600">
                      {selectedEvent?.id === event.id ? "Close details" : `${Object.keys(event.metadata).length} fields · open`}
                    </td>
                  </tr>
                  {selectedEvent?.id===event.id&&<tr className="bg-blue-50/70"><td colSpan={report==="api-errors"?7:5} className="border-b border-blue-200 p-2"><AdminActivityEventDetails event={event} onClose={()=>setSelectedEvent(null)}/></td></tr>}
                  </Fragment>
                ))}
              </tbody>)}
            </table>
          </div>
        )}

        {!loading&&hasMore&&<div className="flex shrink-0 justify-center border-t border-sky-200 bg-sky-50/70 p-2"><Button variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>{loadingMore?"Loading older events…":error?"Retry loading older events":"Load older activity"}</Button></div>}

      </section>
    </WindowSurface>
  )
}

/**
 * Renders full data and metadata for a selected audit activity event.
 *
 * The detail panel is intentionally read-only and white, matching the admin
 * activity window while exposing the complete event record needed for review.
 *
 * @param props - Detail panel props.
 * @param props.event - Selected audit event to inspect.
 * @param props.onClose - Callback invoked when the detail panel is dismissed.
 * @returns Selected audit event detail panel.
 */
function AdminActivityEventDetails({
  event,
  onClose,
}: {
  event: AdminAuditEvent
  onClose: () => void
}) {
  const details = [
    { label: "Event ID", value: event.id },
    { label: "Occurred", value: formatAdminDateTime(event.occurredAt) },
    { label: "Actor", value: event.actorEmail },
    { label: "Action", value: formatAuditAction(event.action) },
    { label: "Target type", value: event.targetType },
    { label: "Target ID", value: event.targetId ?? "No target id" },
    { label: "IP address", value: event.ipAddress ?? "Unknown" },
    { label: "User agent", value: event.userAgent ?? "Unknown" },
    { label: "Request method", value: event.requestMethod ?? "Unknown" },
    { label: "Request path", value: event.requestPath ?? "Unknown" },
    { label: "Request ID", value: event.requestId ?? "Unavailable" },
  ]

  return (
    <section aria-label="Activity detail" className="w-full bg-white">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold">Activity detail</h3>
          <p className="text-[11px] text-slate-600">
            {formatAuditAction(event.action)} by {event.actorEmail}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
          onClick={onClose}
          title="Close detail"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Close detail</span>
        </Button>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <dl className="grid gap-1.5 sm:grid-cols-3">
          {details.map((detail) => (
            <div
              key={detail.label}
              className="rounded border border-blue-200 bg-blue-50/70 px-2 py-1.5"
            >
              <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {detail.label}
              </dt>
              <dd className="break-all text-xs text-slate-900">
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="rounded border border-orange-200 bg-orange-50/70 p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Metadata
          </p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-orange-100 bg-white p-2 font-mono text-[11px] leading-snug text-slate-800">
            {formatAuditMetadataBlock(event)}
          </pre>
        </div>
      </div>
    </section>
  )
}

/**
 * Converts roles into a seniority rank for admin directory ordering.
 *
 * Admins appear first, then managers, employees, base users, and finally
 * observed accounts without an assigned role.
 *
 * @param role - Role to rank for directory sorting.
 * @returns Numeric seniority rank used for descending ordering.
 */
function roleSeniority(role: UserRole | "none") {
  if (role === "admin") return 4
  if (role === "manager") return 3
  if (role === "account_manager") return 3
  if (role === "employee") return 2
  if (role === "contractor") return 1
  return 0
}

/**
 * Sorts admin directory rows from highest to lowest seniority.
 *
 * Rows with the same role are ordered alphabetically by email so the directory is
 * stable after saves, reloads, and API responses.
 *
 * @param users - Directory rows to order.
 * @returns A new array sorted by role seniority and email.
 */
function sortAdminDirectoryUsers(users: AdminDirectoryUser[]) {
  return [...users].sort((a, b) => {
    const seniorityDelta = roleSeniority(b.role) - roleSeniority(a.role)
    if (seniorityDelta !== 0) return seniorityDelta
    return a.email.localeCompare(b.email)
  })
}

/**
 * Returns the visible rights granted by a role.
 *
 * The labels are intentionally short so they can fit inside the admin directory
 * table while still making each role's practical permissions clear.
 *
 * @param role - Role assigned to the user.
 * @returns Human-readable rights labels for the role.
 */
function roleRights(role: UserRole | "none") {
  if (role === "account_manager") return ["admin-assigned business account rights"]
  if (role === "admin") {
    return ["all entries", "approvals", "reports", "users", "audit"]
  }
  if (role === "manager") {
    return ["team entries", "approvals", "reports"]
  }
  if (role === "employee") {
    return ["own entries", "submit time"]
  }
  if (role === "contractor") {
    return ["own entries", "submit time"]
  }
  return ["no assigned rights"]
}

/**
 * Returns the white-admin-table badge style for a user role.
 *
 * @param role - Role shown in the admin directory.
 * @returns Tailwind classes for the role badge.
 */
function roleBadgeClass(role: UserRole | "none") {
  if (role === "account_manager") return "border-rose-200 bg-rose-50 text-rose-700"
  if (role === "admin") {
    return "border-blue-200 bg-blue-50 text-blue-700"
  }
  if (role === "manager") {
    return "border-cyan-200 bg-cyan-50 text-cyan-700"
  }
  if (role === "employee") {
    return "border-green-200 bg-green-50 text-green-700"
  }
  if (role === "contractor") {
    return "border-slate-200 bg-slate-50 text-slate-700"
  }
  return "border-slate-200 bg-slate-100 text-slate-500"
}

/** Returns a distinct, high-contrast selected-role treatment in the admin editor. */
function roleSelectionClass(role: UserRole) {
  if (role === "admin") return "border-blue-700 bg-blue-700 text-white"
  if (role === "manager") return "border-orange-600 bg-orange-600 text-white"
  if (role === "account_manager") return "border-red-700 bg-red-700 text-white"
  if (role === "employee") return "border-green-700 bg-green-700 text-white"
  return "border-cyan-700 bg-cyan-700 text-white"
}

/** Displays role identifiers as readable labels without exposing underscores. */
function roleDisplayName(role: UserRole): string {
  if (role === "account_manager") return "Account manager"
  return role.charAt(0).toUpperCase() + role.slice(1)
}

/** Returns the administrator-facing label for a persisted account lifecycle status. */
function accessStatusLabel(status: AccessStatus): string {
  if (status === "denied") return "Not approved"
  if (status === "retired") return "Offboarded"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/** Explains the effective sign-in and workflow impact of each lifecycle state. */
function accessStatusDescription(status: AccessStatus): string {
  if (status === "active") return "For current employees, engaged contractors, and authorized company operators. Sign-in is enabled; assigned role and rights still limit actions."
  if (status === "suspended") return "Temporary hold for leave, contract verification, investigation, or access review. Sign-in and actions pause; existing records remain available to authorized reviewers."
  if (status === "retired") return "Offboarded because employment or engagement ended. Sign-in is disabled; retain timesheets, approvals, and audit history. An admin can reactivate if the person returns."
  if (status === "blocked") return "Security containment for suspected account compromise or serious policy risk. Access is stopped immediately; investigate before restoring access."
  return "Not approved for onboarding or app access. Sign-in is disabled; activate only after identity, company affiliation, and role are verified."
}

/**
 * Returns the white-admin-table badge style for an access status.
 *
 * @param status - Access status shown in the admin directory.
 * @returns Tailwind classes for the status badge.
 */
function accessStatusClass(status: AccessStatus | "observed") {
  if (status === "active") {
    return "border-green-200 bg-green-50 text-green-700"
  }
  if (status === "suspended") {
    return "border-orange-200 bg-orange-50 text-orange-800"
  }
  if (status === "retired") {
    return "border-slate-300 bg-slate-100 text-slate-700"
  }
  if (status === "denied") {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }
  if (status === "blocked") {
    return "border-red-200 bg-red-50 text-red-700"
  }
  return "border-slate-200 bg-slate-100 text-slate-600"
}

/** Hides generated temporary names behind an admin-friendly placeholder label. */
function displayOfficialName(name:string):string {
  return name.startsWith("Name Not Set ")?"Name not set":name||"Name not set"
}

/**
 * Formats an admin directory timestamp for compact table display.
 *
 * Invalid timestamps are returned unchanged so the admin can still see the raw
 * value instead of losing potentially useful diagnostic information.
 *
 * @param value - ISO timestamp returned by the user directory API.
 * @returns Localized date label or original value when parsing fails.
 */
function formatAdminDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/**
 * Formats an audit timestamp with date and time for investigation views.
 *
 * Invalid timestamps are returned unchanged so administrators can still inspect
 * raw values if an upstream data issue occurs.
 *
 * @param value - ISO timestamp returned by the audit API.
 * @returns Localized date-time label or original value when parsing fails.
 */
function formatAdminDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * Converts a machine audit action into a readable label.
 *
 * @param action - Machine-readable audit action.
 * @returns Human-readable audit action label.
 */
function formatAuditAction(action: string) {
  return action.replaceAll("_", " ")
}

/**
 * Applies an intuitive severity color to an audit action label.
 * @param action - Machine-readable audit action.
 * @returns Tailwind classes for the action badge.
 */
function auditActionTone(action:string) {
  if(/reject|delete|clear|block|revoke|deny|fail/i.test(action))return "border-red-200 bg-red-50 text-red-800"
  if(/approve|create|submit|grant|restore|deliver|authentication_succeeded/i.test(action))return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if(/permission|access|role|identity|user/i.test(action))return "border-violet-200 bg-violet-50 text-violet-800"
  if(/message|announcement/i.test(action))return "border-orange-200 bg-orange-50 text-orange-800"
  return "border-blue-200 bg-blue-50 text-blue-800"
}

/**
 * Applies a category color to an audit target type.
 * @param targetType - Entity type affected by an event.
 * @returns Tailwind classes for the target badge.
 */
function auditTargetTone(targetType:string) {
  if(/identity|user|access|permission|profile/i.test(targetType))return "border-violet-200 bg-violet-50 text-violet-800"
  if(/message|announcement/i.test(targetType))return "border-orange-200 bg-orange-50 text-orange-800"
  if(/entry|timesheet|approval/i.test(targetType))return "border-blue-200 bg-blue-50 text-blue-800"
  return "border-slate-200 bg-slate-100 text-slate-700"
}

/**
 * Shortens long target identifiers for compact table display.
 *
 * Email targets are already readable, while UUID-like ids are shortened so the
 * audit table stays scannable on smaller screens.
 *
 * @param id - Target id from an audit event.
 * @returns Compact target id label.
 */
function shortId(id: string) {
  if (id.includes("@")) return id
  return id.length > 8 ? id.slice(0, 8) : id
}

/**
 * Formats sanitized audit metadata for admin table display.
 *
 * The metadata intentionally describes changed fields and workflow status rather
 * than full sensitive values. This keeps the security log informative but narrow.
 *
 * @param event - Audit event whose metadata should be summarized.
 * @returns Compact metadata summary.
 */
function formatAuditMetadata(event: AdminAuditEvent) {
  const parts: string[] = []
  const fields = event.metadata.changedFields
  const fromStatus = event.metadata.fromStatus
  const toStatus = event.metadata.toStatus

  if (typeof fromStatus === "string" && typeof toStatus === "string") {
    parts.push(`${fromStatus} to ${toStatus}`)
  }

  if (Array.isArray(fields) && fields.length > 0) {
    parts.push(`fields: ${fields.join(", ")}`)
  }

  const summary = parts.join(" · ") || `${Object.keys(event.metadata).length} metadata fields`
  return summary.length > 100 ? `${summary.slice(0, 97)}...` : summary
}

/**
 * Formats full audit metadata as readable JSON for the selected entry detail.
 *
 * The audit API already sanitizes metadata, so this formatter focuses on making
 * nested context easy to inspect in a fixed-width block.
 *
 * @param event - Audit event whose metadata should be rendered.
 * @returns Pretty-printed audit metadata.
 */
function formatAuditMetadataBlock(event: AdminAuditEvent) {
  return JSON.stringify(event.metadata, null, 2)
}
