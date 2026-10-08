import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocket } from 'node:dgram';
import { generateKeyPairSync, sign } from 'node:crypto';
import { queryServerMods, parseDayZRules, matchServerMods, parseInfo, parseDayZSignatures, parseServerAddress, parseSteamServer, queryAddressCandidates, scanServers, verifyOfficialSignature } from '../node_modules/.cache/dayz-launchpad-server-browser.mjs';

test('a cancelled internet scan does not initialize Steam or publish results', async () => {
  const controller = new AbortController();
  controller.abort();
  let updates = 0;
  const servers = await scanServers('internet', [], () => updates++, () => {}, '', controller.signal);
  assert.deepEqual(servers, []);
  assert.equal(updates, 0);
});

test('decodes Steam game and query ports separately without trusting official shard claims', () => {
  const record = Buffer.alloc(364);
  record.writeUInt16LE(2302, 0);
  record.writeUInt16LE(27016, 2);
  record.writeUInt32LE(0xcb007107, 4);
  record.writeInt32LE(35, 8);
  record[12] = 1;
  record.write('chernarusplus', 46);
  record.write('DayZ', 78);
  record.writeInt32LE(12, 148);
  record.writeInt32LE(60, 152);
  record.write('Official candidate', 172);
  record.write('battleye,shard001', 236);
  const server = parseSteamServer(record);
  assert.equal(server.address, '203.0.113.7:27016');
  assert.equal(server.gamePort, 2302);
  assert.equal(server.ping, 35);
  assert.equal(server.category, 'unverified');
  record.fill(0, 236);
  record.write('battleye,external,privHive,shardABC123', 236);
  record[12] = 0;
  assert.equal(parseSteamServer(record).category, 'community');
  assert.equal(parseSteamServer(record).ping, null);
});

test('official verification binds the signature to the exact name and game endpoint', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const server = { name: 'Official server', host: '203.0.113.7', gamePort: 2302 };
  const encoded = sign('RSA-SHA256', Buffer.from('Official server203.0.113.7:2302'), privateKey).toString('base64');
  const signatures = [`sign2:${encoded.slice(172)}`, `sign1:${encoded.slice(0, 172)}`];
  assert.equal(verifyOfficialSignature(server, signatures, publicKey), true);
  assert.equal(verifyOfficialSignature({ ...server, name: 'Copied name' }, signatures, publicKey), false);
  assert.equal(verifyOfficialSignature({ ...server, gamePort: 2303 }, signatures, publicKey), false);
  assert.equal(verifyOfficialSignature({ ...server, host: '203.0.113.8' }, signatures, publicKey), false);
  assert.equal(verifyOfficialSignature(server, signatures.slice(0, 1), publicKey), false);
});

test('decodes DayZ rules signatures and rejects missing fragments and overflow', () => {
  const payload = Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 2, 9]), Buffer.from('sign1:abc'), Buffer.from([9]), Buffer.from('sign2:def')]);
  // Correct length-prefixed signature strings are nine bytes each.
  const escaped = Buffer.from([...payload].flatMap((byte) => byte === 0 ? [1, 2] : byte === 1 ? [1, 1] : byte === 255 ? [1, 3] : [byte]));
  const packet = Buffer.concat([Buffer.from([255, 255, 255, 255, 69, 1, 0, 1, 1, 0]), escaped, Buffer.from([0])]);
  assert.deepEqual(parseDayZSignatures(packet), ['sign1:abc', 'sign2:def']);
  const missing = Buffer.from(packet);
  missing[8] = 2;
  assert.throws(() => parseDayZSignatures(missing), /Incomplete/);
  const overflow = Buffer.from(packet);
  overflow[11] = 2;
  assert.throws(() => parseDayZSignatures(overflow), /truncated|Invalid Workshop ID width/);
});

test('parses IPv4 and hostname query addresses and rejects invalid ports', () => {
  assert.deepEqual(parseServerAddress('play.example.net:27016'), {
    host: 'play.example.net',
    port: 27016,
    address: 'play.example.net:27016',
  });
  assert.deepEqual(parseServerAddress('[2001:db8::8]:27016'), {
    host: '2001:db8::8',
    port: 27016,
    address: '[2001:db8::8]:27016',
  });
  assert.throws(() => parseServerAddress('play.example.net:70000'), /between 1 and 65535/);
  assert.throws(() => parseServerAddress('not-an-address'), /hostname:query-port/);
});

test('parses DayZ A2S_INFO metadata including game port and keywords', () => {
  const text = (value) => Buffer.from(`${value}\0`, 'ascii');
  const fixed = Buffer.from([0, 0, 12, 60, 0, 100, 119, 0, 1]);
  const gamePort = Buffer.alloc(2);
  gamePort.writeUInt16LE(2302);
  const packet = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17]),
    text('Chernarus Main | DayZ'),
    text('chernarusplus'),
    text('dayz'),
    text('DayZ'),
    fixed,
    text('1.28.159000'),
    Buffer.from([0xa0]),
    gamePort,
    text('official,firstperson'),
  ]);
  const server = parseInfo(packet, '203.0.113.7', 27016, 42);
  assert.equal(server.name, 'Chernarus Main | DayZ');
  assert.equal(server.players, 12);
  assert.equal(server.maxPlayers, 60);
  assert.equal(server.gamePort, 2302);
  assert.equal(server.ping, 42);
  assert.equal(server.password, false);
  assert.equal(server.vac, true);
  assert.deepEqual(server.tags, ['official', 'firstperson']);
});

test('rejects an A2S response that does not advertise DayZ', () => {
  const text = (value) => Buffer.from(`${value}\0`, 'ascii');
  const packet = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17]),
    text('Not DayZ'), text('map'), text('other-game'), text('Other Game'),
    Buffer.from([0, 0, 0, 0, 0, 100, 119, 0, 1]), text('1.0'),
  ]);
  assert.throws(() => parseInfo(packet, '203.0.113.7', 27016, 5), /not a DayZ server/);
});

test('tries the entered port and common DayZ game-port-plus-one query port', () => {
  assert.deepEqual(queryAddressCandidates('85.190.152.177:10400'), [
    '85.190.152.177:10400',
    '85.190.152.177:10401',
  ]);
  assert.deepEqual(queryAddressCandidates('[2001:db8::8]:65535'), ['[2001:db8::8]:65535']);
});

function modRules(records, flags = 0) {
  const parts = [Buffer.from([2, flags, 0, 0, records.length])];
  for (const [id, name] of records) {
    const value = Buffer.alloc(8);
    value.writeBigUInt64LE(BigInt(id));
    const title = Buffer.from(name);
    parts.push(Buffer.alloc(4), Buffer.from([8]), value, Buffer.from([title.length]), title);
  }
  parts.push(Buffer.from([0]));
  const escaped = Buffer.from([...Buffer.concat(parts)].flatMap((byte) => byte === 0 ? [1, 2] : byte === 1 ? [1, 1] : byte === 255 ? [1, 3] : [byte]));
  return Buffer.concat([Buffer.from([255,255,255,255,69,1,0,1,1,0]), escaped, Buffer.from([0])]);
}

test('required mods preserve server order and full-width Workshop IDs', () => {
  const mods = [{ id: '9007199254740993', name: 'Framework' }, { id: '1234', name: 'Content' }];
  const decoded = parseDayZRules(modRules(mods.map((mod) => [mod.id, mod.name])));
  assert.deepEqual(decoded.mods, mods);
  assert.equal(decoded.modsComplete, true);
  assert.deepEqual(matchServerMods(decoded.mods, [{ id: '1234', path: 'local' }, { id: '999', path: 'extra' }]), [
    { ...mods[0], installed: false }, { ...mods[1], installed: true },
  ]);
});

test('empty complete lists allow vanilla; truncated lists and unpublished mods are incomplete', () => {
  assert.deepEqual(parseDayZRules(modRules([])).mods, []);
  assert.equal(parseDayZRules(modRules([])).modsComplete, true);
  assert.equal(parseDayZRules(modRules([['1234', 'Mod']], 1)).modsComplete, false);
  assert.equal(parseDayZRules(modRules([['0', 'Local mod']])).modsComplete, false);
  assert.throws(() => parseDayZSignatures(modRules([], 2)), /truncated/);
});

test('mod query keeps the challenge socket and assembles out-of-order split replies', async () => {
  const socket = createSocket('udp4');
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
  let firstPort;
  const packet = modRules([['1234', 'Live fixture']]);
  socket.on('message', (request, remote) => {
    if (request.readInt32LE(5) === -1) {
      firstPort = remote.port;
      socket.send(Buffer.from([255,255,255,255,65,42,0,0,0]), remote.port, remote.address);
      return;
    }
    if (remote.port !== firstPort || request.readInt32LE(5) !== 42) return;
    const middle = Math.floor(packet.length / 2);
    for (const index of [1, 0]) {
      const header = Buffer.alloc(12);
      header.writeInt32LE(-2, 0);
      header.writeUInt32LE(77, 4);
      header[8] = 2;
      header[9] = index;
      header.writeUInt16LE(1248, 10);
      socket.send(Buffer.concat([header, index ? packet.subarray(middle) : packet.subarray(0, middle)]), remote.port, remote.address);
    }
  });
  try {
    assert.deepEqual(await queryServerMods(`127.0.0.1:${socket.address().port}`), [{ id: '1234', name: 'Live fixture' }]);
  } finally { socket.close(); }
});
