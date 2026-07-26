import os from 'node:os';
import path from 'node:path';

/**
 * Personal data deliberately lives OUTSIDE this repo so it is never committed:
 * one directory, one markdown file per panel. Override with CTRL_CENTRE_DIR.
 * See ADR 0007 — CTRL_CENTRE_TODO_FILE is no longer read.
 */
const DEFAULT_DIR = path.join(os.homedir(), '.ctrl-centre');

/**
 * Resolve the data directory from a raw env value.
 *
 * Exported so it can be tested directly: `config` below is evaluated once at
 * import time, so testing several values through the env would otherwise need
 * cache-busting dynamic imports.
 *
 * @param {string | undefined} raw
 * @returns {string} absolute path
 */
export function resolveDataDir(raw) {
  if (!raw || !raw.trim()) return DEFAULT_DIR;
  const trimmed = raw.trim();
  const expanded = trimmed.startsWith('~')
    ? path.join(os.homedir(), trimmed.slice(1))
    : trimmed;
  return path.resolve(expanded);
}

const dir = resolveDataDir(process.env.CTRL_CENTRE_DIR);

export const config = {
  dir,
  todoFile: path.join(dir, 'todos.md'),
  port: Number(process.env.PORT) || 4242,
  host: process.env.HOST || '127.0.0.1',
};

/**
 * Path shown in the UI footer, with $HOME collapsed to `~`.
 * @param {string} filePath
 * @returns {string}
 */
export function displayPath(filePath) {
  const home = os.homedir();
  return filePath.startsWith(home + path.sep)
    ? '~' + filePath.slice(home.length)
    : filePath;
}
