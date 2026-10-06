import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMasterRequest, getSteamMasterEndpoints, parseInfo, parseMasterResponse, parseServerAddress, parseServerList, queryAddressCandidates } from '../node_modules/.cache/dayz-launchpad-server-browser.mjs';

test('imports HTTPS directory snapshots without inventing local ping or response time', () => {
  const row = { game: 'dayz', endpoint: { ip: '203.0.113.7', port: 27016 }, gamePort: 2302, name: 'Community server', players: 12, maxPlayers: 60, password: true, vac: true };
  const servers = parseServerList({ status: 0, result: [row, row, { ...row, gamePort: 70000 }, null] });
  assert.equal(servers.length, 1);
  assert.equal(servers[0].address, '203.0.113.7:27016');
  assert.equal(servers[0].gamePort, 2302);
  assert.equal(servers[0].password, true);
  assert.equal(servers[0].ping, null);
  assert.equal(servers[0].lastSeen, 0);
  assert.throws(() => parseServerList({ result: [] }), /no usable/);
  assert.throws(() => parseServerList({ error: 'unavailable' }), /unexpected/);
});

test('uses the Valve master server on port 27011 with hostname and IP fallbacks', () => {
  const endpoints = getSteamMasterEndpoints();
  assert.deepEqual(endpoints[0], { host: 'hl2master.steampowered.com', port: 27011 });
  assert.ok(endpoints.every((endpoint) => endpoint.port === 27011));
  assert.ok(endpoints.some((endpoint) => endpoint.host === '208.64.200.65'));
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

test('builds the Steam master request with ASCII cursor and NUL-delimited filter', () => {
  const request = buildMasterRequest('0.0.0.0:0', '\\appid\\221100\\gamedir\\dayz');
  assert.equal(request.subarray(0, 2).toString('hex'), '31ff');
  assert.equal(request.subarray(2).toString('ascii'), '0.0.0.0:0\0\\appid\\221100\\gamedir\\dayz\0');
});

test('parses Steam master-server IPv4 and query-port records', () => {
  const record = Buffer.from([203, 0, 113, 7, 0x69, 0x88]);
  const packet = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x66, 0x0a]), record, Buffer.alloc(6)]);
  const result = parseMasterResponse(packet);
  assert.deepEqual(result.servers, [{ host: '203.0.113.7', port: 27016 }]);
  assert.equal(result.cursor, '203.0.113.7:27016');
  assert.equal(result.done, true);
  assert.equal(parseMasterResponse(packet.subarray(0, -6)).done, false);
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
