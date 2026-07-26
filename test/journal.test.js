import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createJournalStore } from '../server/journal.js';

/** @type {string} */
let dir;
/** @type {string} */
let file;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl-centre-journal-'));
  file = path.join(dir, 'journal.md');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** @param {string} contents */
async function seed(contents) {
  await fs.writeFile(file, contents, 'utf8');
  return createJournalStore(file);
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
  const FIXTURE = [
    '# My Journal',
    '',
    'Some preamble prose.',
    '',
    '## 2026-07-20 09:00',
    '',
    'First entry line one.',
    'Second line of first entry.',
    '',
    '## 2026-07-19 08:30',
    '',
    'Second entry, single line.',
    '',
    '## Not a timestamp',
    '',
    'This heading is not a timestamp entry and must never appear as one.',
    '',
    '<!--',
    '## 2026-07-18 07:00',
    '',
    'Commented entry must not appear.',
    '-->',
    '',
    '```markdown',
    '## 2026-07-17 06:00',
    '',
    'Fenced example heading must not appear either.',
    '```',
    '',
    '## 2026-07-16 05:00',
    '',
    'Entry with a fenced block containing a heading-looking line:',
    '',
    '```',
    '## not a real heading',
    'some code',
    '```',
    '',
    'Text after the fence, still inside this entry.',
    '',
    '# Trailing heading',
    '',
    'Prose after the last real entry; must not appear as an entry either.',
    '',
  ].join('\n');

  test('reads a preamble and multi-line entry bodies', async () => {
    const store = await seed(FIXTURE);
    const entries = await store.list();

    assert.deepEqual(
      entries.map((e) => e.timestamp),
      ['2026-07-20 09:00', '2026-07-19 08:30', '2026-07-16 05:00'],
      'only real ## YYYY-MM-DD HH:MM headings become entries',
    );
    assert.equal(
      entries[0]?.text,
      'First entry line one.\nSecond line of first entry.',
      'a body may span multiple lines',
    );
    assert.equal(entries[1]?.text, 'Second entry, single line.');
  });

  test('a heading inside an HTML comment is not an entry', async () => {
    const store = await seed(FIXTURE);
    const entries = await store.list();
    assert.ok(!entries.some((e) => e.timestamp === '2026-07-18 07:00'));
  });

  test('a heading inside a fenced code block is not an entry', async () => {
    const store = await seed(FIXTURE);
    const entries = await store.list();
    assert.ok(!entries.some((e) => e.timestamp === '2026-07-17 06:00'));
  });

  test('a non-timestamp h2 terminates the previous entry and is never an entry itself', async () => {
    const store = await seed(FIXTURE);
    const entries = await store.list();
    assert.ok(!entries.some((e) => e.timestamp === 'Not a timestamp'));
    // The second entry's body must not have swallowed the "Not a timestamp" heading.
    assert.doesNotMatch(entries[1]?.text ?? '', /Not a timestamp/);
  });

  test('an h1 after the last entry is not an entry and does not corrupt the last one', async () => {
    const store = await seed(FIXTURE);
    const entries = await store.list();
    assert.equal(entries.length, 3);
    assert.doesNotMatch(entries[2]?.text ?? '', /Trailing heading/);
  });

  test('a fenced code block inside a body is captured verbatim, ## lines and all', async () => {
    const store = await seed(FIXTURE);
    const entries = await store.list();
    const last = entries[2];

    assert.match(last?.text ?? '', /```\n## not a real heading\nsome code\n```/);
    assert.match(last?.text ?? '', /Text after the fence, still inside this entry\.$/);
  });

  test('an unclosed fence swallows every following heading to EOF', async () => {
    const unclosed = [
      '## 2026-07-15 04:00',
      '',
      'Body before the fence opens.',
      '',
      '```',
      'This fence never closes, so everything below is swallowed:',
      '',
      '## 2026-07-14 03:00',
      '',
      'This would have been a second entry but is swallowed into the first.',
    ].join('\n');

    const store = await seed(unclosed);
    const entries = await store.list();

    assert.equal(entries.length, 1, 'the unclosed fence prevents a second entry from being recognised');
    assert.match(entries[0]?.text ?? '', /Body before the fence opens\./);
    assert.match(entries[0]?.text ?? '', /```\nThis fence never closes/);
    assert.match(entries[0]?.text ?? '', /## 2026-07-14 03:00/);
    assert.match(
      entries[0]?.text ?? '',
      /This would have been a second entry but is swallowed into the first\.$/,
    );
  });
});

describe('documentation is not data', () => {
  test('a freshly created file documents its format without listing entries', async () => {
    const store = createJournalStore(file);
    const entries = await store.list();

    const contents = await read();
    assert.match(contents, /## \d{4}-\d{2}-\d{2} \d{2}:\d{2}/, 'template should show an example heading');
    assert.equal(entries.length, 0, 'but the example must not parse as a real entry');
  });
});

describe('whitespace contract', () => {
  test('CRLF input round-trips without stray \\r', async () => {
    const store = await seed('# Journal\r\n\r\n## 2026-07-20 09:00\r\n\r\nline one\r\nline two\r\n');
    const entries = await store.list();
    assert.equal(entries[0]?.text, 'line one\nline two');

    // list() alone does not rewrite the file; a mutation does, and rewrites
    // the whole thing (doc.lines.join('\n')), so \r cannot survive it either.
    await store.add({ text: 'another' });
    assert.doesNotMatch(await read(), /\r/);
  });

  test('two-space trailing hard breaks survive', async () => {
    const store = await seed('# Journal\n\n## 2026-07-20 09:00\n\nline one  \nline two\n');
    const entries = await store.list();
    assert.equal(entries[0]?.text, 'line one  \nline two');
  });

  test('leading and trailing blank lines in a body are dropped', async () => {
    const store = await seed('# Journal\n\n## 2026-07-20 09:00\n\n\n\nreal text\n\n\n\n## 2026-07-19 08:00\n\nother\n');
    const entries = await store.list();
    assert.equal(entries[0]?.text, 'real text');
  });
});

describe('add', () => {
  test('rejects empty or whitespace-only text with 400', async () => {
    const store = await seed('');
    await assertStatus(() => store.add({ text: '   ' }), 400);
    await assertStatus(() => store.add({ text: '' }), 400);
  });

  test('rejects a malformed timestamp with 400', async () => {
    const store = await seed('');
    await assertStatus(() => store.add({ text: 'hi', timestamp: 'not-a-date' }), 400);
    await assertStatus(() => store.add({ text: 'hi', timestamp: '2026-07-20' }), 400);
  });

  test('accepts an explicit valid timestamp verbatim', async () => {
    const store = await seed('');
    const entries = await store.add({ text: 'hi', timestamp: '2026-07-20 09:00' });
    assert.equal(entries[0]?.timestamp, '2026-07-20 09:00');
  });

  test('falls back to the current wall clock when timestamp is omitted', async () => {
    const store = await seed('');
    const entries = await store.add({ text: 'hi' });
    assert.match(entries[0]?.timestamp ?? '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test('prepends the new entry immediately after the preamble', async () => {
    const store = await seed('# Journal\n\nPreamble.\n\n## 2026-07-19 08:00\n\nold entry\n');
    const entries = await store.add({ text: 'new entry', timestamp: '2026-07-20 09:00' });

    assert.deepEqual(entries.map((e) => e.text), ['new entry', 'old entry']);
    const after = await read();
    assert.ok(after.indexOf('2026-07-20 09:00') < after.indexOf('2026-07-19 08:00'));
    assert.match(after, /^Preamble\.$/m);
  });

  test('adding twice into a fresh template is blank-line-stable', async () => {
    const store = createJournalStore(file);
    await store.add({ text: 'first', timestamp: '2026-07-20 09:00' });
    const afterOne = await read();

    await store.add({ text: 'second', timestamp: '2026-07-21 09:00' });
    const afterTwo = await read();

    assert.doesNotMatch(afterOne, /\n\n\n/, 'no run of blank lines after one add');
    assert.doesNotMatch(afterTwo, /\n\n\n/, 'no run of blank lines after two adds');

    // The gap the second add opens up before the (unmoved) first entry must be
    // byte-identical to the gap that existed after the first add — otherwise
    // blank lines are silently accumulating one add at a time.
    const firstEntryOnwards = afterOne.slice(afterOne.indexOf('## 2026-07-20'));
    assert.ok(afterTwo.endsWith(firstEntryOnwards));
  });

  test('add then delete restores the file to its prior bytes', async () => {
    const store = createJournalStore(file);
    await store.list(); // materialises the template on disk
    const before = await read();

    const entries = await store.add({ text: 'temporary', timestamp: '2026-07-20 09:00' });
    await store.remove({ ordinal: 0, expectedText: entries[0]?.text });

    const after = await read();
    assert.equal(after, before);
  });

  test('flattens CRLF from the wire before splicing', async () => {
    const store = await seed('');
    await store.add({ text: 'line one\r\nline two' });
    assert.doesNotMatch(await read(), /\r/);
  });
});

describe('conflict detection', () => {
  test('expectedText mismatch rejects with 409 and leaves the file alone', async () => {
    const store = await seed('## 2026-07-20 09:00\n\noriginal\n');
    await assertStatus(
      () => store.remove({ ordinal: 0, expectedText: 'something else' }),
      409,
    );
    assert.match(await read(), /original/);
  });

  test('a vanished ordinal rejects with 409', async () => {
    const store = await seed('## 2026-07-20 09:00\n\noriginal\n');
    await assertStatus(() => store.remove({ ordinal: 5, expectedText: 'original' }), 409);
  });

  test('omitting expectedText skips the guard', async () => {
    const store = await seed('## 2026-07-20 09:00\n\noriginal\n');
    const entries = await store.remove({ ordinal: 0 });
    assert.deepEqual(entries, []);
  });
});

describe('remove', () => {
  test('deletes only the named entry and preserves everything else byte for byte', async () => {
    const store = await seed(
      [
        '# Journal',
        '',
        '## 2026-07-20 09:00',
        '',
        'newest',
        '',
        '## 2026-07-19 08:00',
        '',
        'middle',
        '',
        '## 2026-07-18 07:00',
        '',
        'oldest',
        '',
      ].join('\n'),
    );

    const entries = await store.remove({ ordinal: 1, expectedText: 'middle' });
    assert.deepEqual(entries.map((e) => e.text), ['newest', 'oldest']);

    const after = await read();
    assert.match(after, /^# Journal$/m);
    assert.match(after, /newest/);
    assert.match(after, /oldest/);
    assert.doesNotMatch(after, /middle/);
    assert.doesNotMatch(after, /\n\n\n/, 'no blank-line drift around the deleted entry');
  });
});

describe('durability', () => {
  test('mutations leave no temp files behind', async () => {
    const store = await seed('## 2026-07-20 09:00\n\none\n');
    await store.add({ text: 'two' });
    const entries = await store.list();
    await store.remove({ ordinal: 0, expectedText: entries[0]?.text });

    const leftovers = (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  });

  test('concurrent adds are serialised, not interleaved', async () => {
    const store = await seed('## 2026-07-20 09:00\n\nstart\n');
    await Promise.all([
      store.add({ text: 'a' }),
      store.add({ text: 'b' }),
      store.add({ text: 'c' }),
    ]);

    const texts = (await store.list()).map((e) => e.text);
    assert.equal(texts.length, 4, 'no write may be lost');
    assert.deepEqual([...texts].sort(), ['a', 'b', 'c', 'start']);
  });

  test('creates the file and its parent directory on first use', async () => {
    const nested = path.join(dir, 'deep', 'nested', 'journal.md');
    const store = createJournalStore(nested);

    assert.deepEqual(await store.list(), []);
    await store.add({ text: 'hello' });
    assert.match(await fs.readFile(nested, 'utf8'), /hello/);
  });
});
