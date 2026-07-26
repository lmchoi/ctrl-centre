import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, displayPath } from './config.js';
import { createTodoStore } from './todos.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY_BYTES = 64 * 1024;

/** @typedef {import('../types.d.ts').HttpError} HttpError */

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const todos = createTodoStore(config.todoFile);

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * Read and parse a JSON request body.
 *
 * Returns `any` deliberately: this is untrusted input, and every field is
 * validated in the store rather than trusted from the wire.
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} pathname
 */
async function serveStatic(req, res, pathname) {
  let relative;
  try {
    relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  // Resolve, then confirm the result is still inside public/ — blocks ../ traversal,
  // including the percent-encoded form that survives URL parsing.
  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const contents = await fs.readFile(resolved);
    res.writeHead(200, {
      'content-type': MIME[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(contents);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === 'ENOENT' || code === 'EISDIR') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    throw err;
  }
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} pathname
 */
async function handleApi(req, res, pathname) {
  if (pathname === '/api/todos' && req.method === 'GET') {
    return sendJson(res, 200, {
      file: displayPath(config.todoFile),
      tasks: await todos.list(),
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  const body = await readJsonBody(req);

  switch (pathname) {
    case '/api/todos':
      return sendJson(res, 201, { tasks: await todos.add(body) });
    case '/api/todos/toggle':
      return sendJson(res, 200, { tasks: await todos.toggle(body) });
    case '/api/todos/delete':
      return sendJson(res, 200, { tasks: await todos.remove(body) });
    case '/api/todos/clear-completed':
      return sendJson(res, 200, { tasks: await todos.clearCompleted() });
    default:
      return sendJson(res, 404, { error: 'Unknown endpoint.' });
  }
}

/** Build the server without binding a port, so tests can drive it. */
export function createServer() {
  return http.createServer(async (req, res) => {
    // req.url is optional in the type and absent on malformed requests.
    const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end('Method not allowed');
        return;
      }
      await serveStatic(req, res, pathname);
    } catch (err) {
      if (res.headersSent) return;
      const { status = 500, message } = /** @type {HttpError} */ (err);
      if (status === 500) console.error(err);
      sendJson(res, status, { error: message || 'Internal server error.' });
    }
  });
}

if (import.meta.main) {
  createServer().listen(config.port, config.host, () => {
    console.log(`ctrl-centre  →  http://${config.host}:${config.port}`);
    console.log(`data dir     →  ${config.dir}`);
  });
}
