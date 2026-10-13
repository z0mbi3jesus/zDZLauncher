import type { WorkshopProgress } from './workshop.js';
export type { WorkshopProgress } from './workshop.js';
import { contextBridge, ipcRenderer } from 'electron';
import type { DayZServer, ServerScanProgress as ScanProgress } from './server-browser.js';
export type { DayZServer } from './server-browser.js';

export interface PlayerStatus {
  player: { id: string; name: string; avatar: string; ownsDayZ: boolean } | null;
  profiles: { name: string; file: string }[];
  profile?: { name: string; file: string } | null;
  directory: string;
  error: string;
}

export interface WorkshopMod {
  id: string;
  name: string;
  path: string;
}

export interface AppStatus {
  release?: { version: string; channel: string; buildNumber: number; builtAt: string; commit: string; dirty: boolean };
  gamePath: string;
  gameFound: boolean;
  workshopPath: string;
  mods: WorkshopMod[];
}

export interface ServerModMatch { id: string; name: string; installed: boolean; source?: 'dzsa'; }

export type ServerScope = 'internet' | 'favorites' | 'history';

export interface ServerScanProgress extends ScanProgress {
  id: string;
}

contextBridge.exposeInMainWorld('dayz', {
  playerStatus: (): Promise<PlayerStatus> => ipcRenderer.invoke('player:status'),
  selectPlayerProfile: (name: string): Promise<void> => ipcRenderer.invoke('player:select', name),
  status: (): Promise<AppStatus> => ipcRenderer.invoke('app:status'),
  chooseGame: (): Promise<string> => ipcRenderer.invoke('app:choose-game'),
  launch: (mods: WorkshopMod[]): Promise<boolean> => ipcRenderer.invoke('app:launch', { modIds: mods.map((mod) => mod.id) }),
  openWorkshop: (url?: string): Promise<void> => ipcRenderer.invoke('app:open-workshop', url),
  openFolder: (folder: string): Promise<void> => ipcRenderer.invoke('app:open-folder', folder),
  openLog: (): Promise<void> => ipcRenderer.invoke('app:open-log'),
  logPath: (): Promise<string> => ipcRenderer.invoke('app:log-path'),
  serverFavorites: (): Promise<string[]> => ipcRenderer.invoke('servers:favorites'),
  toggleServerFavorite: (address: string): Promise<string[]> => ipcRenderer.invoke('servers:toggle-favorite', address),
  addServer: (address: string): Promise<DayZServer[]> => ipcRenderer.invoke('servers:add-manual', address),
  searchServers: (id: string, scope: ServerScope): Promise<DayZServer[]> => ipcRenderer.invoke('servers:search', { id, scope }),
  cancelServerSearch: (id: string): Promise<void> => ipcRenderer.invoke('servers:cancel', id),
  onServerProgress: (listener: (progress: ServerScanProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ServerScanProgress) => listener(progress);
    ipcRenderer.on('servers:progress', handler);
    return () => ipcRenderer.removeListener('servers:progress', handler);
  },
  getServerMods: (address: string): Promise<boolean> => ipcRenderer.invoke('servers:get-mods', address),
  cancelModPreparation: (): Promise<void> => ipcRenderer.invoke('workshop:cancel'),
  onWorkshopProgress: (listener: (progress: WorkshopProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: WorkshopProgress) => listener(progress);
    ipcRenderer.on('workshop:progress', handler);
    return () => ipcRenderer.removeListener('workshop:progress', handler);
  },
  setServerModId: (address: string, name: string, id: string): Promise<void> => ipcRenderer.invoke('servers:set-mod-id', { address, name, id }),
  serverMods: (address: string): Promise<ServerModMatch[]> => ipcRenderer.invoke('servers:mods', address),
  joinServer: (server: DayZServer, modIds: string[], password?: string): Promise<boolean> => ipcRenderer.invoke('servers:join', {
    host: server.host,
    queryPort: server.queryPort,
    gamePort: server.gamePort,
    password,
    modIds,
  }),
});
