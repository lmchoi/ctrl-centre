import os from 'node:os';
import path from 'node:path';

/**
 * The todo markdown file deliberately lives OUTSIDE this repo so personal todos
 * are never committed. Override with CTRL_CENTRE_TODO_FILE.
 */
const DEFAULT_TODO_FILE = path.join(os.homedir(), '.ctrl-centre', 'todos.md');

function resolveTodoFile() {
  const raw = process.env.CTRL_CENTRE_TODO_FILE;
  if (!raw || !raw.trim()) return DEFAULT_TODO_FILE;
  const expanded = raw.startsWith('~')
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.resolve(expanded);
}

export const config = {
  todoFile: resolveTodoFile(),
  port: Number(process.env.PORT) || 4242,
  host: process.env.HOST || '127.0.0.1',
};

/** Path shown in the UI footer, with $HOME collapsed to `~`. */
export function displayPath(filePath) {
  const home = os.homedir();
  return filePath.startsWith(home + path.sep)
    ? '~' + filePath.slice(home.length)
    : filePath;
}
