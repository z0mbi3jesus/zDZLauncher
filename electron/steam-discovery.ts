import { deflateSync } from 'node:zlib';
import koffi from 'koffi';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DayZServer, ServerLog, ServerScanProgress } from './server-browser.js';

const DAYZ_APP_ID = 221100;
const REFRESH_TIMEOUT_MS = 90_000;
const STEAM_RESULT_LIMIT = 10_000;

export function isOfficialCandidate(tags: string[]): boolean {
  return tags.some((tag) => /^shard0\d{2}$/i.test(tag));
}

export function serverCategory(tags: string[]): DayZServer['category'] {
  if (isOfficialCandidate(tags)) return 'unverified';
  return tags.some((tag) => /^privhive$/i.test(tag)) ? 'community' : 'unverified';
}

// Steam's gameserveritem_t: fixed fields up to m_szGameTags. The SteamID tail
// is deliberately not decoded, avoiding its platform-specific alignment.
export function parseSteamServer(record: Buffer): DayZServer {
  if (record.length < 364) throw new Error('Incomplete Steam server record.');
  const text = (offset: number, length: number) => record.subarray(offset, offset + length).toString('utf8').split('\0')[0];
  const ip = record.readUInt32LE(4);
  const host = `${ip >>> 24}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`;
  const queryPort = record.readUInt16LE(2);
  const tags = text(236, 128).split(',').filter(Boolean);
  return {
    address: `${host}:${queryPort}`, host, queryPort, gamePort: record.readUInt16LE(0),
    name: text(172, 64), map: text(46, 32), game: text(78, 64),
    players: record.readInt32LE(148), maxPlayers: record.readInt32LE(152), bots: record.readInt32LE(156),
    password: record[160] !== 0, vac: record[161] !== 0,
    version: String(record.readInt32LE(168)), tags,
    ping: record[12] && record.readInt32LE(8) >= 0 ? record.readInt32LE(8) : null,
    lastSeen: record[12] ? Date.now() : 0, category: serverCategory(tags),
  };
}

let steam: ReturnType<typeof createSteam> | undefined;
let scanQueue: Promise<unknown> = Promise.resolve();
const workshopCleanups = new Set<() => void>();
const workshopRun = koffi.proto('void WorkshopRun(void *, void *)');
const workshopRunResult = koffi.proto('void WorkshopRunResult(void *, void *, bool, uint64_t)');
const workshopSize = koffi.proto('int WorkshopSize(void *)');
const rulesReceived = koffi.proto('void RulesReceived(void *, void *, void *)');
const rulesFinished = koffi.proto('void RulesFinished(void *)');

function createSteam(gameExecutable: string) {
  const dllPath = path.join(path.dirname(gameExecutable), 'steam_api64.dll');
  if (!gameExecutable || !existsSync(dllPath)) throw new Error('Set the DayZ installation path in Settings to enable Steam server discovery.');
  process.env.SteamAppId = String(DAYZ_APP_ID);
  process.env.SteamGameId = String(DAYZ_APP_ID);
  const library = koffi.load(dllPath);
  const init = library.func('bool SteamAPI_Init()');
  if (!init()) throw new Error('Steam could not initialize. Open Steam, sign in to the account that owns DayZ, then retry.');
  const api = library.func('void *SteamAPI_SteamMatchmakingServers_v002()')();
  if (!api) throw new Error('The installed Steam API does not expose server discovery. Verify the DayZ installation in Steam.');
  return {
    api,
    library,
    request: library.func('void *SteamAPI_ISteamMatchmakingServers_RequestInternetServerList(void *, uint32_t, void **, uint32_t, void *)'),
    count: library.func('int SteamAPI_ISteamMatchmakingServers_GetServerCount(void *, void *)'),
    details: library.func('void *SteamAPI_ISteamMatchmakingServers_GetServerDetails(void *, void *, int)'),
    refreshing: library.func('bool SteamAPI_ISteamMatchmakingServers_IsRefreshing(void *, void *)'),
    cancel: library.func('void SteamAPI_ISteamMatchmakingServers_CancelQuery(void *, void *)'),
    release: library.func('void SteamAPI_ISteamMatchmakingServers_ReleaseRequest(void *, void *)'),
    callbacks: library.func('void SteamAPI_RunCallbacks()'),
    shutdown: library.func('void SteamAPI_Shutdown()'),
  };
}

export interface SteamPlayer { id: string; name: string; avatar: string; ownsDayZ: boolean; }

function pngImage(width: number, height: number, rgba: Buffer): string {
  const crc = (buffer: Buffer) => {
    let value = 0xffffffff;
    for (const byte of buffer) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, bytes: Buffer) => {
    const data = Buffer.concat([Buffer.from(type), bytes]);
    const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(data));
    return Buffer.concat([length, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.concat(Array.from({ length: height }, (_, row) => Buffer.concat([Buffer.from([0]), rgba.subarray(row * width * 4, (row + 1) * width * 4)])));
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

export function steamPlayer(gameExecutable: string): SteamPlayer {
  steam ??= createSteam(gameExecutable);
  const { library } = steam;
  const handle = library.func('int SteamAPI_GetHSteamUser()')();
  const find = library.func('void *SteamInternal_FindOrCreateUserInterface(int, const char *)');
  const user = find(handle, 'SteamUser023');
  const friends = find(handle, 'SteamFriends017');
  const apps = find(handle, 'STEAMAPPS_INTERFACE_VERSION008');
  const utils = library.func('void *SteamAPI_SteamUtils_v010()')();
  if (!user || !friends || !apps || !utils) throw new Error('Steam player information is unavailable. Verify the DayZ installation.');
  if (!library.func('bool SteamAPI_ISteamUser_BLoggedOn(void *)')(user)) throw new Error('Sign in to Steam before launching DayZ.');
  steam.callbacks();
  const id = BigInt(library.func('uint64_t SteamAPI_ISteamUser_GetSteamID(void *)')(user)).toString();
  const name = library.func('const char *SteamAPI_ISteamFriends_GetPersonaName(void *)')(friends) as string;
  const ownsDayZ = Boolean(library.func('bool SteamAPI_ISteamApps_BIsSubscribedApp(void *, uint32_t)')(apps, DAYZ_APP_ID));
  let avatar = '';
  try {
    const image = library.func('int SteamAPI_ISteamFriends_GetSmallFriendAvatar(void *, uint64_t)')(friends, BigInt(id));
    const width = Buffer.alloc(4), height = Buffer.alloc(4);
    if (image > 0 && library.func('bool SteamAPI_ISteamUtils_GetImageSize(void *, int, void *, void *)')(utils, image, width, height)) {
      const w = width.readUInt32LE(), h = height.readUInt32LE();
      if (w && h && w <= 256 && h <= 256) {
        const rgba = Buffer.alloc(w * h * 4);
        if (library.func('bool SteamAPI_ISteamUtils_GetImageRGBA(void *, int, void *, int)')(utils, image, rgba, rgba.length)) avatar = pngImage(w, h, rgba);
      }
    }
  } catch { /* A missing or not-yet-loaded avatar must not block the player identity. */ }
  return { id, name, avatar, ownsDayZ };
}

export async function querySteamRules(gameExecutable: string, host: string, port: number): Promise<Buffer> {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) throw new Error('Steam rules fallback supports IPv4 servers only.');
  steam ??= createSteam(gameExecutable);
  const client = steam;
  const request = client.library.func('int SteamAPI_ISteamMatchmakingServers_ServerRules(void *, uint32_t, uint16_t, void *)');
  const cancel = client.library.func('void SteamAPI_ISteamMatchmakingServers_CancelServerQuery(void *, int)');
  const pairs: Buffer[] = [];
  let done = false, failure: Error | undefined;
  const bytes = (pointer: unknown) => {
    const value: number[] = [];
    for (let index = 0; index < 65536; index++) {
      const byte = koffi.decode(pointer, index, 'uint8_t') as number;
      if (!byte) return Buffer.from(value);
      value.push(byte);
    }
    throw new Error('Steam returned an oversized rules value.');
  };
  const callbacks = [
    koffi.register((_self: unknown, key: unknown, value: unknown) => {
      try {
        if (pairs.length >= 4096) throw new Error('Steam returned too many server rules.');
        pairs.push(Buffer.concat([bytes(key), Buffer.from([0]), bytes(value), Buffer.from([0])]));
      } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); done = true; }
    }, koffi.pointer(rulesReceived)),
    koffi.register(() => { failure = new Error('Steam could not retrieve server rules.'); done = true; }, koffi.pointer(rulesFinished)),
    koffi.register(() => { done = true; }, koffi.pointer(rulesFinished)),
  ];
  const vtable = koffi.alloc('void *', 3);
  koffi.encode(vtable, 'void *', callbacks, 3);
  const response = koffi.alloc('void *', 1);
  koffi.encode(response, 'void *', vtable);
  let handle = -1;
  try {
    const ip = host.split('.').reduce((value, octet) => (value * 256 + Number(octet)) >>> 0, 0);
    handle = request(client.api, ip, port, response);
    if (handle === -1) throw new Error('Steam did not start the server rules request.');
    const deadline = Date.now() + 6000;
    while (!done && Date.now() < deadline) {
      client.callbacks();
      if (!done) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (failure) throw failure;
    if (!done) throw new Error('Steam server rules query timed out.');
    const header = Buffer.from([255,255,255,255,69,0,0]);
    header.writeUInt16LE(pairs.length, 5);
    return Buffer.concat([header, ...pairs]);
  } finally {
    if (handle !== -1) cancel(client.api, handle);
    callbacks.forEach((callback) => koffi.unregister(callback));
    koffi.free(response); koffi.free(vtable);
  }
}

export function workshopClient(gameExecutable: string) {
  steam ??= createSteam(gameExecutable);
  const client = steam;
  const library = client.library;
  let ugc: unknown;
  for (const version of ['021', '020', '019', '018', '017', '016', '015']) {
    try { ugc = library.func(`void *SteamAPI_SteamUGC_v${version}()`)(); if (ugc) break; } catch { /* Try the installed SDK's interface version. */ }
  }
  if (!ugc) throw new Error('The installed DayZ Steam API does not support Workshop downloads. Verify DayZ in Steam.');
  const utils = library.func('void *SteamAPI_SteamUtils_v010()')();
  const subscribe = library.func('uint64_t SteamAPI_ISteamUGC_SubscribeItem(void *, uint64_t)');
  const download = library.func('bool SteamAPI_ISteamUGC_DownloadItem(void *, uint64_t, bool)');
  const register = library.func('void SteamAPI_RegisterCallback(void *, int)');
  const unregister = library.func('void SteamAPI_UnregisterCallback(void *)');
  const downloads = new Map<string, number>();
  const onDownload = (payload: unknown) => {
    const data = Buffer.from(koffi.decode(payload, 'uint8_t', 24));
    if (data.readUInt32LE(0) === DAYZ_APP_ID) downloads.set(data.readBigUInt64LE(8).toString(), data.readInt32LE(16));
  };
  // Windows x64 CCallbackBase: vtable pointer, flags byte, padding, callback ID.
  const functions = [
    koffi.register((_self: unknown, payload: unknown) => onDownload(payload), koffi.pointer(workshopRun)),
    koffi.register((_self: unknown, payload: unknown, failed: boolean) => { if (!failed) onDownload(payload); }, koffi.pointer(workshopRunResult)),
    koffi.register(() => 24, koffi.pointer(workshopSize)),
  ];
  const vtable = koffi.alloc('void *', 3);
  // MSVC reverses the two overloaded Run slots in this exported Windows ABI.
  koffi.encode(vtable, 'void *', [functions[1], functions[0], functions[2]], 3);
  const callback = koffi.alloc('uint8_t', 16);
  const callbackData = Buffer.alloc(16);
  callbackData.writeInt32LE(3406, 12);
  koffi.encode(callback, 'uint8_t', [...callbackData], 16);
  koffi.encode(callback, 'void *', vtable);
  register(callback, 3406); // DownloadItemResult_t.
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unregister(callback);
    functions.forEach((fn) => koffi.unregister(fn));
    koffi.free(callback);
    koffi.free(vtable);
    workshopCleanups.delete(dispose);
  };
  workshopCleanups.add(dispose);
  const state = library.func('uint32_t SteamAPI_ISteamUGC_GetItemState(void *, uint64_t)');
  const downloadInfo = library.func('bool SteamAPI_ISteamUGC_GetItemDownloadInfo(void *, uint64_t, void *, void *)');
  const install = library.func('bool SteamAPI_ISteamUGC_GetItemInstallInfo(void *, uint64_t, void *, void *, uint32_t, void *)');
  const completed = library.func('bool SteamAPI_ISteamUtils_IsAPICallCompleted(void *, uint64_t, void *)');
  const result = library.func('bool SteamAPI_ISteamUtils_GetAPICallResult(void *, uint64_t, void *, int, int, void *)');
  return {
    dispose,
    download: (id: string) => {
      downloads.delete(id);
      if (!download(ugc, BigInt(id), false)) throw new Error(`Steam could not start downloading Workshop item ${id}. Check Steam connectivity.`);
    },
    downloadResult: (id: string) => downloads.get(id),
    downloadInfo: (id: string) => {
      const downloaded = Buffer.alloc(8), total = Buffer.alloc(8);
      if (!downloadInfo(ugc, BigInt(id), downloaded, total)) return undefined;
      return { downloaded: downloaded.readBigUInt64LE(0), total: total.readBigUInt64LE(0) };
    },
    pump: () => client.callbacks(),
    state: (id: string) => Number(state(ugc, BigInt(id))),
    folder: (id: string): string | undefined => {
      const folder = Buffer.alloc(4096);
      if (!install(ugc, BigInt(id), Buffer.alloc(8), folder, folder.length, Buffer.alloc(4))) return;
      const value = folder.toString('utf8').split('\0')[0];
      return value && existsSync(value) ? value : undefined;
    },
    subscribe: async (id: string) => {
      const handle = subscribe(ugc, BigInt(id));
      if (!handle || BigInt(handle) === 0n) throw new Error(`Steam could not subscribe to Workshop item ${id}.`);
      const failed = Buffer.alloc(1);
      const deadline = Date.now() + 30000;
      while (!completed(utils, handle, failed)) {
        if (Date.now() > deadline) throw new Error(`Steam subscription timed out for ${id}. Check Steam connectivity.`);
        client.callbacks();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const payload = Buffer.alloc(16);
      // RemoteStorageSubscribePublishedFileResult_t (1313), native Windows x64 alignment.
      if (failed[0] || !result(utils, handle, payload, payload.length, 1313, failed) || failed[0] || payload.readInt32LE(0) !== 1 || payload.readBigUInt64LE(8) !== BigInt(id)) {
        throw new Error(`Steam refused Workshop item ${id} (result ${payload.readInt32LE(0)}). It may be private, deleted, or unavailable.`);
      }
    },
  };
}

export function closeSteamDiscovery() {
  [...workshopCleanups].forEach((dispose) => dispose());
  if (steam) steam.shutdown();
  steam = undefined;
}

export function discoverSteamServers(gameExecutable: string, progress: (value: ServerScanProgress) => void, log: ServerLog, signal?: AbortSignal): Promise<DayZServer[]> {
  const task = scanQueue.then(async () => {
    if (signal?.aborted) return [];
    steam ??= createSteam(gameExecutable);
    const client = steam;
    const allocations: unknown[] = [];
    const handles: unknown[] = [];
    const requestFilters: Array<Array<[string, string]>> = [];
    const pendingFilters: Array<Array<[string, string]>> = [];
    const addRequest = (filters: Array<[string, string]>) => pendingFilters.push(filters);
    const startRequest = (filters: Array<[string, string]>) => {
      const pointers = filters.map(([name, value]) => {
        const pointer = koffi.alloc('uint8_t', 512);
        const buffer = Buffer.alloc(512);
        buffer.write(name, 0, 255, 'ascii');
        buffer.write(value, 256, 255, 'ascii');
        koffi.encode(pointer, 'uint8_t', [...buffer], 512);
        allocations.push(pointer);
        return pointer;
      });
      const table = pointers.length ? koffi.alloc('void *', pointers.length) : null;
      if (table) {
        koffi.encode(table, 'void *', pointers, pointers.length);
        allocations.push(table);
      }
      const handle = client.request(client.api, DAYZ_APP_ID, table, pointers.length, null);
      if (!handle) throw new Error('Steam did not create a server-list request.');
      handles.push(handle);
      requestFilters.push(filters);
    };
    const started = Date.now();
    let servers: DayZServer[] = [];
    let lastProgress = 0;

    try {
      // Steam limits individual result sets. Merge complementary partitions
      // using supported Steamworks filters, plus official candidates, rather than taking the
      // first worldwide result set as a complete directory.
      // Query official shards directly so a capped general result set cannot crowd them out.
      addRequest([['gametagsnor', 'privHive']]);
      addRequest([]);
      addRequest([['gametagsand', 'shard000']]);
      addRequest([['gametagsnor', 'external']]);
      const queuedMaps = new Set<string>();
      let launchedAt = Date.now();
      startRequest(pendingFilters.shift()!);
      while (true) {
        client.callbacks();
        const states = handles.map((handle) => client.refreshing(client.api, handle));
        const counts = handles.map((handle) => client.count(client.api, handle));
        const active = states.some(Boolean);
        if (Date.now() - lastProgress >= 1000 || !active) {
          const unique = new Map<string, DayZServer>();
          for (const handle of handles) {
            const count = client.count(client.api, handle);
            for (let index = 0; index < count; index++) {
              const pointer = client.details(client.api, handle, index);
              if (!pointer) continue;
              const server = parseSteamServer(Buffer.from(koffi.decode(pointer, 'uint8_t', 364)));
              const prior = unique.get(server.address);
              if (server.host !== '0.0.0.0' && server.queryPort && server.gamePort && (!prior || server.lastSeen > prior.lastSeen || (!prior.tags.length && server.tags.length))) unique.set(server.address, server);
            }
          }
          servers = [...unique.values()];
          // A worldwide list can hit Steam's cap before whole communities appear.
          // Partition by maps actually advertised in the directory, including
          // custom maps, rather than relying on population/tag combinations.
          for (const server of servers) {
            if (!server.map || queuedMaps.has(server.map)) continue;
            queuedMaps.add(server.map);
            addRequest([['map', server.map]]);
          }
          progress({ total: servers.length, complete: servers.filter((server) => server.lastSeen > 0).length, servers });
          lastProgress = Date.now();
        }
        if (signal?.aborted) break;
        const currentCount = counts[counts.length - 1] ?? 0;
        // Steam keeps pinging a capped list long after directory entries arrive.
        // Give complementary requests time within the shared scan deadline.
        if (pendingFilters.length && Date.now() - launchedAt >= (currentCount >= STEAM_RESULT_LIMIT ? 5000 : 15000)) {
          client.cancel(client.api, handles[handles.length - 1]);
        }
        if (!active && Date.now() - launchedAt >= (currentCount ? 1000 : 5000)) {
          const nextFilters = pendingFilters.shift();
          if (!nextFilters) break;
          startRequest(nextFilters);
          launchedAt = Date.now();
        }
        if (Date.now() - started >= REFRESH_TIMEOUT_MS) {
          log('WARN', 'Steam refresh reached 90 seconds; retaining available listings.', { count: servers.length });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!servers.length) throw new Error('Steam returned no DayZ servers. Check Steam connectivity, then retry.');
      log('INFO', 'Steam server discovery finished.', { count: servers.length, officialCandidates: servers.filter((server) => isOfficialCandidate(server.tags)).length });
      handles.forEach((handle, index) => log('INFO', 'Steam request results.', { filters: requestFilters[index], count: client.count(client.api, handle) }));
      if (handles.some((handle) => client.count(client.api, handle) >= STEAM_RESULT_LIMIT)) log('WARN', 'A Steam partition reached its result limit; complete coverage is not guaranteed.');
      return servers;
    } finally {
      for (const handle of handles) {
        client.cancel(client.api, handle);
        client.release(client.api, handle);
      }
      for (const pointer of allocations) koffi.free(pointer);
    }
  });
  scanQueue = task.catch(() => undefined);
  return task;
}
