/**
 * Notifies open local workspaces when permissions are explicitly saved.
 * Broadcasts contain no identities or permission values; listeners refetch from
 * the server, which remains authoritative across tabs and account sessions.
 */
"use client"
/**
 * Triggers immediate same-tab and cross-tab authorization refreshes.
 * Other devices continue using the periodic server refresh.
 * @returns void after refresh notifications are dispatched.
 */
export function notifyPermissionsChanged():void {
  window.dispatchEvent(new Event("permissions-changed"))
  if(typeof BroadcastChannel !== "undefined") {
    const channel=new BroadcastChannel("permissions-changed")
    channel.postMessage("refresh")
    channel.close()
  }
}
