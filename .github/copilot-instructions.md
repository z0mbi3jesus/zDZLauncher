# Project Guidance

- This is a Windows-first Electron desktop app for DayZ. Preserve the React, TypeScript, Vite, and Electron architecture.
- Keep `contextIsolation` enabled and `nodeIntegration` disabled. Renderer features that need filesystem or process access must go through a narrowly scoped API in `electron/preload.ts` and validated IPC handlers in `electron/main.ts`.
- Steam owns Workshop sign-in, subscriptions, and downloads. Do not collect Steam credentials or imply that local folder scanning downloads content.
- Mod profiles are local to this app. Keep load order deterministic and only launch DayZ with installed Workshop paths resolved in the main process.
- `npm run typecheck` checks TypeScript. `npm run build` typechecks, builds the renderer and Electron bundles, and creates an unpacked Windows build. `npm run dev` starts the Electron app with Vite.
- Keep README setup and feature limitations aligned with the current behavior.
