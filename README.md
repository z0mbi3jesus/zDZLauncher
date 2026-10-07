# DZ Launchpad

A Windows-first DayZ desktop launcher and local Steam Workshop mod manager built with Electron, React, and TypeScript.

## Features

- Detects Steam libraries from common locations and the Windows Steam registry entry.
- Finds the DayZ executable and lets you choose a custom install path.
- Browses DayZ servers directly through the running Steam client using Steamworks, with Source A2S queries for saved/manual servers, with progressive results, map/player/ping/security filters, and sort options. Manual add checks the entered port and then the common DayZ game-port-plus-one query port.
- Saves favorite and recently joined servers, supports adding a server by query address, and matches required server Workshop mods to installed items and launches with the server-advertised loadout.
- Scans locally downloaded DayZ Workshop items, reads mod names from `mod.cpp`, and opens mod folders or Workshop pages.
- Toggles mods, arranges load order, and saves separate profiles on this PC.
- Launches `DayZ_x64.exe` with the enabled profile passed as a `-mod=` load list.
- Keeps Steam sign-in and Workshop subscriptions in Steam. The app does not collect Steam credentials or download Workshop content directly.

## Development

Requires Node.js and npm on Windows. Server discovery requires Steam running and signed in to an account that owns DayZ, plus an installed DayZ client. The launcher loads steam_api64.dll from that installation; it does not collect Steam credentials.

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

Source lives in `src` (interface), `electron` (desktop integration and server discovery), and `tests`. `dist` and `dist-electron` are generated compilation inputs for packaging; `launcher-build` holds the current Windows build. These output folders and `node_modules` are ignored by Git. Typechecking does not create files in the project root.

Server lists are retained for the current session when navigating between pages and sources. Use Refresh to update a list; during a refresh that button becomes Stop and retains listings already found. Leaving the server browser or switching sources cancels its scan. The list renders a small window of rows as you scroll, while search and filters apply to all loaded servers.

The server browser has Official and Community tabs. Official shows only Bohemia-verified servers; Community holds all remaining listings, retaining Unverified labels where classification is uncertain. Internet, Favorites, and Recent sources work within either tab. Switching these type tabs filters the loaded list without starting another scan.

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
- Internet discovery uses Steamworks RequestInternetServerList for DayZ app 221100. Worldwide and complementary population/mod/perspective requests are merged and deduplicated. Steam result limits, offline servers, and a 90-second refresh deadline mean complete coverage is not guaranteed; available listings are retained and limits are recorded in the log.
- Official candidates are identified by reserved shard000-shard099 tags and verified against Bohemia's public RSA key at https://key-dayz.bistudio.com/public. DayZ rules signatures sign1/sign2 are checked with RSA/SHA-256 over the live server name plus game IP:port. Only passing servers appear in Official; community private-hive tags appear in Community. Unrecognized, failed, or timed-out candidates remain Unverified. Public keys and passing results are cached in memory for the current session; no competitor directory is used.
- Selecting a server queries its DayZ A2S_RULES mod list and displays installed/missing Workshop items. Get Mod opens the Workshop page; subscribe and let Steam download, then use Recheck Mods. Joining queries the list again and uses only those mods in advertised order, without changing saved profiles. Empty complete lists launch vanilla. Failed, unsupported, or truncated responses and unpublished mods block joining. Automatic subscriptions, downloads, mod version checks, and dependency resolution are not implemented.
- The first version is Windows-only and launches the standalone DayZ client. Presets import/export, mod update progress, and automatic dependency ordering are not implemented.
- A mod's Workshop folder name is used as a fallback when no display name is present in `mod.cpp`.
- Mods are passed in profile order. Confirm server-specific load order and dependencies before joining a modded server.
