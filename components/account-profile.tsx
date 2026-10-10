"use client"

/**
 * Provides the signed-in account summary and editable profile popover.
 *
 * The component shows the authenticated email, display name, role label, and a
 * circular image placeholder. Profile changes are persisted through the profile
 * API so they survive page reloads and future sessions.
 */
import { useEffect, useRef, useState } from "react"
import { Camera, ImagePlus, Trash2, UserRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiPath } from "@/lib/paths"
import { readClientData,invalidateClientData } from "@/lib/client-data-cache"

type Profile = {
  displayName: string
  imageDataUrl: string | null
}

/**
 * Renders the profile avatar, account label, and edit menu.
 *
 * The parent passes authentication details while this component owns local draft
 * state for image and display-name edits. Saved values are written to the server
 * and then reflected immediately in the header.
 *
 * @param props - Profile header props.
 * @param props.email - Signed-in email address shown as the account identity.
 * @param props.fallbackName - Microsoft profile name used before a saved name exists.
 * @param props.role - Human-readable role label shown beneath the email.
 * @returns Account profile control with an editable popover.
 */
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
    if(!email)return
    let active = true

    /**
     * Loads the saved profile for the current signed-in user.
     *
     * The active flag prevents state updates after unmounting while the fetch is
     * still pending. Load failures are shown inside the profile popover area.
     *
     * @returns A promise that resolves after profile state is loaded or an error is stored.
     */
    async function loadProfile() {
      try {
        const data = await readClientData<{profile:Profile}>(apiPath("/api/profile"),email!,15000)

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
  }, [fallbackName,email])

  /**
   * Opens the edit popover with draft fields reset to the current profile.
   *
   * @returns Nothing; menu and draft state are updated as side effects.
   */
  function openMenu() {
    setDraftName(profile.displayName || fallbackName || "")
    setDraftImage(profile.imageDataUrl)
    setMessage(null)
    setMenuOpen(true)
  }

  /**
   * Reads and validates an image file selected by the user.
   *
   * Only small browser-displayable image files are accepted. The image is stored
   * as a data URL so the profile API can persist it without separate file storage.
   *
   * @param file - Optional file chosen from the hidden file input.
   * @returns Nothing; draft image or validation message is updated as a side effect.
   */
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

  /**
   * Saves the current profile draft through the profile API.
   *
   * A successful save updates the displayed profile immediately and closes the
   * popover. Failures leave the draft open so the user can adjust and retry.
   *
   * @returns A promise that resolves after the profile save succeeds or fails.
   */
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
      invalidateClientData(email??undefined,apiPath("/api/profile"))
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
    <div className="relative flex min-w-0 items-center justify-end gap-3">
      <div className="min-w-0 text-right">
        <p title={email ?? undefined} className="truncate text-sm font-medium text-foreground">
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
        <div className="fixed inset-x-3 top-20 z-30 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-3 text-left shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-72" onKeyDown={event => { if (event.key === "Escape") setMenuOpen(false) }}>
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
