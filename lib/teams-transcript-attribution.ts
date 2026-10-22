export type TeamsAttendanceRecord = {
  emailAddress?: string | null
  identity?: { displayName?: string | null } | null
}

export type TeamsPatronIdentity = { email: string; officialName: string }

export type TeamsSpeakerAttribution = {
  speakerName: string
  patronEmail: string | null
  attribution: "resolved" | "unmatched" | "ambiguous" | "unattributed"
}

export function extractTeamsVttSpeakerLabels(vtt: string) {
  const labels = new Set<string>()
  const expression = /<v(?:\.[^ >]+)?\s+([^>]+)>/gi
  for (const match of vtt.matchAll(expression)) {
    const label = match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim()
    if (label) labels.add(label)
  }
  return [...labels]
}

function normalizedName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
}

function normalizedEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US")
}

/** Resolves a speaker only through a unique Graph attendance identity and a known patron email. */
export function resolveTeamsSpeakerAttributions(
  speakerNames: Array<string | null>,
  attendance: TeamsAttendanceRecord[],
  patrons: TeamsPatronIdentity[],
): TeamsSpeakerAttribution[] {
  const patronEmails = new Set(patrons.map(patron => normalizedEmail(patron.email)))
  const labels = new Map<string, Set<string>>()

  for (const record of attendance) {
    const displayName = record.identity?.displayName?.trim()
    const email = record.emailAddress?.trim()
    if (!displayName || !email || !email.includes("@")) continue
    const key = normalizedName(displayName)
    const emails = labels.get(key) ?? new Set<string>()
    emails.add(normalizedEmail(email))
    labels.set(key, emails)
  }

  const uniqueNames = [...new Set(speakerNames.filter((name): name is string => Boolean(name?.trim()))) ]
  const result: TeamsSpeakerAttribution[] = uniqueNames.map(speakerName => {
    const emails = labels.get(normalizedName(speakerName))
    if (!emails?.size) return { speakerName, patronEmail: null, attribution: "unmatched" }
    if (emails.size !== 1) return { speakerName, patronEmail: null, attribution: "ambiguous" }
    const [email] = emails
    if (!patronEmails.has(email)) return { speakerName, patronEmail: null, attribution: "unmatched" }
    return { speakerName, patronEmail: email, attribution: "resolved" }
  })
  if (speakerNames.some(name => !name?.trim())) result.push({ speakerName: "", patronEmail: null, attribution: "unattributed" })
  return result
}
