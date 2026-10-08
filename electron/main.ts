import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getLogFile, initializeLogger, log } from './logger.js';
import { parseServerAddress, queryAddressCandidates, queryServerMods, resolveServerModIds, matchServerMods, scanServers, type DayZServer } from './server-browser.js';
import { closeSteamDiscovery } from './steam-discovery.js';

interface Settings {
  gamePath: string;
  favoriteServers?: string[];
  recentServers?: string[];
  serverModIds?: Record<string, Record<string, string>>;
}

interface LaunchRequest {
  modIds: string[];
}

interface JoinRequest {
  host: string;
  queryPort: number;
  gamePort: number;
  password?: string;
  modIds: string[];
}

const DAYZ_APP_ID = '221100';
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Settings;
  } catch {
    return { gamePath: '' };
  }
}

function writeSettings(settings: Settings) {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function steamRoots(): string[] {
  const roots = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    path.join(app.getPath('home'), 'Steam'),
  ];
  for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
    try {
      const output = execFileSync('reg', ['query', key, '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
      const match = output.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (match?.[1]) roots.push(match[1].trim().replaceAll('/', '\\'));
    } catch {
      // Steam registry keys are not present when Steam is not installed.
    }
  }
  const unique = new Set(roots.filter(existsSync));
  for (const root of [...unique]) {
    const librariesFile = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try {
      const content = readFileSync(librariesFile, 'utf8');
      for (const match of content.matchAll(/"path"\s+"([^"]+)"/g)) {
        unique.add(match[1].replaceAll('\\\\', '\\'));
      }
    } catch {
      // Steam may not be installed in this common location.
    }
  }
  return [...unique];
}

function locateGame(): string {
  for (const root of steamRoots()) {
    const executable = path.join(root, 'steamapps', 'common', 'DayZ', 'DayZ_x64.exe');
    if (existsSync(executable)) return executable;
  }
  return '';
}

function gameExecutable(settings: Settings): string {
  const fromSettings = settings.gamePath;
  if (fromSettings && existsSync(fromSettings)) {
    return statSync(fromSettings).isDirectory() ? path.join(fromSettings, 'DayZ_x64.exe') : fromSettings;
  }
  return locateGame();
}

function parseModName(folder: string, id: string): string {
  for (const fileName of ['mod.cpp', 'meta.cpp']) {
    try {
      const contents = readFileSync(path.join(folder, fileName), 'utf8');
      const match = contents.match(/(?:name|publishedid)\s*=\s*"([^"]+)"/i);
      if (match?.[1] && fileName === 'mod.cpp') return match[1];
    } catch {
      // A missing metadata file is normal for some Workshop items.
    }
  }
  return `Workshop item ${id}`;
}

function scanMods() {
  const candidates = steamRoots().map((root) => path.join(root, 'steamapps', 'workshop', 'content', DAYZ_APP_ID));
  const workshopPath = candidates.find(existsSync) ?? '';
  if (!workshopPath) return { workshopPath: '', mods: [] };

  const discovered = new Map<string, { id: string; name: string; path: string }>();
  for (const folder of candidates.filter(existsSync)) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const modPath = path.join(folder, entry.name);
      // Steam can create a directory before an item has finished downloading.
      if (!existsSync(path.join(modPath, 'addons')) && !existsSync(path.join(modPath, 'Addons'))) continue;
      if (!discovered.has(entry.name)) discovered.set(entry.name, { id: entry.name, name: parseModName(modPath, entry.name), path: modPath });
    }
  }
  const mods = [...discovered.values()].sort((left, right) => left.name.localeCompare(right.name));

  return { workshopPath, mods };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#111513',
    title: 'DZ Launchpad',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    log('INFO', 'Loading renderer from Vite.', { url: process.env.VITE_DEV_SERVER_URL });
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const rendererPath = path.join(import.meta.dirname, '../dist/index.html');
    log('INFO', 'Loading packaged renderer.', { rendererPath });
    void window.loadFile(rendererPath);
  }
  window.webContents.on('render-process-gone', (_event, details) => log('ERROR', 'Renderer process exited.', details));
}

ipcMain.handle('app:status', () => {
  const settings = readSettings();
  const executable = gameExecutable(settings);
  const { workshopPath, mods } = scanMods();
  return { gamePath: executable, gameFound: Boolean(executable && existsSync(executable)), workshopPath, mods };
});

ipcMain.handle('app:choose-game', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose DayZ_x64.exe or the DayZ folder',
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'DayZ', extensions: ['exe'] }],
  });
  if (result.canceled || !result.filePaths[0]) return readSettings().gamePath;
  const selected = result.filePaths[0];
  const executable = statSync(selected).isDirectory() ? path.join(selected, 'DayZ_x64.exe') : selected;
  if (!existsSync(executable) || path.basename(executable).toLowerCase() !== 'dayz_x64.exe') {
    throw new Error('Select the DayZ folder or its DayZ_x64.exe file.');
  }
  writeSettings({ ...readSettings(), gamePath: executable });
  return executable;
});

ipcMain.handle('app:launch', async (_event, request: LaunchRequest) => {
  const executable = gameExecutable(readSettings());
  if (!executable || !existsSync(executable)) throw new Error('DayZ was not found. Set the game path in Settings.');
  const installedMods = new Map(scanMods().mods.map((mod) => [mod.id, mod.path]));
  const paths = request.modIds.map((id) => installedMods.get(id)).filter((modPath): modPath is string => Boolean(modPath));
  const args = paths.length ? [`-mod=${paths.join(';')}`] : [];
  log('INFO', 'Launching DayZ with active profile mods.', { executable, modCount: paths.length });
  const child = spawn(executable, args, { cwd: path.dirname(executable), detached: true, stdio: 'ignore' });
  child.once('error', (error) => log('ERROR', 'Unable to launch DayZ.', error));
  child.unref();
  return true;
});

ipcMain.handle('app:open-workshop', async (_event, url?: string) => {
  const target = url ?? 'https://steamcommunity.com/app/221100/workshop/';
  const parsed = new URL(target);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'steamcommunity.com') {
    throw new Error('Only Steam Community Workshop links can be opened.');
  }
  await shell.openExternal(parsed.toString());
});

ipcMain.handle('app:open-folder', async (_event, folder: string) => {
  const workshopPath = scanMods().workshopPath;
  const relative = workshopPath ? path.relative(workshopPath, folder) : '..';
  if (workshopPath && (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) && existsSync(folder)) {
    await shell.openPath(folder);
  }
});

ipcMain.handle('app:open-log', async () => {
  const logFile = getLogFile();
  if (!logFile) throw new Error('The application log has not been initialized.');
  log('INFO', 'Opening application log.');
  const error = await shell.openPath(logFile);
  if (error) throw new Error(error);
});

ipcMain.handle('app:log-path', () => getLogFile());

ipcMain.handle('servers:favorites', () => readSettings().favoriteServers ?? []);

const serverSearches = new Map<number, { id: string; controller: AbortController }>();

ipcMain.handle('servers:cancel', (event, id: string) => {
  const search = serverSearches.get(event.sender.id);
  if (search?.id === id) search.controller.abort();
});

ipcMain.handle('servers:search', async (event, request: { id: string; scope: 'internet' | 'favorites' | 'history' }) => {
  if (!['internet', 'favorites', 'history'].includes(request.scope)) throw new Error('Unknown server list.');
  const senderId = event.sender.id;
  serverSearches.get(senderId)?.controller.abort();
  const controller = new AbortController();
  serverSearches.set(senderId, { id: request.id, controller });
  const cancelOnClose = () => controller.abort();
  event.sender.once('destroyed', cancelOnClose);
  const settings = readSettings();
  const savedAddresses = request.scope === 'favorites'
    ? settings.favoriteServers ?? []
    : settings.recentServers ?? [];
  log('INFO', 'Server search requested.', { scope: request.scope, savedCount: savedAddresses.length });
  try {
    return await scanServers(request.scope, savedAddresses, (progress) => {
      if (!controller.signal.aborted && !event.sender.isDestroyed()) event.sender.send('servers:progress', { id: request.id, ...progress });
    }, log, gameExecutable(settings), controller.signal);
  } catch (error) {
    log('ERROR', 'Server search failed.', error);
    throw error;
  } finally {
    event.sender.removeListener('destroyed', cancelOnClose);
    if (serverSearches.get(senderId)?.id === request.id) serverSearches.delete(senderId);
  }
});

ipcMain.handle('servers:toggle-favorite', (_event, address: string) => {
  const parsed = parseServerAddress(address);
  const settings = readSettings();
  const favorites = new Set(settings.favoriteServers ?? []);
  if (favorites.has(parsed.address)) favorites.delete(parsed.address);
  else favorites.add(parsed.address);
  writeSettings({ ...settings, favoriteServers: [...favorites] });
  return [...favorites];
});

ipcMain.handle('servers:add-manual', async (_event, address: string) => {
  const candidates = queryAddressCandidates(address);
  let servers: DayZServer[] = [];
  let savedAddress = candidates[0];
  for (const candidate of candidates) {
    log('INFO', 'Trying manual server query address.', { address: candidate });
    servers = await scanServers('favorites', [candidate], () => undefined, log);
    if (servers.length) {
      savedAddress = candidate;
      break;
    }
  }

  const settings = readSettings();
  const favorites = new Set(settings.favoriteServers ?? []);
  if (savedAddress !== candidates[0]) favorites.delete(candidates[0]);
  favorites.add(savedAddress);
  writeSettings({ ...settings, favoriteServers: [...favorites] });
  log('INFO', 'Manually added server address.', { input: candidates[0], queryAddress: savedAddress, responding: servers.length > 0 });
  return servers;
});

ipcMain.handle('servers:mods', async (_event, address: string) => {
  log('INFO', 'Checking server-required mods.', { address });
  try {
    const parsed = parseServerAddress(address);
    const required = resolveServerModIds(await queryServerMods(parsed.address, true), readSettings().serverModIds?.[parsed.address]);
    const matched = matchServerMods(required, scanMods().mods);
    log('INFO', 'Server mods matched.', { address, required: matched.length, missing: matched.filter((mod) => !mod.installed).length });
    return matched;
  } catch (error) {
    log('WARN', 'Server mod query failed.', { address, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

ipcMain.handle('servers:set-mod-id', async (_event, request: { address: string; name: string; id: string }) => {
  const { address } = parseServerAddress(request.address);
  if (!/^[1-9]\d{0,19}$/.test(request.id)) throw new Error('Enter a numeric Workshop item ID.');
  const required = await queryServerMods(address, true);
  if (!required.some((mod) => mod.id === '0' && mod.name === request.name)) throw new Error('This mod no longer needs a Workshop ID. Recheck the server.');
  const settings = readSettings();
  const serverModIds = { ...settings.serverModIds, [address]: { ...settings.serverModIds?.[address], [request.name]: request.id } };
  writeSettings({ ...settings, serverModIds });
  log('INFO', 'Saved server Workshop ID mapping.', { address, name: request.name, id: request.id });
});

ipcMain.handle('servers:join', async (_event, request: JoinRequest) => {
  const host = request.host.includes(':') ? `[${request.host}]` : request.host;
  const parsed = parseServerAddress(`${host}:${request.queryPort}`);
  if (!Number.isInteger(request.gamePort) || request.gamePort < 1 || request.gamePort > 65535) {
    throw new Error('The server has an invalid game port. Refresh its details and try again.');
  }
  const password = request.password?.trim() ?? '';
  if (password.length > 64 || /[\0\r\n]/.test(password)) throw new Error('The server password is invalid.');
  const executable = gameExecutable(readSettings());
  if (!executable || !existsSync(executable)) throw new Error('DayZ was not found. Set the game path in Settings.');
  const installedMods = new Map(scanMods().mods.map((mod) => [mod.id, mod.path]));
  const required = resolveServerModIds(await queryServerMods(parsed.address, true), readSettings().serverModIds?.[parsed.address]);
  if (required.some((mod) => mod.id === '0')) throw new Error('Assign Workshop IDs to the unresolved mods before joining.');
  const missing = required.filter((mod) => !installedMods.has(mod.id));
  if (missing.length) throw new Error(`Install the required Workshop mods before joining: ${missing.map((mod) => mod.name).join(', ')}`);
  const modPaths = required.map((mod) => installedMods.get(mod.id)!);
  const args = [`-connect=${parsed.host}`, `-port=${request.gamePort}`];
  if (password) args.push(`-password=${password}`);
  if (modPaths.length) args.push(`-mod=${modPaths.join(';')}`);
  log('INFO', 'Joining DayZ server.', { address: parsed.address, gamePort: request.gamePort, modCount: modPaths.length, passwordProtected: Boolean(password) });
  const child = spawn(executable, args, { cwd: path.dirname(executable), detached: true, stdio: 'ignore' });
  child.once('error', (error) => log('ERROR', 'Unable to join DayZ server.', error));
  child.unref();

  const settings = readSettings();
  const recent = [parsed.address, ...(settings.recentServers ?? []).filter((item) => item !== parsed.address)].slice(0, 50);
  writeSettings({ ...settings, recentServers: recent });
  return true;
});

app.whenReady().then(() => {
  const logFile = initializeLogger(app.getPath('userData'));
  log('INFO', 'DZ Launchpad starting.', { version: app.getVersion(), platform: process.platform, logFile });
  process.on('uncaughtException', (error) => log('ERROR', 'Uncaught main-process exception.', error));
  process.on('unhandledRejection', (reason) => log('ERROR', 'Unhandled main-process rejection.', reason));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', closeSteamDiscovery);

app.on('render-process-gone', (_event, _webContents, details) => log('ERROR', 'Renderer process exited.', details));
