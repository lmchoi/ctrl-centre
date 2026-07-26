import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createTodoStore } from '../server/todos.js';

/** @type {string} */
let dir;
/** @type {string} */
let file;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl-centre-'));
  file = path.join(dir, 'todos.md');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** @param {string} contents */
async function seed(contents) {
  await fs.writeFile(file, contents, 'utf8');
  return createTodoStore(file);
}

/** @returns {Promise<string>} */
function read() {
  return fs.readFile(file, 'utf8');
}

/**
 * @param {() => Promise<unknown>} fn
 * @param {number} status
 */
async function assertStatus(fn, status) {
  await assert.rejects(fn, (err) => {
    assert.equal(/** @type {{ status?: number }} */ (err).status, status);
    return true;
  });
}

describe('parsing', () => {
  test('reads open and done items', async () => {
    const store = await seed('- [ ] one\n- [x] two\n');
    const tasks = await store.list();

    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks.map((t) => t.text), ['one', 'two']);
    assert.deepEqual(tasks.map((t) => t.done), [false, true]);
  });

  test('uppercase [X] counts as done', async () => {
    const store = await seed('- [X] shouty\n');
    assert.equal((await store.list())[0]?.done, true);
  });

  test('priority defaults to medium when unmarked', async () => {
    const store = await seed('- [ ] plain\n');
    assert.equal((await store.list())[0]?.priority, 'medium');
  });

  test('reads priority and due date, in either order', async () => {
    const store = await seed('- [ ] a !high @2026-08-01\n- [ ] b @2026-08-02 !low\n');
    const tasks = await store.list();

    assert.deepEqual(tasks.map((t) => t.priority), ['high', 'low']);
    assert.deepEqual(tasks.map((t) => t.due), ['2026-08-01', '2026-08-02']);
    // Tokens must not survive in the visible text.
    assert.deepEqual(tasks.map((t) => t.text), ['a', 'b']);
  });

  test('accepts -, * and + bullets', async () => {
    const store = await seed('- [ ] dash\n* [ ] star\n+ [ ] plus\n');
    assert.equal((await store.list()).length, 3);
  });

  test('indented items are ordinary tasks, not subtasks', async () => {
    const store = await seed('- [ ] parent\n  - [ ] child\n');
    const tasks = await store.list();

    assert.deepEqual(tasks.map((t) => t.text), ['parent', 'child']);
    assert.deepEqual(tasks.map((t) => t.ordinal), [0, 1]);
  });

  test('a malformed checkbox is not a task', async () => {
    const store = await seed('- [] no space\n- [ ]nospace after\n- not a checkbox\n');
    // "- [ ]nospace after" is still valid: the regex allows zero spaces after ].
    assert.deepEqual((await store.list()).map((t) => t.text), ['nospace after']);
  });
});

describe('documentation is not data', () => {
  test('ignores checklist lines inside a single-line HTML comment', async () => {
    const store = await seed('<!-- - [ ] example -->\n- [ ] real\n');
    assert.deepEqual((await store.list()).map((t) => t.text), ['real']);
  });

  test('ignores checklist lines inside a multi-line HTML comment', async () => {
    const store = await seed('<!--\n- [ ] example\n- [x] another\n-->\n- [ ] real\n');
    assert.deepEqual((await store.list()).map((t) => t.text), ['real']);
  });

  test('ignores checklist lines inside backtick and tilde fences', async () => {
    const store = await seed(
      '```markdown\n- [ ] fenced\n```\n~~~\n- [ ] tilde\n~~~\n- [ ] real\n',
    );
    assert.deepEqual((await store.list()).map((t) => t.text), ['real']);
  });

  test('a freshly created file documents its format without listing tasks', async () => {
    const store = createTodoStore(file);
    const tasks = await store.list();

    const contents = await read();
    assert.match(contents, /- \[ \]/, 'template should show an example task');
    assert.equal(tasks.length, 0, 'but the example must not parse as a real task');
  });

  test('ordinals skip documentation, so mutations hit the right line', async () => {
    const store = await seed('<!--\n- [ ] decoy\n-->\n- [ ] first\n- [ ] second\n');
    await store.toggle({ ordinal: 1, expectedText: 'second' });

    const contents = await read();
    assert.match(contents, /- \[ \] decoy/, 'comment must be untouched');
    assert.match(contents, /- \[ \] first/);
    assert.match(contents, /- \[x\] second/);
  });
});

describe('preserving the rest of the file', () => {
  const ORIGINAL = [
    '# My todos',
    '',
    'Some prose I wrote by hand.',
    '',
    '## Work',
    '- [ ] ship it !high @2026-07-30',
    '  - [ ] nested',
    '',
    '## Home',
    '* [ ] star bullet',
    '',
  ].join('\n');

  test('toggling rewrites only the one line', async () => {
    const store = await seed(ORIGINAL);
    await store.toggle({ ordinal: 0, expectedText: 'ship it' });

    const after = await read();
    const before = ORIGINAL.split('\n');
    const changed = after.split('\n').filter((line, i) => line !== before[i]);

    assert.deepEqual(changed, ['- [x] ship it !high @2026-07-30']);
  });

  test('bullet character and indentation survive a toggle', async () => {
    const store = await seed(ORIGINAL);
    await store.toggle({ ordinal: 2, expectedText: 'star bullet' });
    assert.match(await read(), /^\* \[x\] star bullet$/m);

    await store.toggle({ ordinal: 1, expectedText: 'nested' });
    assert.match(await read(), /^ {2}- \[x\] nested$/m);
  });

  test('headings and prose survive add and clearCompleted', async () => {
    const store = await seed(ORIGINAL);
    await store.add({ text: 'new thing' });
    await store.toggle({ ordinal: 0, expectedText: 'ship it' });
    await store.clearCompleted();

    const after = await read();
    assert.match(after, /^# My todos$/m);
    assert.match(after, /^Some prose I wrote by hand\.$/m);
    assert.match(after, /^## Work$/m);
    assert.match(after, /^## Home$/m);
  });
});

describe('add', () => {
  test('appends after the last task', async () => {
    const store = await seed('# T\n\n- [ ] one\n\nTrailing prose.\n');
    await store.add({ text: 'two' });

    const lines = (await read()).split('\n');
    assert.equal(lines.indexOf('- [ ] two'), lines.indexOf('- [ ] one') + 1);
    assert.match(await read(), /^Trailing prose\.$/m);
  });

  test('appends after existing prose when there are no tasks yet', async () => {
    const store = await seed('# T\n\nJust prose.\n');
    await store.add({ text: 'first' });

    const after = await read();
    assert.match(after, /^Just prose\.$/m);
    assert.match(after, /^- \[ \] first$/m);
  });

  test('omits the marker for medium priority', async () => {
    const store = await seed('');
    await store.add({ text: 'plain', priority: 'medium' });
    assert.match(await read(), /^- \[ \] plain$/m);
  });

  test('writes !high and @date', async () => {
    const store = await seed('');
    await store.add({ text: 'urgent', priority: 'high', due: '2026-08-01' });
    assert.match(await read(), /^- \[ \] urgent !high @2026-08-01$/m);
  });

  test('rejects empty or whitespace-only text with 400', async () => {
    const store = await seed('');
    await assertStatus(() => store.add({ text: '   ' }), 400);
    await assertStatus(() => store.add({ text: '' }), 400);
  });

  test('normalises an unknown priority to medium', async () => {
    const store = await seed('');
    await store.add({ text: 'x', priority: 'urgent' });
    assert.equal((await store.list())[0]?.priority, 'medium');
  });

  test('drops an unparseable due date', async () => {
    const store = await seed('');
    await store.add({ text: 'x', due: 'next tuesday' });
    assert.equal((await store.list())[0]?.due, '');
  });

  test('flattens newlines so one task stays one line', async () => {
    const store = await seed('');
    await store.add({ text: 'line one\nline two' });

    assert.equal((await store.list()).length, 1);
    assert.equal((await store.list())[0]?.text, 'line one line two');
  });

  test('text containing ! or @ that is not a token is left alone', async () => {
    const store = await seed('');
    await store.add({ text: 'email bob@example.com about !urgent stuff' });
    assert.equal((await store.list())[0]?.text, 'email bob@example.com about !urgent stuff');
  });
});

describe('conflict detection', () => {
  test('toggle rejects a mismatched expectedText with 409', async () => {
    const store = await seed('- [ ] one\n');
    await assertStatus(() => store.toggle({ ordinal: 0, expectedText: 'something else' }), 409);
    assert.match(await read(), /- \[ \] one/, 'file must be unchanged');
  });

  test('delete rejects an out-of-range ordinal with 409', async () => {
    const store = await seed('- [ ] one\n');
    await assertStatus(() => store.remove({ ordinal: 99, expectedText: 'one' }), 409);
    assert.match(await read(), /- \[ \] one/);
  });

  test('a hand edit between read and write is caught', async () => {
    const store = await seed('- [ ] first\n- [ ] second\n');
    const tasks = await store.list();

    // Simulate the user deleting the first task in an editor. Ordinal 1 now
    // refers to a different task than the client saw.
    await fs.writeFile(file, '- [ ] second\n', 'utf8');

    await assertStatus(
      () => store.toggle({ ordinal: 1, expectedText: tasks[1]?.text }),
      409,
    );
  });

  test('omitting expectedText skips the guard', async () => {
    const store = await seed('- [ ] one\n');
    await store.toggle({ ordinal: 0 });
    assert.match(await read(), /- \[x\] one/);
  });
});

describe('remove and clearCompleted', () => {
  test('remove deletes only the named task', async () => {
    const store = await seed('- [ ] a\n- [ ] b\n- [ ] c\n');
    await store.remove({ ordinal: 1, expectedText: 'b' });
    assert.deepEqual((await store.list()).map((t) => t.text), ['a', 'c']);
  });

  test('clearCompleted removes every done task and keeps the rest', async () => {
    const store = await seed('- [x] a\n- [ ] b\n- [x] c\n- [ ] d\n');
    const tasks = await store.clearCompleted();
    assert.deepEqual(tasks.map((t) => t.text), ['b', 'd']);
  });

  test('clearCompleted on an all-done list empties it', async () => {
    const store = await seed('# Keep me\n\n- [x] a\n- [x] b\n');
    await store.clearCompleted();

    assert.deepEqual(await store.list(), []);
    assert.match(await read(), /^# Keep me$/m);
  });
});

describe('durability', () => {
  test('mutations leave no temp files behind', async () => {
    const store = await seed('- [ ] one\n');
    await store.add({ text: 'two' });
    await store.toggle({ ordinal: 0, expectedText: 'one' });
    await store.clearCompleted();

    const leftovers = (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  });

  test('concurrent adds are serialised, not interleaved', async () => {
    const store = await seed('- [ ] start\n');
    await Promise.all([
      store.add({ text: 'a' }),
      store.add({ text: 'b' }),
      store.add({ text: 'c' }),
    ]);

    const texts = (await store.list()).map((t) => t.text);
    assert.equal(texts.length, 4, 'no write may be lost');
    assert.deepEqual([...texts].sort(), ['a', 'b', 'c', 'start']);
  });

  test('creates the file and its parent directory on first use', async () => {
    const nested = path.join(dir, 'deep', 'nested', 'todos.md');
    const store = createTodoStore(nested);

    assert.deepEqual(await store.list(), []);
    await store.add({ text: 'hello' });
    assert.match(await fs.readFile(nested, 'utf8'), /- \[ \] hello/);
  });
});
