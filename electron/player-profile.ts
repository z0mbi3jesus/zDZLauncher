import { readdirSync } from 'node:fs';
import path from 'node:path';

export interface DayZPlayerProfile { name: string; file: string; }
export function detectPlayerProfiles(directory: string): DayZPlayerProfile[] {
  try {
    return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && /_settings\.DayZProfile$/i.test(entry.name))
      .map((entry) => ({ name: entry.name.replace(/_settings\.DayZProfile$/i, ''), file: path.join(directory, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}
export function selectedPlayerProfile(profiles: DayZPlayerProfile[], selected?: string): DayZPlayerProfile | undefined {
  if (selected) return profiles.find((profile) => profile.name === selected);
  return profiles.length === 1 ? profiles[0] : undefined;
}
export function playerLaunchArgs(profiles: DayZPlayerProfile[], selected?: string): string[] {
  const profile = selectedPlayerProfile(profiles, selected);
  if ((selected || profiles.length > 1) && !profile) throw new Error('Choose an existing DayZ player profile in Settings before launching.');
  if (!profile) return []; // First launch: let DayZ create its normal default profile.
  if (/[\0\r\n";]/.test(profile.name)) throw new Error('The DayZ player profile name cannot be passed safely to the game.');
  return [`-name=${profile.name}`];
}

export function dayZLaunchCommand(executable: string, args: string[]) {
  return { executable: path.join(path.dirname(executable), 'DayZ_BE.exe'), args: ['-exe', path.basename(executable), ...args] };
}
