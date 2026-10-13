import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const historyPath = path.join(root, 'BUILD_HISTORY.json');
let history = [];
try { history = JSON.parse(readFileSync(historyPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!Array.isArray(history) || history.some((entry) => !Number.isSafeInteger(entry.buildNumber) || entry.buildNumber < 1)) throw new Error('Invalid BUILD_HISTORY.json; refusing to overwrite build history.');
const buildNumber = Math.max(0, ...history.map((entry) => entry.buildNumber)) + 1;
let commit = 'unknown', dirty = true;
try {
  commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--', '.', ':(exclude)BUILD_HISTORY.json'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim());
} catch { /* Source archives may have no Git metadata. */ }
const info = { version: manifest.version, channel: manifest.version.includes('-beta.') ? 'beta' : manifest.version.includes('-') ? 'prerelease' : 'stable', buildNumber, builtAt: new Date().toISOString(), commit, dirty };
mkdirSync(path.join(root, 'dist-electron'), { recursive: true });
writeFileSync(path.join(root, 'dist-electron', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
writeFileSync(historyPath, JSON.stringify([...history, info], null, 2) + '\n');
console.log(`${info.version} | ${info.channel} | build ${buildNumber} | ${commit}${dirty ? ' (modified source)' : ''}`);
