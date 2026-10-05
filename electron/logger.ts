import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
let logFile = '';

export function initializeLogger(directory: string): string {
  const logDirectory = path.join(directory, 'logs');
  mkdirSync(logDirectory, { recursive: true });
  logFile = path.join(logDirectory, 'latest.log');
  return logFile;
}

export function getLogFile(): string {
  return logFile;
}

export function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  let detailText = '';
  if (details instanceof Error) detailText = `${details.name}: ${details.message}`;
  else if (details !== undefined) {
    try {
      detailText = JSON.stringify(details) ?? String(details);
    } catch {
      detailText = String(details);
    }
  }
  const suffix = detailText ? ` ${detailText}` : '';
  const line = `${timestamp} [${level}] ${message}${suffix}\n`;
  const output = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.info;
  output(line.trimEnd());

  if (!logFile) return;
  try {
    if (existsSync(logFile) && statSync(logFile).size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
      const previousLog = path.join(path.dirname(logFile), 'previous.log');
      if (existsSync(previousLog)) unlinkSync(previousLog);
      renameSync(logFile, previousLog);
    }
    appendFileSync(logFile, line, 'utf8');
  } catch (error) {
    console.error('Unable to write application log:', error);
  }
}