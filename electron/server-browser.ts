import { createSocket, type RemoteInfo } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { discoverSteamServers, isOfficialCandidate, serverCategory } from './steam-discovery.js';
export { closeSteamDiscovery, parseSteamServer } from './steam-discovery.js';

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
  category: 'official' | 'community' | 'unverified';
}

export interface ServerScanProgress {
  total: number;
  complete: number;
  servers: DayZServer[];
}

export type ServerLog = (level: 'INFO' | 'WARN' | 'ERROR', message: string, details?: unknown) => void;

const QUERY_TIMEOUT_MS = 1400;
const QUERY_CONCURRENCY = 48;

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
  cursor.offset += 2; // Skip the appId as it's not needed.
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
    category: serverCategory(keywords),
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
    let challenges = 0;
    let splitId: number | undefined;
    let splitCount = 0;
    const pieces = new Map<number, Buffer>();
    socket.on('message', (packet, remote) => {
      if (remote.address !== host || remote.port !== port) return;
      if (packet.length >= 9 && packet.readInt32LE(0) === -1 && packet[4] === 0x41 && challenges++ < 2) {
        const challenged = request[4] === 0x56
          ? Buffer.concat([request.subarray(0, 5), packet.subarray(5, 9)])
          : Buffer.concat([infoRequest(), packet.subarray(5, 9)]);
        socket.send(challenged, port, host);
        return;
      }
      if (packet.length >= 12 && packet.readInt32LE(0) === -2) {
        const id = packet.readUInt32LE(4);
        const count = packet[8];
        const index = packet[9];
        if (id & 0x80000000 || !count || count > 64 || index >= count || (splitId !== undefined && (splitId !== id || splitCount !== count))) {
          clearTimeout(timer);
          socket.close();
          reject(new Error('Unsupported or invalid split server response.'));
          return;
        }
        splitId = id;
        splitCount = count;
        pieces.set(index, packet.subarray(12));
        if (pieces.size !== count) return;
        packet = Buffer.concat(Array.from({ length: count }, (_, number) => pieces.get(number)!));
      }
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

export interface ServerMod { id: string; name: string; }

export function parseDayZRules(packet: Buffer): { mods: ServerMod[]; signatures: string[]; modsComplete: boolean; signaturesComplete: boolean; modsTruncated: boolean } {
  if (packet.length < 7 || packet.readInt32LE(0) !== -1 || packet[4] !== 0x45) throw new Error('Unexpected DayZ rules response.');
  let offset = 7;
  const fragments = new Map<number, Buffer>();
  let total = 0;
  const readString = () => {
    const end = packet.indexOf(0, offset);
    if (end < 0) throw new Error('Truncated DayZ rules.');
    const value = packet.subarray(offset, end);
    offset = end + 1;
    return value;
  };
  for (let index = 0; index < packet.readUInt16LE(5); index++) {
    const key = readString();
    const value = readString();
    if (key.length !== 2 || !key[0] || key[0] > key[1]) continue;
    if ((total && total !== key[1]) || fragments.has(key[0])) throw new Error('Inconsistent DayZ rules fragments.');
    total = key[1];
    fragments.set(key[0], value);
  }
  if (!total || fragments.size !== total) throw new Error('Incomplete DayZ rules fragments.');
  const escaped = Buffer.concat(Array.from({ length: total }, (_, index) => fragments.get(index + 1)!));
  const bytes: number[] = [];
  for (let index = 0; index < escaped.length; index++) {
    if (escaped[index] !== 1) bytes.push(escaped[index]);
    else {
      const code = escaped[++index];
      if (code === 1) bytes.push(1);
      else if (code === 2) bytes.push(0);
      else if (code === 3) bytes.push(255);
      else throw new Error('Invalid DayZ rules escape.');
    }
  }
  const data = Buffer.from(bytes);
  let cursor = 0;
  const take = (length: number) => {
    if (cursor + length > data.length) throw new Error('Truncated DayZ rules payload.');
    const value = data.subarray(cursor, cursor + length);
    cursor += length;
    return value;
  };
  const byte = () => take(1)[0];
  if (byte() !== 2) throw new Error('Unsupported DayZ rules protocol.');
  const flags = byte();

  const dlc = take(2).readUInt16LE(0);
  for (let bit = 0; bit < 16; bit++) if (dlc & (1 << bit)) take(4);
  const modCount = byte();
  const mods: ServerMod[] = [];
  for (let index = 0; index < modCount; index++) {
    take(4);
    const width = byte() & 15;
    if (width < 1 || width > 8) throw new Error('Invalid Workshop ID width.');
    const encodedId = take(width);
    let id = 0n;
    for (let offset = width - 1; offset >= 0; offset--) id = (id << 8n) | BigInt(encodedId[offset]);
    const name = take(byte()).toString('utf8');
    mods.push({ id: id.toString(), name: name || `Workshop ${id}` });
  }
  const signatures: string[] = [];
  const count = byte();
  for (let index = 0; index < count; index++) signatures.push(take(byte()).toString('utf8'));
  return { mods, signatures, modsTruncated: Boolean(flags & 1), signaturesComplete: !(flags & 2), modsComplete: !(flags & 1) && mods.every((mod) => mod.id !== '0') };
}

export function parseDayZSignatures(packet: Buffer): string[] {
  const rules = parseDayZRules(packet);
  if (!rules.signaturesComplete) throw new Error('Server signatures are truncated.');
  return rules.signatures;
}

export function resolveServerModIds(required: ServerMod[], overrides: Record<string, string> = {}): ServerMod[] {
  return required.map((mod) => mod.id === '0' && /^[1-9]\d{0,19}$/.test(overrides[mod.name] ?? '')
    ? { ...mod, id: overrides[mod.name] } : mod);
}

export function matchServerMods(required: ServerMod[], installed: { id: string; path: string }[]) {
  const local = new Map(installed.map((mod) => [mod.id, mod.path]));
  return required.map((mod) => ({ ...mod, installed: local.has(mod.id) }));
}

export async function queryServerMods(address: string, preview = false): Promise<ServerMod[]> {
  const { host, port } = parseServerAddress(address);
  const resolved = (await lookup(host, { family: host.includes(':') ? 6 : 4 })).address;
  let response = await udpRequest(resolved, port, Buffer.from([255, 255, 255, 255, 86, 255, 255, 255, 255]), 4000);
  if (response.packet.length >= 9 && response.packet.readInt32LE(0) === -1 && response.packet[4] === 0x41) {
    response = await udpRequest(resolved, port, Buffer.concat([Buffer.from([255, 255, 255, 255, 86]), response.packet.subarray(5, 9)]), 4000);
  }
  const rules = parseDayZRules(response.packet);
  if (rules.modsTruncated) throw new Error('The server returned an incomplete mod list. Cannot safely prepare its loadout.');
  if (!preview && rules.mods.some((mod) => mod.id === '0')) throw new Error('The server does not publish Workshop IDs for its mods. Automatic matching is unavailable.');
  return rules.mods;
}

export function verifyOfficialSignature(server: Pick<DayZServer, 'name' | 'host' | 'gamePort'>, signatures: string[], key: KeyObject): boolean {
  const first = signatures.filter((value) => value.startsWith('sign1:'));
  const second = signatures.filter((value) => value.startsWith('sign2:'));
  if (first.length !== 1 || second.length !== 1) return false;
  const encoded = first[0].slice(6) + second[0].slice(6);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  return verify('RSA-SHA256', Buffer.from(server.name + formatAddress(server.host, server.gamePort), 'utf8'), key, Buffer.from(encoded, 'base64'));
}

let publicKey: KeyObject | undefined;
let keyFetchedAt = 0;
const verifiedServers = new Map<string, number>();

async function bohemiaPublicKey(writeLog: ServerLog): Promise<KeyObject | undefined> {
  if (publicKey && Date.now() - keyFetchedAt < 86400000) return publicKey;
  try {
    const response = await fetch('https://key-dayz.bistudio.com/public', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Bohemia key endpoint returned HTTP ${response.status}.`);
    const data = await response.json() as { keys: { public: { modulus: string; publicExp: string } } };
    const key = data.keys.public;
    publicKey = createPublicKey({ key: { kty: 'RSA', n: Buffer.from(key.modulus, 'base64').toString('base64url'), e: Buffer.from(key.publicExp, 'base64').toString('base64url') }, format: 'jwk' });
    keyFetchedAt = Date.now();
  } catch (error) {
    writeLog('WARN', 'Bohemia verification key unavailable; official candidates remain unverified without a cached key.', error);
  }
  return publicKey;
}

async function verifyOfficialCandidates(servers: DayZServer[], progress: (value: ServerScanProgress) => void, writeLog: ServerLog, signal?: AbortSignal) {
  if (signal?.aborted) return;
  const candidates = servers.filter((server) => isOfficialCandidate(server.tags));
  if (!candidates.length) return;
  const key = await bohemiaPublicKey(writeLog);
  if (!key) return;
  let verified = 0;
  await mapLimit(candidates, 12, async (server) => {
    if (signal?.aborted) return;
    const cacheId = JSON.stringify([server.host, server.queryPort, server.gamePort, server.name]);
    if (Date.now() - (verifiedServers.get(cacheId) ?? 0) < 600000) {
      server.category = 'official';
      verified++;
      return;
    }
    const live = await queryInfo(server.host, server.queryPort);
    let response = await udpRequest(live.host, live.queryPort, Buffer.from([255, 255, 255, 255, 86, 255, 255, 255, 255]));
    if (response.packet.length >= 9 && response.packet[4] === 0x41) {
      response = await udpRequest(live.host, live.queryPort, Buffer.concat([Buffer.from([255, 255, 255, 255, 86]), response.packet.subarray(5, 9)]));
    }
    if (verifyOfficialSignature(live, parseDayZSignatures(response.packet), key)) {
      Object.assign(server, live, { category: 'official' });
      if (verifiedServers.size >= 2000) verifiedServers.clear();
      verifiedServers.set(JSON.stringify([live.host, live.queryPort, live.gamePort, live.name]), Date.now());
      verified++;
    }
  }, (_result, complete) => {
    if (complete % 12 === 0 || complete === candidates.length) progress({ total: servers.length, complete: servers.length, servers: [...servers] });
  }, signal);
  writeLog('INFO', 'Bohemia official-server verification finished.', { candidates: candidates.length, verified, unverified: candidates.length - verified });
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>, completed: (result: R | undefined, count: number, error: unknown | undefined, item: T) => void, signal?: AbortSignal): Promise<R[]> {
  const output: R[] = [];
  let nextIndex = 0;
  let complete = 0;
  async function run() {
    while (true) {
      if (signal?.aborted) return;
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
  gameExecutable = '',
  signal?: AbortSignal,
): Promise<DayZServer[]> {
  writeLog('INFO', 'Starting server scan.', { scope, savedCount: savedAddresses.length });
  if (scope === 'internet') {
    const servers = await discoverSteamServers(gameExecutable, onProgress, writeLog, signal);
    await verifyOfficialCandidates(servers, onProgress, writeLog, signal);
    return servers.sort((left, right) => right.players - left.players);
  }
  const addresses = savedAddresses.map((address) => parseServerAddress(address));
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
  }, signal);
  writeLog('INFO', 'Server scan finished.', { queried: candidates.length, online: found.length, failed: failures });
  await verifyOfficialCandidates(found, onProgress, writeLog, signal);
  return sortResults(found);
}
