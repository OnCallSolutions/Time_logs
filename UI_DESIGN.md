# DevOnCall Application Design

The parent organization's visual reference is [devoncall.net](https://www.devoncall.net/). Adapt its brand to a working application rather than reproducing its marketing landing page.

## Shared Identity

- Use `components/brand.tsx` for the DevOnCall wordmark and Timesheet descriptor.
- Use white surfaces, dark ink text, neutral separators, and orange accents.
- The brand accent is `#f97316`; action orange is the darker `#c2410c` for readable white labels. Main ink is `#050720`.
- Keep success, warning, error, and chart colors distinct from brand colors.
- Prefer shared CSS tokens and Button variants over hard-coded accent classes.
- White technology-management dialogs use `tech-surface` to stay readable in dark system themes. Authentication uses `auth-surface` for the same reason.
- The root document explicitly uses the light brand theme, regardless of operating-system preference. All pages share a subtle neutral grid and orange top rule; forms and popovers remain solid white.
- Admin overview, workflow counts, directory totals, recent audit activity, message composition, and read-only employee rights are expandable. Messages show compact previews; expanding reveals the full body. Editing rights still requires explicit Edit and Save.

## Working Layouts

Use compact headings, full-width bands, and unframed controls. Reserve framed panels for genuine tools, repeated records, and dialogs; avoid nested decorative cards. Radius should stay at 8px or less for new surfaces.

Keep employee logging immediately available. Manager/admin note extraction remains available in an expandable section so their review and administration controls appear sooner. Do not remove existing capabilities during appearance changes.

Navigation must wrap on narrow screens without losing labels. Table overflow should remain inside its scroll area, with sticky headers and visible actions. Dialogs need bounded heights, accessible focus, scrollable content, and persistent confirmation/close controls.

Application windows use `WindowSurface` and open full screen by default. Restore offers a smaller view. Each active window is portaled outside its parent; previous windows are hidden and inert, not destroyed. Back and Escape return to the immediate previous view with its draft and scroll state intact. Save-in-progress prevents dismissal. Security reports remain read-only and refresh stored assessments without initiating an AI run.

## Authentication

Microsoft Entra ID remains the only sign-in provider. Do not add password collection to the application. Keep existing provider identifiers, reauthentication parameters, cookie cleanup, and `/timelog` routes.

`AuthSubmitButton` reads the parent form's pending state, prevents repeat clicks, and announces progress. Sign-out keeps the same server action and fixed control dimensions. Help text must remain concise and relevant to account access.

The Microsoft symbol in `public/microsoft-symbol.png` is the official, unmodified asset from [Microsoft's sign-in branding guidance](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-branding-in-apps). `public/devoncall-favicon.ico` comes from the parent organization's published favicon. Both are self-hosted; no external asset requests are required during sign-in.

## Verification

Run TypeScript, component/API tests, and the production build. Check sign-in, access-denied, employee, manager, messages, reports, and admin dialogs at mobile and desktop sizes. Check actual overflow and asset loading, not just screenshots. Verify authentication parameters and server actions remain unchanged, and respect reduced-motion preferences.
