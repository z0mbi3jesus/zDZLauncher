# DZ Launchpad

A Windows-first DayZ desktop launcher and local Steam Workshop mod manager built with Electron, React, and TypeScript.

## Features

- Detects Steam libraries from common locations and the Windows Steam registry entry.
- Finds the DayZ executable and lets you choose a custom install path.
- Browses DayZ servers using the DZSA HTTPS directory, with Steam UDP discovery as a fallback and Source A2S queries for saved/manual servers, with progressive results, map/player/ping/security filters, and sort options. Manual add checks the entered port and then the common DayZ game-port-plus-one query port.
- Saves favorite and recently joined servers, supports adding a server by query address, and launches directly to a selected server with the active local mod profile.
- Scans locally downloaded DayZ Workshop items, reads mod names from `mod.cpp`, and opens mod folders or Workshop pages.
- Toggles mods, arranges load order, and saves separate profiles on this PC.
- Launches `DayZ_x64.exe` with the enabled profile passed as a `-mod=` load list.
- Keeps Steam sign-in and Workshop subscriptions in Steam. The app does not collect Steam credentials or download Workshop content directly.

## Development

Requires Node.js and npm on Windows.

```powershell
npm install
npm run dev
```

This starts Vite and the Electron desktop shell together. For a compile and package check:

```powershell
npm run build
```

Create a Windows installer with:

```powershell
npm run package
```

The unpacked build and installer are written to the stable project-root folder `launcher-build`.

## First use

1. Install DayZ and subscribe to mods in the DayZ Steam Workshop using Steam.
2. Let Steam finish downloading the Workshop items.
3. Open DZ Launchpad and check Settings if the DayZ install was not detected automatically.
4. Refresh the Mod library, enable the mods you want, and arrange their order within the active profile.
5. Open Server browser, choose Internet, Favorites, or Recent, select a server, then join. Password-protected servers prompt for their password at join time.

Profiles and their enabled mod order are stored locally by the app. The executable path is stored in Electron's application data directory.

Runtime diagnostics are written to Electron's application data directory under `logs/latest.log`. Settings includes an **Open log** action; one `previous.log` is retained when the active log reaches 2 MB. Startup, server discovery progress and errors, and DayZ launch attempts are recorded. Server passwords are not logged.

## Current scope and limitations

- Workshop search, subscription, and download are handed off to Steam; this app does not implement Steam authentication, SteamCMD, or direct downloads.
- The server browser queries Valve's Source master endpoint at `hl2master.steampowered.com:27011` (with direct IP fallbacks) over UDP, then queries each server's UDP A2S port. Network policies, firewalls, or server query settings may hide results; manual address entry is available as a fallback.
- Internet browsing first downloads the DZSA directory over HTTPS. Listings and player counts are provider snapshots, not locally verified live responses; ping is shown as unmeasured. A specific maximum-ping filter excludes unmeasured entries. This third-party directory is not guaranteed to include every official or community server. If it fails, the launcher falls back to Steam UDP discovery without a fixed server-count cap.
- Server browser results include the data exposed by the Steam A2S query protocol. DayZ server-required Workshop mods are not reliably exposed by that protocol, so the launcher joins with the selected profile and does not claim to validate or automatically download server mods.
- The first version is Windows-only and launches the standalone DayZ client. Presets import/export, mod update progress, and automatic dependency ordering are not implemented.
- A mod's Workshop folder name is used as a fallback when no display name is present in `mod.cpp`.
- Mods are passed in profile order. Confirm server-specific load order and dependencies before joining a modded server.
