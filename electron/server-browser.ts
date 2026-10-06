import { createSocket, type RemoteInfo } from 'node:dgram';
import { lookup } from 'node:dns/promises';

export interface DayZServer {
  address: string;
  host: string;
  queryPort: number;
  gamePort: number;
  name: string;
  map: string;
  game: string;
  players: number;
  maxPlayers: number;
  bots: number;
  password: boolean;
  vac: boolean;
  version: string;
  tags: string[];
  ping: number | null;
  lastSeen: number;
}

export interface ServerScanProgress {
  total: number;
  complete: number;
  servers: DayZServer[];
}

export type ServerLog = (level: 'INFO' | 'WARN' | 'ERROR', message: string, details?: unknown) => void;

export const MASTER_ENDPOINTS = [
  { host: 'hl2master.steampowered.com', port: 27011 },
  { host: '208.64.200.65', port: 27011 },
  { host: '208.64.200.66', port: 27011 },
];

export function getSteamMasterEndpoints(): Array<{ host: string; port: number }> {
  return MASTER_ENDPOINTS.map((endpoint) => ({ ...endpoint }));
}

const QUERY_TIMEOUT_MS = 1400;
const QUERY_CONCURRENCY = 48;
const FIRST_MASTER_CURSOR = '0.0.0.0:0';
const DZSA_SERVER_LIST_URL = 'https://dayzsalauncher.com/api/v1/launcher/servers/dayz';

export function parseServerList(payload: unknown): DayZServer[] {
  if (!payload || typeof payload !== 'object' || !('result' in payload) || !Array.isArray(payload.result)) {
    throw new Error('The server-list service returned an unexpected response.');
  }
  const servers = new Map<string, DayZServer>();
  for (const row of payload.result) {
    try {
      if (!row || typeof row !== 'object' || row.game !== 'dayz' || typeof row.endpoint?.ip !== 'string') continue;
      const { host, port, address } = parseServerAddress(`${row.endpoint.ip}:${row.endpoint.port}`);
      if (!Number.isInteger(row.gamePort) || row.gamePort < 1 || row.gamePort > 65535) continue;
      if (typeof row.name !== 'string' || !Number.isInteger(row.players) || row.players < 0 || !Number.isInteger(row.maxPlayers) || row.maxPlayers < 0) continue;
      servers.set(address, {
        address, host, queryPort: port, gamePort: row.gamePort,
        name: row.name, map: typeof row.map === 'string' ? row.map : '', game: 'DayZ',
        players: row.players, maxPlayers: row.maxPlayers, bots: 0,
        password: row.password === true, vac: row.vac === true,
        version: typeof row.version === 'string' ? row.version : '',
        tags: [row.shard === 'public' ? 'public hive' : row.shard === 'private' ? 'private hive' : '', row.firstPersonOnly === true ? 'firstperson' : ''].filter(Boolean),
        ping: null, lastSeen: 0, // Provider snapshot; not a local response or measured timestamp.
      });
    } catch {
      // Ignore malformed entries without losing the rest of the directory.
    }
  }
  if (!servers.size) throw new Error('The server-list service returned no usable DayZ servers.');
  return [...servers.values()];
}

export async function downloadServerList(writeLog: ServerLog = () => undefined): Promise<DayZServer[]> {
  writeLog('INFO', 'Downloading DZSA server directory over HTTPS.');
  const response = await fetch(DZSA_SERVER_LIST_URL, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`The server-list service returned HTTP ${response.status}.`);
  const servers = parseServerList(await response.json());
  writeLog('INFO', 'DZSA server directory downloaded.', { count: servers.length });
  return servers;
}

function formatAddress(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

function nullTerminatedString(packet: Buffer, cursor: { offset: number }): string {
  const end = packet.indexOf(0, cursor.offset);
  if (end < 0) throw new Error('Malformed server query response.');
  const value = packet.toString('utf8', cursor.offset, end);
  cursor.offset = end + 1;
  return value;
}

export function parseInfo(packet: Buffer, host: string, queryPort: number, ping: number): DayZServer {
  let offset = packet.indexOf(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  if (offset < 0) throw new Error('Malformed A2S_INFO response.');
  offset += 5;
  if (packet[offset - 1] !== 0x49) throw new Error('Unexpected A2S_INFO response.');
  const cursor = { offset: offset + 1 };
  const name = nullTerminatedString(packet, cursor);
  const map = nullTerminatedString(packet, cursor);
  const folder = nullTerminatedString(packet, cursor);
  const game = nullTerminatedString(packet, cursor);
    cursor.offset += 2; // Skip the appId as it's not needed
  const players = packet.readUInt8(cursor.offset++);
  const maxPlayers = packet.readUInt8(cursor.offset++);
  const bots = packet.readUInt8(cursor.offset++);
  cursor.offset += 2; // Server type and environment precede visibility and VAC.
  const password = packet.readUInt8(cursor.offset++) !== 0;
  const vac = packet.readUInt8(cursor.offset++) !== 0;
  const version = nullTerminatedString(packet, cursor);
    if (!/dayz/i.test(folder) && !/dayz/i.test(game)) throw new Error('Query response is not a DayZ server.');
  let gamePort = queryPort;
  let keywords: string[] = [];

  if (cursor.offset < packet.length) {
    const extraData = packet.readUInt8(cursor.offset++);
    if ((extraData & 0x80) !== 0 && cursor.offset + 2 <= packet.length) {
      gamePort = packet.readUInt16LE(cursor.offset);
      cursor.offset += 2;
    }
    if ((extraData & 0x10) !== 0) cursor.offset += 8;
    if ((extraData & 0x40) !== 0) {
      cursor.offset += 2;
      if (cursor.offset < packet.length) cursor.offset = packet.indexOf(0, cursor.offset) + 1;
    }
    if ((extraData & 0x20) !== 0 && cursor.offset < packet.length) {
      const rawKeywords = nullTerminatedString(packet, cursor);
      keywords = rawKeywords.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 32);
    }
    if ((extraData & 0x01) !== 0) cursor.offset += 8;
  }

  return {
    address: formatAddress(host, queryPort),
    host,
    queryPort,
    gamePort,
    name: name || `${folder} server`,
    map,
    game,
    players,
    maxPlayers,
    bots,
    password,
    vac,
    version,
    tags: keywords,
    ping,
    lastSeen: Date.now(),
  };
}

function udpRequest(host: string, port: number, request: Buffer, timeout = QUERY_TIMEOUT_MS): Promise<{ packet: Buffer; remote: RemoteInfo }> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(host.includes(':') ? 'udp6' : 'udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Server query timed out.'));
    }, timeout);
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.once('message', (packet, remote) => {
      clearTimeout(timer);
      socket.close();
      resolve({ packet, remote });
    });
    socket.send(request, port, host, (error) => {
      if (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });
  });
}

function infoRequest(challenge?: Buffer): Buffer {
  const header = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]);
  const query = Buffer.from('Source Engine Query\0', 'ascii');
  return challenge ? Buffer.concat([header, query, challenge]) : Buffer.concat([header, query]);
}

async function queryInfo(host: string, port: number): Promise<DayZServer> {
  const resolvedHost = (await lookup(host, { family: host.includes(':') ? 6 : 4 })).address;
  const start = Date.now();
  let response = await udpRequest(resolvedHost, port, infoRequest());
  if (response.packet.length >= 9 && response.packet.readUInt32LE(0) === 0xffffffff && response.packet[4] === 0x41) {
    response = await udpRequest(resolvedHost, port, infoRequest(response.packet.subarray(5, 9)));
  }
  return parseInfo(response.packet, resolvedHost, port, Date.now() - start);
}

export function buildMasterRequest(cursor: string, filter: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x31, 0xff]),
    Buffer.from(cursor, 'ascii'),
    Buffer.from([0]),
    Buffer.from(filter, 'utf8'),
    Buffer.from([0]),
  ]);
}

export function parseMasterResponse(packet: Buffer): { servers: Array<{ host: string; port: number }>; cursor?: string; done: boolean } {
  const header = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x66, 0x0a]);
  if (packet.length < header.length || !packet.subarray(0, header.length).equals(header)) {
    throw new Error('Steam returned an unexpected master-server response.');
  }
  let offset = header.length;
  const servers: Array<{ host: string; port: number }> = [];
  let cursor: string | undefined;
  let done = false;
  while (offset + 6 <= packet.length) {
    const entry = packet.subarray(offset, offset + 6);
    offset += 6;
    const host = `${entry[0]}.${entry[1]}.${entry[2]}.${entry[3]}`;
    const port = entry.readUInt16BE(4);
    if (host === '0.0.0.0' && port === 0) {
      done = true;
      break;
    }
    cursor = `${host}:${port}`;
    servers.push({ host, port });
  }
  return { servers, cursor, done };
}

async function masterPage(host: string, port: number, cursor: string): Promise<Buffer> {
  const request = buildMasterRequest(cursor, '\\appid\\221100\\gamedir\\dayz');
  return (await udpRequest(host, port, request, 4500)).packet;
}

export async function discoverAddresses(writeLog: ServerLog = () => undefined): Promise<Array<{ host: string; port: number }>> {
  for (const endpoint of getSteamMasterEndpoints()) {
    writeLog('INFO', 'Querying Steam Source master endpoint.', endpoint);
    try {
      const servers: Array<{ host: string; port: number }> = [];
      const seen = new Set<string>();
      let cursor = FIRST_MASTER_CURSOR;
      const cursors = new Set<string>();
      while (true) {
        if (cursors.has(cursor)) throw new Error('Steam master pagination repeated a cursor before completing.');
        cursors.add(cursor);
        const page = parseMasterResponse(await masterPage(endpoint.host, endpoint.port, cursor));
        if (!page.servers.length && !page.done) throw new Error('Steam returned an incomplete master-server page.');
        for (const server of page.servers) {
          const key = `${server.host}:${server.port}`;
          if (!seen.has(key)) {
            seen.add(key);
            servers.push(server);
          }
        }
        if (page.done) break;
        if (!page.cursor) throw new Error('Steam master response has no continuation cursor.');
        cursor = page.cursor;
      }
      writeLog('INFO', 'Steam master query completed.', { count: servers.length });
      return servers;
    } catch (error) {
      writeLog('WARN', 'Steam master query failed.', error);
      continue;
    }
  }
  const endpoints = getSteamMasterEndpoints().map((endpoint) => `${endpoint.host}:${endpoint.port}`).join(', ');
  const message = `Could not reach Steam server discovery at ${endpoints} over UDP. Check that your firewall or router allows outbound UDP, then retry; direct server addresses are still available.`;
  writeLog('ERROR', message);
  throw new Error(message);
}

export function parseServerAddress(input: string): { host: string; port: number; address: string } {
  const value = input.trim().replace(/^(?:dayz|steam):\/\//i, '');
  const match = value.match(/^\[([0-9a-f:]+)]:(\d{1,5})$|^([a-z0-9.-]+):(\d{1,5})$/i);
  if (!match) throw new Error('Enter a server address as hostname:query-port or [IPv6]:query-port.');
  const host = match[1] ?? match[3];
  const port = Number(match[2] ?? match[4]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Server port must be between 1 and 65535.');
  return { host, port, address: formatAddress(host, port) };
}

export function queryAddressCandidates(input: string): string[] {
  const parsed = parseServerAddress(input);
  const candidates = [parsed.address];
  if (parsed.port < 65535) candidates.push(formatAddress(parsed.host, parsed.port + 1));
  return candidates;
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>, completed: (result: R | undefined, count: number, error: unknown | undefined, item: T) => void): Promise<R[]> {
  const output: R[] = [];
  let nextIndex = 0;
  let complete = 0;
  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        const result = await worker(items[index]);
        output.push(result);
        complete++;
        completed(result, complete, undefined, items[index]);
      } catch (error) {
        complete++;
        completed(undefined, complete, error, items[index]);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return output;
}

export async function scanServers(
  scope: 'internet' | 'favorites' | 'history',
  savedAddresses: string[],
  onProgress: (progress: ServerScanProgress) => void,
  writeLog: ServerLog = () => undefined,
): Promise<DayZServer[]> {
  writeLog('INFO', 'Starting server scan.', { scope, savedCount: savedAddresses.length });
  if (scope === 'internet') {
    try {
      const servers = (await downloadServerList(writeLog)).sort((left, right) => right.players - left.players);
      onProgress({ total: servers.length, complete: servers.length, servers });
      return servers;
    } catch (error) {
      writeLog('WARN', 'HTTPS directory unavailable; trying Steam UDP discovery.', error);
    }
  }
  const addresses = scope === 'internet'
    ? await discoverAddresses(writeLog)
    : savedAddresses.map((address) => parseServerAddress(address));
  const candidates = addresses;
  const found: DayZServer[] = [];
  const recentOrder = new Map(candidates.map((server, index) => [formatAddress(server.host, server.port), index]));
  const sortResults = (servers: DayZServer[]) => scope === 'history'
    ? servers.sort((left, right) => (recentOrder.get(left.address) ?? Number.MAX_SAFE_INTEGER) - (recentOrder.get(right.address) ?? Number.MAX_SAFE_INTEGER))
    : servers.sort((left, right) => right.players - left.players);
  onProgress({ total: candidates.length, complete: 0, servers: [] });
  let failures = 0;
  let lastLoggedProgress = 0;
  await mapLimit(candidates, QUERY_CONCURRENCY, async ({ host, port }) => queryInfo(host, port), (server, complete, error, candidate) => {
    if (server) found.push(server);
    else {
      failures++;
      if (failures <= 3) writeLog('WARN', 'Server A2S query failed.', { address: formatAddress(candidate.host, candidate.port), error });
    }
    if (complete % 12 === 0 || complete === candidates.length) {
      onProgress({ total: candidates.length, complete, servers: sortResults([...found]) });
    }
    if (complete === candidates.length || complete - lastLoggedProgress >= 100) {
      lastLoggedProgress = complete;
      writeLog('INFO', 'Server scan progress.', { complete, total: candidates.length, online: found.length, failed: failures });
    }
  });
  writeLog('INFO', 'Server scan finished.', { queried: candidates.length, online: found.length, failed: failures });
  return sortResults(found);
}
