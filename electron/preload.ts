import { contextBridge, ipcRenderer } from 'electron';

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

export type ServerScope = 'internet' | 'favorites' | 'history';

export interface ServerScanProgress {
  id: string;
  total: number;
  complete: number;
  servers: DayZServer[];
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
  onServerProgress: (listener: (progress: ServerScanProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ServerScanProgress) => listener(progress);
    ipcRenderer.on('servers:progress', handler);
    return () => ipcRenderer.removeListener('servers:progress', handler);
  },
  joinServer: (server: DayZServer, modIds: string[], password?: string): Promise<boolean> => ipcRenderer.invoke('servers:join', {
    host: server.host,
    queryPort: server.queryPort,
    gamePort: server.gamePort,
    password,
    modIds,
  }),
});
