# DevOnCall Application Design

The parent organization's visual reference is [devoncall.net](https://www.devoncall.net/). Adapt its brand to a working application rather than reproducing its marketing landing page.

## Shared Identity

- Use `components/brand.tsx` for the DevOnCall wordmark and Tanovo Time product name on `Development`.
- Use white surfaces, dark ink text, neutral separators, and orange accents.
- The brand accent is `#f97316`; action orange is the darker `#c2410c` for readable white labels. Main ink is `#050720`.
- Keep success, warning, error, and chart colors distinct from brand colors.
- Prefer shared CSS tokens and Button variants over hard-coded accent classes.
- White technology-management dialogs use `tech-surface` to stay readable in dark system themes. Authentication uses `auth-surface` for the same reason.
- The root document explicitly uses the light brand theme, regardless of operating-system preference. All pages share a subtle neutral grid and orange top rule; forms and popovers remain solid white.
- Admin overview, workflow totals, directory, activity, message composition/details, notification preferences, encryption identities, and rights editors open isolated windows rather than expandable wedges. Landing controls form compact horizontal toolbars. Editing still requires explicit Edit and Save.

## Working Layouts

The landing page shows status counts/hours, project activity, and independent
review workload in full-width bands. Personal totals use authenticated ownership;
manager review totals exclude the manager's own submissions.

Related commands open under Timesheets, Review & accounts, Insights, and Access &
security. Availability follows live rights. Group windows show their hierarchy;
nested Back restores the previous group. Existing view tabs remain quick navigation.

Entry checkboxes select one or several owned draft/rejected rows. The header
checkbox affects matching eligible rows; Select all eligible includes the eligible
records loaded into that view, even if the internal search hides them. Preview
always lists the exact proposed records before manual or AI-assisted submission.

Use compact headings, full-width bands, and unframed controls. Reserve framed panels for genuine tools, repeated records, and dialogs; avoid nested decorative cards. Radius should stay at 8px or less for new surfaces.

Keep logging available through the Log time notes button. Its full-screen window preserves extraction; parsed entries return to the entry list for review. Do not remove existing capabilities during appearance changes.

Navigation must wrap on narrow screens without losing labels. Table overflow should remain inside its scroll area, with sticky headers and visible actions. Dialogs need bounded heights, accessible focus, scrollable content, and persistent confirmation/close controls.

Application windows use `WindowSurface` and open full screen by default. Restore offers a smaller view. Each active window is portaled outside its parent; previous windows are hidden and inert, not destroyed. Back and Escape return to the immediate previous view with its draft and scroll state intact. Save-in-progress prevents dismissal. Security reports remain read-only and refresh stored assessments without initiating an AI run.

Employee rights shows every actor. Managers can edit only active employee/contractor workflow rights; higher roles and inactive actors remain visible but read-only. Admins use the full directory editor. Wide admin editors arrange identity/role/access fields horizontally and control-right checkboxes in multiple columns. The last active admin cannot be demoted or blocked, and deployment recovery administrators remain protected.

## Authentication

Microsoft Entra ID remains the only sign-in provider. Do not add password collection to the application. Keep existing provider identifiers, reauthentication parameters, cookie cleanup, and `/tanovo-time` routes.

`AuthSubmitButton` reads the parent form's pending state, prevents repeat clicks, and announces progress. Sign-out keeps the same server action and fixed control dimensions. Help text must remain concise and relevant to account access.

The Microsoft symbol in `public/microsoft-symbol.png` is the official, unmodified asset from [Microsoft's sign-in branding guidance](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-branding-in-apps). `public/devoncall-favicon.ico` comes from the parent organization's published favicon. Both are self-hosted; no external asset requests are required during sign-in.

## Messaging and Control Help

Entry rows are read-only until their pencil is pressed. Save submits one complete
revision-bound draft; Cancel restores persisted values without a request. Failed
saves/review decisions retain input and show errors. Approval/rejection dialogs
stay open and block dismissal while persistence is pending. Cluster repeated
person/day/project labels, retaining independent task actions and statuses.

Messages opens from the top-right account header using a chat-bubble icon and
an unread count, including zero. Keep the white/orange light theme rather than
switching colors by operating system. Encryption connects automatically; do not
restore a normal password/recovery/unlock form. See [device behavior](MESSAGING_DEVICES.md).

Controls should expose concise, accessible hover/focus descriptions, with touch
access where needed. Keep tooltips out of the action path and do not let them
hide confirmation controls. Permission checks remain server-side.

## Verification

Run TypeScript, component/API tests, and the production build. Check sign-in, access-denied, employee, manager, messages, reports, and admin dialogs at mobile and desktop sizes. Check actual overflow and asset loading, not just screenshots. Verify authentication parameters and server actions remain unchanged, and respect reduced-motion preferences.
