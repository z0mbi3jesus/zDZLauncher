export interface WorkshopItemProgress {
  id: string;
  name: string;
  status: 'queued' | 'subscribing' | 'downloading' | 'installing' | 'verifying' | 'ready' | 'failed' | 'cancelled';
  percent: number | null;
  downloadedBytes?: string;
  totalBytes?: string;
  idleSeconds: number;
  error?: string;
}

export interface WorkshopProgress {
  address: string;
  name: string;
  complete: number;
  total: number;
  stage: 'subscribing' | 'downloading' | 'ready';
  items: WorkshopItemProgress[];
}

export interface WorkshopClient {
  subscribe(id: string): Promise<void>;
  state(id: string): number;
  folder(id: string): string | undefined;
  pump(): void;
  download?(id: string): void;
  downloadResult?(id: string): number | undefined;
  downloadInfo?(id: string): { downloaded: bigint; total: bigint } | undefined;
}

export function workshopReady(state: number): boolean {
  return Boolean(state & 4) && !(state & (8 | 16 | 32));
}

export async function installWorkshopMods(
  mods: { id: string; name: string }[], client: WorkshopClient,
  progress: (value: Omit<WorkshopProgress, 'address'>) => void,
  signal?: AbortSignal,
  options: { timeoutMs?: number; wait?: () => Promise<void> } = {},
): Promise<Map<string, string>> {
  const unique = [...new Map(mods.map((mod) => [mod.id, mod])).values()];
  if (unique.some((mod) => !/^[1-9]\d{0,19}$/.test(mod.id) || BigInt(mod.id) > 18446744073709551615n)) throw new Error('Resolve missing Workshop IDs before downloading.');
  const checkCancelled = () => { if (signal?.aborted) throw new Error('Mod preparation cancelled. Steam may continue queued downloads.'); };
  const deadline = Date.now() + (options.timeoutMs ?? 60 * 60 * 1000);
  const wait = options.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 500)));
  const items = new Map<string, WorkshopItemProgress>(unique.map((mod) => [mod.id, { ...mod, status: 'queued', percent: null, idleSeconds: 0 }]));
  const lastChange = new Map(unique.map((mod) => [mod.id, Date.now()]));
  const folders = new Map<string, string>();
  let activeId = '';
  const publish = (stage: WorkshopProgress['stage'], name = '') => progress({ name, complete: folders.size, total: unique.length, stage, items: [...items.values()].map((item) => ({ ...item })) });
  publish('subscribing');
  try {
  for (const mod of unique) {
    activeId = mod.id;
    checkCancelled();
    if (workshopReady(client.state(mod.id))) {
      const folder = client.folder(mod.id);
      if (folder) {
        folders.set(mod.id, folder);
        const item = items.get(mod.id)!;
        item.status = 'ready'; item.percent = 100;
      }
    }
    if (!(client.state(mod.id) & 1)) {
      items.get(mod.id)!.status = 'subscribing';
      publish('subscribing', mod.name);
      await client.subscribe(mod.id);
      items.get(mod.id)!.status = 'queued';
    }
  }
  const requested = new Set<string>();
  for (const mod of unique) {
    activeId = mod.id;
    checkCancelled();
    if (!workshopReady(client.state(mod.id)) && client.download) {
      client.download(mod.id);
      requested.add(mod.id);
    }
  }
  while (folders.size < unique.length) {
    activeId = unique.find((mod) => !folders.has(mod.id))?.id ?? '';
    checkCancelled();
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Steam downloads. Check Steam Downloads, then retry.');
    client.pump();
    for (const mod of unique) {
      activeId = mod.id;
      if (folders.has(mod.id)) continue;
      const item = items.get(mod.id)!;
      const state = client.state(mod.id);
      const info = client.downloadInfo?.(mod.id);
      const oldProgress = `${item.status}:${item.downloadedBytes}:${item.totalBytes}`;
      item.status = state & 16 ? 'downloading' : state & 32 ? 'queued' : workshopReady(state) ? 'verifying' : 'queued';
      item.downloadedBytes = info?.downloaded.toString();
      item.totalBytes = info?.total.toString();
      item.percent = info && info.total > 0n ? Math.min(100, Math.max(0, Number(info.downloaded * 1000n / info.total) / 10)) : null;
      if (info && info.total > 0n && info.downloaded >= info.total) item.status = 'installing';
      if (`${item.status}:${item.downloadedBytes}:${item.totalBytes}` !== oldProgress) lastChange.set(mod.id, Date.now());
      item.idleSeconds = Math.floor((Date.now() - lastChange.get(mod.id)!) / 1000);
      if (requested.has(mod.id)) {
        const result = client.downloadResult?.(mod.id);
        if (result === undefined) continue;
        if (result !== 1) throw new Error(`Steam download failed for ${mod.name} (result ${result}). Check Steam Downloads and available disk space.`);
      }
      if (workshopReady(state)) {
        const folder = client.folder(mod.id);
        if (folder) {
          folders.set(mod.id, folder);
          item.status = 'ready'; item.percent = 100; item.idleSeconds = 0;
        }
      }
    }
    const waiting = unique.find((mod) => !folders.has(mod.id));
    publish(waiting ? 'downloading' : 'ready', waiting?.name);
    if (waiting) await wait();
  }
  checkCancelled();
  publish('ready');
  return folders;
  } catch (error) {
    for (const item of items.values()) {
      if (item.status === 'ready') continue;
      item.status = signal?.aborted ? 'cancelled' : item.id === activeId ? 'failed' : 'cancelled';
      item.error = signal?.aborted ? 'Stopped waiting; Steam may continue downloading.' : item.id === activeId ? error instanceof Error ? error.message : String(error) : 'Preparation stopped.';
    }
    publish('downloading');
    throw error;
  }
}
