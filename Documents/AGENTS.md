# Repository Context

This guide lives in `Documents/`; run package commands from its parent repository
root. Resolve installed Next.js documentation from the root `node_modules/next/`,
not `Documents/node_modules/`. Only `Development` and `main` are retained; release
PRs target main from Development. Preserve multiline Doxygen-style file/function
comments with parameters and return types when changing code.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
