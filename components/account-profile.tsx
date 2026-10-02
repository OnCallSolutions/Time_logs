"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, ImagePlus, Trash2, UserRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"

type Profile = {
  displayName: string
  imageDataUrl: string | null
}

export function AccountProfile({
  email,
  fallbackName,
  role,
}: {
  email?: string | null
  fallbackName?: string | null
  role: string
}) {
  const [profile, setProfile] = useState<Profile>({
    displayName: fallbackName ?? "",
    imageDataUrl: null,
  })
  const [draftName, setDraftName] = useState(fallbackName ?? "")
  const [draftImage, setDraftImage] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true

    async function loadProfile() {
      try {
        const res = await fetch(apiPath("/api/profile"), { cache: "no-store" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to load profile.")

        if (active) {
          const loadedProfile = data.profile as Profile
          setProfile(loadedProfile)
          setDraftName(loadedProfile.displayName || fallbackName || "")
          setDraftImage(loadedProfile.imageDataUrl)
        }
      } catch (err) {
        if (active) {
          setMessage(
            err instanceof Error ? err.message : "Failed to load profile.",
          )
        }
      }
    }

    loadProfile()

    return () => {
      active = false
    }
  }, [fallbackName])

  function openMenu() {
    setDraftName(profile.displayName || fallbackName || "")
    setDraftImage(profile.imageDataUrl)
    setMessage(null)
    setMenuOpen(true)
  }

  function readImage(file?: File) {
    if (!file) return

    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file.")
      return
    }

    if (file.size > 550_000) {
      setMessage("Choose an image smaller than 550 KB.")
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setDraftImage(typeof reader.result === "string" ? reader.result : null)
      setMessage(null)
    }
    reader.onerror = () => setMessage("Failed to read that image.")
    reader.readAsDataURL(file)
  }

  async function saveProfile() {
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch(apiPath("/api/profile"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: draftName,
          imageDataUrl: draftImage,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to save profile.")

      setProfile(data.profile)
      setMenuOpen(false)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save profile.")
    } finally {
      setSaving(false)
    }
  }

  const displayName = profile.displayName || fallbackName
  const currentImage = profile.imageDataUrl

  return (
    <div className="relative flex items-center justify-end gap-3">
      <div className="min-w-0 text-right">
        <p className="truncate text-sm font-medium text-foreground">
          {email ?? "Signed in"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {displayName ? `${displayName} · ${role}` : role}
        </p>
      </div>
      <button
        type="button"
        onClick={openMenu}
        className="group relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        title="Edit profile"
      >
        {currentImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentImage} alt="" className="size-full object-cover" />
        ) : (
          <UserRound className="size-5" aria-hidden="true" />
        )}
        <span className="absolute inset-x-0 bottom-0 grid h-4 place-items-center bg-background/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
          <Camera className="size-3" aria-hidden="true" />
        </span>
        <span className="sr-only">Edit profile</span>
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-12 z-20 w-72 rounded-lg border border-border bg-popover p-3 text-left shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Profile</p>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Close"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground">
              {draftImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draftImage} alt="" className="size-full object-cover" />
              ) : (
                <UserRound className="size-6" aria-hidden="true" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => fileInputRef.current?.click()}
                title="Choose picture"
              >
                <ImagePlus className="size-4" aria-hidden="true" />
                <span className="sr-only">Choose picture</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => setDraftImage(null)}
                title="Remove picture"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                <span className="sr-only">Remove picture</span>
              </Button>
            </div>
          </div>

          <label className="mt-3 block text-xs font-medium text-muted-foreground">
            Display name
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              maxLength={80}
            />
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => readImage(event.target.files?.[0])}
          />

          {message && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {message}
            </p>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMenuOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={saveProfile} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
