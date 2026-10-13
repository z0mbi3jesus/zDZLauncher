# z0mbi3's DayZ Launcher Privacy Policy

Version 1.0 · Effective October 13, 2026

Publisher and maintainer: **z0mbi3jesus**  
Privacy contact: hutton@6thlevel.net or z0mbi3.g.sus@gmail.com

## No developer telemetry or data collection service

z0mbi3's DayZ Launcher does not automatically send your identity, files, settings, history,
or diagnostic logs to the Author. There are no launcher accounts, developer-
operated data aggregation servers, analytics, advertising trackers, payment
processors, or automatic crash-report uploads in the current application.
The Author does not receive or sell your information through normal application
operation. The application still processes information on your computer and
contacts third-party services needed for its features, as explained below.
This policy covers the desktop application, not the independent policies of
Steam, Bohemia Interactive, BattlEye, game servers, or websites you visit.

## Information processed locally

- **Steam identity:** Steam ID, display name, avatar image, sign-in state, and
  DayZ access are obtained from the running Steam client. Display information
  is held in application memory; your Steam ID is also used as a key for a
  locally saved DayZ profile selection. The launcher does not ask for or store
  your Steam password, Steam Web API key, or website authentication token.
- **Installation and mods:** Steam registry/library information, game and
  Workshop paths, item IDs, mod metadata, installation state, and download
  readiness are read to locate and prepare the game.
- **Settings and history:** Game path, favorites, recent server addresses,
  per-account player-profile selections, and user-supplied Workshop mappings
  are saved in the application's local settings file. Mod profile names,
  selections, and order are stored in the renderer's local storage.
- **Server responses:** Addresses, names, population, tags, mod requirements,
  and verification results are processed to display and join servers. Browse
  results and verification caches are held for the application session.
- **Diagnostics:** Local logs record startup, scan/download/launch events,
  server addresses, item IDs, errors, and potentially identifying local paths.
  The launcher does not log or persist server passwords. A password entered
  for joining is passed to the local game launch and may be visible to software
  able to inspect your computer's process arguments or to the destination game
  server; do not reuse a sensitive account password as a server password.

## Local storage and retention

On Windows, application settings, renderer storage, and logs are normally under
`%APPDATA%/dz-launchpad`. Locations can vary with Electron configuration or
Windows folder redirection. DayZ's existing player settings are read from the
Windows Documents DayZ folder; Workshop content remains in Steam's libraries.

Settings and mod profiles remain until changed or deleted. The active log is
rotated when it would exceed 2 MB; one previous log is retained. Memory-only
browse/verification data is discarded when the application exits. Local storage
is not encrypted by the launcher; it relies on your computer's access controls.
HTTPS/TLS is network protection, not encryption of these local files.

To remove launcher data, close z0mbi3's DayZ Launcher and delete its application-data
folder. Uninstalling the application alone may leave that folder behind. This
does not remove DayZ profiles, unsubscribe Workshop items, or erase server-held
characters; manage those with their relevant providers. To find the actual local
location, use **Settings → Open log** and inspect its containing directory.

## Network connections and third parties

- **Steam/Valve:** Native Steamworks requests handle identity, server discovery,
  subscriptions, and Workshop downloads through the running Steam client.
  Valve processes those requests under its own policies. The launcher does not
  implement its own Steam login or download mirror.
- **Bohemia Interactive:** An HTTPS request to
  `https://key-dayz.bistudio.com/public` obtains the official-server verification
  key. The request does not attach your Steam identity or local settings. The
  destination can receive normal connection information, including your public
  IP address.
- **Game servers and DNS:** UDP A2S queries request server details/rules; joining
  connects the game to the selected server. Servers receive network addresses
  and query/game traffic. A2S traffic is not HTTPS-encrypted. Hostname lookup
  uses your system's configured DNS service.
- **DZSA mod metadata:** If direct and native Steam mod queries both fail, an
  HTTPS request to `dayzsalauncher.com/api/v1/query/` requests the selected
  server's mod list. The request contains the server's IP address and query port.
  DZSA receives normal connection information, including your public IP address.
  No Steam identity, local files, settings, or logs are attached. DZSA operates
  this service independently; its metadata may be cached.
- **External links:** Opening a Workshop page launches the system's normal link
  handler. That provider/browser may use its own cookies, account session, and
  logging. The launcher does not send its local settings or logs with the link.

Third parties may independently retain connection/account information or transfer
it internationally. The Author does not operate these services or promise their
retention practices. Consult their current policies:
[Valve](https://store.steampowered.com/privacy_agreement/),
[Bohemia Interactive](https://www.bohemia.net/privacy-policy),
and [BattlEye](https://www.battleye.com/privacy-policy/).

## Voluntary support contact

If you choose to email the Author or send a support report, the Author receives
what you deliberately send, such as your email address, message, or attached log.
Review and redact logs before sharing them. Such information is used to answer
or investigate your request, not for marketing or sale. Keep reports to the
minimum needed; contact the privacy addresses to request deletion of information
you voluntarily supplied. Retain it only as needed for the request or applicable
legal obligations. Your email provider and the recipient's email provider handle
message delivery under their own policies; support contact is not automatic
application telemetry. No promise is made that the Author can delete information
held independently by Steam, servers, or other providers.

## Rights, changes, and contact

Applicable privacy rights depend on the processing and your jurisdiction. Nothing
in this policy waives those rights. You can inspect or delete launcher-local data
on your own computer; contact the Author about information voluntarily submitted
to the Author. This policy does not claim GDPR certification or blanket compliance
with every jurisdiction. Future changes, particularly developer-side uploads or
tracking, must be accurately disclosed in a revised policy with an updated date.
