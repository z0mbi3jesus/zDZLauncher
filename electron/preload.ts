import { contextBridge, ipcRenderer } from 'electron';
import type { DayZServer, ServerScanProgress as ScanProgress } from './server-browser.js';
export type { DayZServer } from './server-browser.js';

export interface WorkshopMod {
  id: string;
  name: string;
  path: string;
}

export interface AppStatus {
  gamePath: string;
  gameFound: boolean;
  workshopPath: string;
  mods: WorkshopMod[];
}

export interface ServerModMatch { id: string; name: string; installed: boolean; }

export type ServerScope = 'internet' | 'favorites' | 'history';

export interface ServerScanProgress extends ScanProgress {
  id: string;
}

contextBridge.exposeInMainWorld('dayz', {
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
  serverMods: (address: string): Promise<ServerModMatch[]> => ipcRenderer.invoke('servers:mods', address),
  joinServer: (server: DayZServer, modIds: string[], password?: string): Promise<boolean> => ipcRenderer.invoke('servers:join', {
    host: server.host,
    queryPort: server.queryPort,
    gamePort: server.gamePort,
    password,
    modIds,
  }),
});
