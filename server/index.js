import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, displayPath } from './config.js';
import { createTodoStore } from './todos.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY_BYTES = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const todos = createTodoStore(config.todoFile);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
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
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    throw err;
  }
}

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

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

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
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    sendJson(res, status, { error: err.message || 'Internal server error.' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`ctrl-centre  →  http://${config.host}:${config.port}`);
  console.log(`todo file    →  ${config.todoFile}`);
});
