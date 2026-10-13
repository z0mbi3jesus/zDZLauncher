# z0mbi3's DayZ Launcher

**BETA · 0.1.0-beta.1** — testing release; server admission and survivor restoration still require end-to-end verification.

Created and maintained by z0mbi3jesus
Contact Info: hutton@6thlevel.net | z0mbi3.g.sus@gmail.com
Website: https://6thlevel.net

A Windows-first DayZ desktop launcher and local Steam Workshop mod manager built with Electron, React, and TypeScript.

## Features

- Detects Steam libraries from common locations and the Windows Steam registry entry.
- Finds the DayZ executable and lets you choose a custom install path.
- Browses DayZ servers directly through the running Steam client using Steamworks, with Source A2S queries for saved/manual servers, with progressive results, map/player/ping/security filters, and sort options. Manual add checks the entered port and then the common DayZ game-port-plus-one query port.
- Saves favorite and recently joined servers, supports adding a server by query address, and matches required server Workshop mods to installed items and launches with the server-advertised loadout.
- Scans locally downloaded DayZ Workshop items, reads mod names from `mod.cpp`, and opens mod folders or Workshop pages.
- Toggles mods, arranges load order, and saves separate profiles on this PC.
- Displays the signed-in Steam name/avatar and detects existing DayZ player settings profiles. Launches through `DayZ_BE.exe -exe DayZ_x64.exe` with the selected player name and the appropriate mod loadout.
- Uses the running Steam client for sign-in, Workshop subscriptions, and downloads requested by Get All Mods or Join. No Steam credentials, developer telemetry, or automatic uploads are collected by the Author.

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

1. Install DayZ and keep Steam running and signed in to an account with DayZ access.
2. In Settings, check your detected Steam identity and existing DayZ player profile.
3. Open z0mbi3's DayZ Launcher and check Settings if the DayZ install was not detected automatically.
4. Refresh the Mod library, enable the mods you want, and arrange their order within the active profile.
5. Open Server browser, select a server, and use Get All Mods to prepare without launching or Join Server to download required mods and then connect automatically. Missing Workshop IDs must be assigned first. Cancel prevents automatic launch while Steam may continue queued downloads. Password-protected servers prompt for their password.

Profiles and their enabled mod order are stored locally by the app. The executable path is stored in Electron's application data directory.

Runtime diagnostics are written to Electron's application data directory under `logs/latest.log`. Settings includes an **Open log** action; one `previous.log` is retained when the active log reaches 2 MB. Startup, server discovery progress and errors, and DayZ launch attempts are recorded. Server passwords are not logged.

## Current scope and limitations

- Workshop search, subscription, and download are handed off to Steam; this app does not implement Steam authentication, SteamCMD, or direct downloads.
- Internet discovery uses Steamworks RequestInternetServerList for DayZ app 221100. Dedicated official-shard queries and complementary worldwide population/mod/perspective requests are merged and deduplicated. Steam result limits, offline servers, and a 90-second refresh deadline mean complete coverage is not guaranteed; available listings are retained and limits are recorded in the log.
- Official candidates are identified by reserved shard000-shard099 tags and verified against Bohemia's public RSA key at https://key-dayz.bistudio.com/public. DayZ rules signatures sign1/sign2 are checked with RSA/SHA-256 over the live server name plus game IP:port. Only passing servers appear in Official; community private-hive tags appear in Community. Unrecognized, failed, or timed-out candidates remain Unverified. Public keys and passing results are cached in memory for the current session; no competitor directory is used.
- Selecting a server queries its DayZ A2S_RULES mod list and displays installed/missing Workshop items. Get All Mods subscribes and downloads through Steam without launching. Join performs the same preparation, waits for completion, rechecks the server, and launches through BattlEye. Individual Get Mod links open the Workshop page. Joining queries the list again and uses only those mods in advertised order, without changing saved profiles. Empty complete lists launch vanilla. Failed, unsupported, or truncated responses block joining. For mods that advertise Workshop ID zero, Set ID accepts a confirmed Workshop item ID or link and saves it per server/mod name; it is used during matching and joining. Unresolved mods block joining. Readiness uses Steam installation/update state and download completion callbacks. Exact server/client mod version comparison and dependency resolution beyond the advertised list are not implemented.
- The first version is Windows-only and launches the standalone DayZ client. Presets import/export, byte-level mod download progress, and automatic dependency ordering are not implemented.
- A mod's Workshop folder name is used as a fallback when no display name is present in `mod.cpp`.
- Standalone launch uses the enabled mod profile order. Joining uses the server-advertised loadout without changing saved mod profiles. Survivor gear/progress is loaded by DayZ and the server; successful process startup does not confirm server admission or survivor restoration. Custom DayZ profile directories are not automatically detected.

## License, terms, and privacy

Copyright (c) 2026 z0mbi3jesus. z0mbi3's DayZ Launcher uses the custom
[z0mbi3's DayZ Launcher Community License](LICENSE), a proprietary free-to-use license,
not an open-source license. Anyone may use it and freely share unmodified
standalone copies with the original attribution and notices. Commercial
redistribution, rebranding as someone else's work, redistribution of modified
versions, and bundling with another product require written permission, subject
to the express exception for Bohemia Interactive a.s. and Valve Corporation.
Third-party dependencies retain their own licenses.

Read the [Terms of Use](TERMS.md), [Privacy Policy](PRIVACY.md), and
[Third-Party Notices](THIRD_PARTY_NOTICES.md). Release packages include readable
copies in the `legal` folder. z0mbi3's DayZ Launcher has no developer-operated accounts,
analytics, tracking, or automatic data uploads. Identity, settings, history, and
logs are processed locally; Steam, BI, and game servers receive the network
connections needed for their features. Voluntary support emails are separate.

z0mbi3's DayZ Launcher is an independent community utility, not affiliated with, endorsed
by, sponsored by, or an official product of Bohemia Interactive, Valve, or
BattlEye. DayZ, Steam, Steam Workshop, BattlEye, and other names/content belong
to their respective owners. These documents license the Author's work only;
they do not claim third-party approval or grant rights to third-party APIs,
games, trademarks, or mods.

The internal package ID and Windows application-data folder retain the historical `dz-launchpad` name so existing settings, profiles, and history remain available after the branding update.

## Version and build tracking

`package.json` is the source of the release version, currently `0.1.0-beta.1`.
Increase the beta suffix for the next published beta (`0.1.0-beta.2`, etc.).
Every `build:electron` run, including development starts, records a new build
number in `BUILD_HISTORY.json` and embeds `dist-electron/build-info.json`.
The app displays the actual channel, version, and build number; Settings and
startup logs also show UTC build time, source commit, and whether the source
was modified. Release folders include a readable `build-info.json`; installer
filenames include the release version and architecture.

Build history records generated build attempts, not a guarantee that packaging
succeeded. Keep it with the project to preserve the local numbering sequence;
separate checkouts/CI must coordinate numbering before sharing a release.
Use the complete version and build number in bug reports. Earlier development
builds are not retroactively assigned numbers. Removing the beta suffix marks
a stable release only when it is intentionally ready to publish.

Mod queries retry dropped UDP requests and fall back to native Steam ServerRules when direct retrieval fails. If both fail, an HTTPS DZSA metadata lookup can supply the selected server's required Workshop IDs. The endpoint must match and every ID must be valid; empty fallback lists are rejected. The UI labels DZSA lists because third-party metadata may be cached. No Steam identity or local files are attached to that request. If every lookup fails, the launcher blocks automatic joining; a timeout is never treated as a vanilla server.

During Get All Mods or Join, each required mod shows its Steam queue/download/install status and a progress bar updated every half second. Percentages and transferred bytes come from Steam GetItemDownloadInfo; unknown sizes stay indeterminate. Downloading 100% does not mark a mod ready until Steam's completion callback and installed folder are verified. Active items show elapsed time without reported progress after 30 seconds. Failure and cancellation details remain visible after preparation stops; cancellation stops waiting and automatic launch, while Steam may continue its queued downloads.
