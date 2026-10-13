export interface WorkshopProgress {
  address: string;
  name: string;
  complete: number;
  total: number;
  stage: 'subscribing' | 'downloading' | 'ready';
}

export interface WorkshopClient {
  subscribe(id: string): Promise<void>;
  state(id: string): number;
  folder(id: string): string | undefined;
  pump(): void;
  download?(id: string): void;
  downloadResult?(id: string): number | undefined;
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
  for (const mod of unique) {
    checkCancelled();
    if (!(client.state(mod.id) & 1)) {
      progress({ name: mod.name, complete: 0, total: unique.length, stage: 'subscribing' });
      await client.subscribe(mod.id);
    }
  }
  const requested = new Set<string>();
  for (const mod of unique) {
    checkCancelled();
    if (!workshopReady(client.state(mod.id)) && client.download) {
      client.download(mod.id);
      requested.add(mod.id);
    }
  }
  const folders = new Map<string, string>();
  while (folders.size < unique.length) {
    checkCancelled();
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Steam downloads. Check Steam Downloads, then retry.');
    client.pump();
    for (const mod of unique) {
      if (folders.has(mod.id)) continue;
      if (requested.has(mod.id)) {
        const result = client.downloadResult?.(mod.id);
        if (result === undefined) continue;
        if (result !== 1) throw new Error(`Steam download failed for ${mod.name} (result ${result}). Check Steam Downloads and available disk space.`);
      }
      if (workshopReady(client.state(mod.id))) {
        const folder = client.folder(mod.id);
        if (folder) folders.set(mod.id, folder);
      }
    }
    const waiting = unique.find((mod) => !folders.has(mod.id));
    progress({ name: waiting?.name ?? '', complete: folders.size, total: unique.length, stage: waiting ? 'downloading' : 'ready' });
    if (waiting) await wait();
  }
  checkCancelled();
  return folders;
}
