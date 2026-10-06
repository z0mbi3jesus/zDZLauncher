import koffi from 'koffi';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DayZServer, ServerLog, ServerScanProgress } from './server-browser.js';

export function serverCategory(tags: string[]): DayZServer['category'] {
  if (tags.some((tag) => /^shard0\d{2}$/i.test(tag))) return 'unverified';
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

function createSteam(gameExecutable: string) {
  const dllPath = path.join(path.dirname(gameExecutable), 'steam_api64.dll');
  if (!gameExecutable || !existsSync(dllPath)) throw new Error('Set the DayZ installation path in Settings to enable Steam server discovery.');
  process.env.SteamAppId = '221100';
  process.env.SteamGameId = '221100';
  const library = koffi.load(dllPath);
  const init = library.func('bool SteamAPI_Init()');
  if (!init()) throw new Error('Steam could not initialize. Open Steam, sign in to the account that owns DayZ, then retry.');
  const api = library.func('void *SteamAPI_SteamMatchmakingServers_v002()')();
  if (!api) throw new Error('The installed Steam API does not expose server discovery. Verify the DayZ installation in Steam.');
  return {
    api,
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

export function closeSteamDiscovery() {
  if (steam) steam.shutdown();
  steam = undefined;
}

export function discoverSteamServers(gameExecutable: string, progress: (value: ServerScanProgress) => void, log: ServerLog): Promise<DayZServer[]> {
  const task = scanQueue.then(async () => {
    steam ??= createSteam(gameExecutable);
    const client = steam;
    const allocations: unknown[] = [];
    const handles: unknown[] = [];
    const addRequest = (filters: Array<[string, string]>) => {
      const pointers = filters.map(([name, value]) => {
        const pointer = koffi.alloc('uint8_t', 512);
        const buffer = Buffer.alloc(512);
        buffer.write(name, 0, 255, 'ascii');
        buffer.write(value, 256, 255, 'ascii');
        koffi.encode(pointer, 'uint8_t', [...buffer], 512);
        allocations.push(pointer);
        return pointer;
      });
      const handle = client.request(client.api, 221100, pointers.length ? pointers : null, pointers.length, null);
      if (!handle) throw new Error('Steam did not create a server-list request.');
      handles.push(handle);
    };
    const started = Date.now();
    let servers: DayZServer[] = [];
    let lastProgress = 0;
    try {
      // Steam limits individual result sets. Merge complementary partitions
      // using supported Steamworks filters, plus official candidates, rather than taking the
      // first worldwide result set as a complete directory.
      addRequest([]);
      for (const population of ['hasplayers', 'noplayers']) {
        for (const modded of [true, false]) {
          for (const firstPerson of [true, false]) {
            addRequest([[population, ''], [modded ? 'gametagsand' : 'gametagsnor', 'mod'], [firstPerson ? 'gametagsand' : 'gametagsnor', 'no3rd']]);
          }
        }
      }
      addRequest([['gametagsnor', 'external']]);
      while (true) {
        client.callbacks();
        const active = handles.some((handle) => client.refreshing(client.api, handle));
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
          progress({ total: servers.length, complete: servers.filter((server) => server.lastSeen > 0).length, servers });
          lastProgress = Date.now();
        }
        if (!active) break;
        if (Date.now() - started >= 90000) {
          log('WARN', 'Steam refresh reached 90 seconds; retaining available listings.', { count: servers.length });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!servers.length) throw new Error('Steam returned no DayZ servers. Check Steam connectivity, then retry.');
      log('INFO', 'Steam server discovery finished.', { count: servers.length });
      if (handles.some((handle) => client.count(client.api, handle) >= 10000)) log('WARN', 'A Steam partition reached its result limit; complete coverage is not guaranteed.');
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
