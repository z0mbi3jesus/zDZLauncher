import type { AppStatus, DayZServer, ServerScanProgress, ServerScope, WorkshopMod, ServerModMatch } from '../electron/preload';

declare global {
  interface Window {
    dayz: {
      status: () => Promise<AppStatus>;
      chooseGame: () => Promise<string>;
      launch: (mods: WorkshopMod[]) => Promise<boolean>;
      openWorkshop: (url?: string) => Promise<void>;
      openFolder: (folder: string) => Promise<void>;
      openLog: () => Promise<void>;
      logPath: () => Promise<string>;
      serverFavorites: () => Promise<string[]>;
      toggleServerFavorite: (address: string) => Promise<string[]>;
      addServer: (address: string) => Promise<DayZServer[]>;
      searchServers: (id: string, scope: ServerScope) => Promise<DayZServer[]>;
      cancelServerSearch: (id: string) => Promise<void>;
      onServerProgress: (listener: (progress: ServerScanProgress) => void) => () => void;
      setServerModId: (address: string, name: string, id: string) => Promise<void>;
      serverMods: (address: string) => Promise<ServerModMatch[]>;
      joinServer: (server: DayZServer, modIds: string[], password?: string) => Promise<boolean>;
    };
  }
}

export {};
