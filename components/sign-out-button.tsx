"use client"

import { LogOut } from "lucide-react"
import { signOutAction } from "@/app/actions"
import { Button } from "@/components/ui/button"

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline" size="sm">
        <LogOut className="size-3.5" aria-hidden="true" />
        Sign out
      </Button>
    </form>
  )
}
