import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * server/index.js reads config at import time, so the todo file has to be
 * pointed at a temp path before the module is loaded. node --test gives each
 * test file its own process, so this does not leak into other suites.
 */
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl-centre-http-'));
const file = path.join(dir, 'todos.md');
process.env.CTRL_CENTRE_DIR = dir;

/**
 * Guard, not decoration: if the env var above ever stops being what config
 * reads, this suite would silently exercise the real ~/.ctrl-centre/todos.md
 * and mutate the user's actual todos. Fail loudly instead, before the store is
 * ever constructed.
 */
const { config } = await import('../server/config.js');
assert.equal(config.todoFile, file, 'suite must be pointed at its temp directory');

const { createServer } = await import('../server/index.js');

/** @type {import('node:http').Server} */
let server;
/** @type {string} */
let origin;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'expected a bound TCP address');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * @param {string} pathname
 * @param {{ method?: string, body?: unknown, raw?: string }} [options]
 */
async function call(pathname, { method = 'GET', body, raw } = {}) {
  const response = await fetch(origin + pathname, {
    method,
    headers: { 'content-type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text, response };
}

/** @param {string} contents */
function seed(contents) {
  return fs.writeFile(file, contents, 'utf8');
}

describe('todo API', () => {
  test('GET /api/todos returns the tasks and the file location', async () => {
    await seed('- [ ] one !high\n');
    const { status, json } = await call('/api/todos');

    assert.equal(status, 200);
    assert.equal(json.tasks.length, 1);
    assert.equal(json.tasks[0].text, 'one');
    assert.equal(json.tasks[0].priority, 'high');
    assert.ok(json.file, 'should report where it saved');
  });

  test('POST /api/todos creates a task and returns 201 with the new list', async () => {
    await seed('');
    const { status, json } = await call('/api/todos', {
      method: 'POST',
      body: { text: 'added', priority: 'low', due: '2026-08-01' },
    });

    assert.equal(status, 201);
    assert.deepEqual(json.tasks.map((/** @type {{text:string}} */ t) => t.text), ['added']);
    assert.match(await fs.readFile(file, 'utf8'), /- \[ \] added !low @2026-08-01/);
  });

  test('POST with empty text returns 400 and the reason', async () => {
    const { status, json } = await call('/api/todos', { method: 'POST', body: { text: '  ' } });

    assert.equal(status, 400);
    assert.match(json.error, /required/i);
  });

  test('toggle and delete round-trip through the file', async () => {
    await seed('- [ ] a\n- [ ] b\n');

    const toggled = await call('/api/todos/toggle', {
      method: 'POST',
      body: { ordinal: 0, expectedText: 'a' },
    });
    assert.equal(toggled.status, 200);
    assert.equal(toggled.json.tasks[0].done, true);

    const deleted = await call('/api/todos/delete', {
      method: 'POST',
      body: { ordinal: 1, expectedText: 'b' },
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.json.tasks.map((/** @type {{text:string}} */ t) => t.text), ['a']);
  });

  test('a stale expectedText returns 409 and leaves the file alone', async () => {
    await seed('- [ ] a\n');
    const { status, json } = await call('/api/todos/toggle', {
      method: 'POST',
      body: { ordinal: 0, expectedText: 'stale text' },
    });

    assert.equal(status, 409);
    assert.match(json.error, /changed/i);
    assert.match(await fs.readFile(file, 'utf8'), /- \[ \] a/);
  });

  test('clear-completed removes done tasks', async () => {
    await seed('- [x] done\n- [ ] open\n');
    const { status, json } = await call('/api/todos/clear-completed', { method: 'POST' });

    assert.equal(status, 200);
    assert.deepEqual(json.tasks.map((/** @type {{text:string}} */ t) => t.text), ['open']);
  });

  test('malformed JSON returns 400 rather than 500', async () => {
    const { status, json } = await call('/api/todos', { method: 'POST', raw: '{not json' });

    assert.equal(status, 400);
    assert.match(json.error, /json/i);
  });

  test('an unknown endpoint returns 404', async () => {
    const { status } = await call('/api/nope', { method: 'POST', body: {} });
    assert.equal(status, 404);
  });

  test('GET on a mutation endpoint returns 405', async () => {
    const { status } = await call('/api/todos/toggle');
    assert.equal(status, 405);
  });
});

describe('static files', () => {
  test('serves the app shell at /', async () => {
    const { status, text, response } = await call('/');

    assert.equal(status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(text, /Ctrl Centre/);
  });

  test('serves js and css with correct content types', async () => {
    const js = await call('/app.js');
    assert.equal(js.status, 200);
    assert.match(js.response.headers.get('content-type') ?? '', /javascript/);

    const css = await call('/styles/base.css');
    assert.equal(css.status, 200);
    assert.match(css.response.headers.get('content-type') ?? '', /text\/css/);
  });

  test('a missing file returns 404', async () => {
    const { status } = await call('/does-not-exist.js');
    assert.equal(status, 404);
  });

  test('rejects percent-encoded path traversal', async () => {
    // %2e%2e%2f survives URL parsing, so the guard has to run after decoding.
    const { status } = await call('/%2e%2e%2fserver%2fconfig.js');
    assert.equal(status, 403);
  });

  test('rejects traversal aimed at a file that really exists', async () => {
    const { status, text } = await call('/%2e%2e%2fpackage.json');

    assert.equal(status, 403);
    assert.doesNotMatch(text, /devDependencies/, 'must not leak file contents');
  });

  test('POST to a static path returns 405', async () => {
    const { status } = await call('/app.js', { method: 'POST', body: {} });
    assert.equal(status, 405);
  });
});
