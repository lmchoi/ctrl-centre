import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Markdown-backed journal store.
 *
 * An entry is a `## YYYY-MM-DD HH:MM` heading followed by free text, ending at
 * the next h1 or h2 heading (timestamped or not) or at EOF:
 *
 *   ## 2026-07-26 14:32
 *
 *   Shipped the CI slice. Entry text can span any number of lines.
 *
 * Unlike a todo, entry text may contain newlines. Everything else in the
 * file — the preamble, non-timestamp headings, prose, comments, fenced code
 * — is preserved verbatim on write, so the file stays hand-editable. See
 * docs/plans/journal-panel.md for the full design.
 */

/**
 * @typedef {import('../types.d.ts').JournalEntry} JournalEntry
 * @typedef {import('../types.d.ts').ParsedEntry} ParsedEntry
 * @typedef {import('../types.d.ts').JournalDocument} JournalDocument
 * @typedef {import('../types.d.ts').NewEntry} NewEntry
 * @typedef {import('../types.d.ts').EntryRef} EntryRef
 * @typedef {import('../types.d.ts').HttpError} HttpError
 */

const ENTRY_RE = /^## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\s*$/;
const HEADING_RE = /^#{1,2}\s/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/**
 * Written into a newly created journal file. The comment block is the spec
 * for anyone — human or agent — who opens the file without the dashboard, so
 * it travels with the file wherever the user points CTRL_CENTRE_DIR.
 *
 * Ends with exactly one trailing newline (no blank line before EOF) — `add`
 * always normalises the gap before the first entry to one blank line, so a
 * template that already matches that shape keeps add-then-delete byte-stable.
 */
const FILE_TEMPLATE = `# Journal

<!--
  ctrl-centre journal file. The dashboard and any agent edit this same file.
  Safe to edit by hand.

  An entry is a heading followed by free text:

      ## 2026-07-26 14:32

      Shipped the CI slice. Entry text can span any number of lines and
      blank lines — unlike a todo, it is not restricted to one line.

  The heading is exactly "## YYYY-MM-DD HH:MM", local time, nothing else on
  the line. Everything up to the next such heading — or the end of the file
  — is that entry's text. Entries are newest first.

  Editing rules:
    - Only a "## YYYY-MM-DD HH:MM" heading starts an entry. Any other
      heading, prose, blank lines and fenced code blocks are preserved
      verbatim and never parsed as entries.
    - A "###" heading or deeper stays inside the entry it is written under.
    - Don't reorder or reformat entries you weren't asked to touch.
    - If the dashboard is open in a browser, refresh it to see outside edits.
-->
`;

/**
 * Track HTML comment nesting across a line. Returns the state at end of line.
 * A file that documents its own format has `##` examples inside comments;
 * those are documentation, not entries. Mirrors server/todos.js.
 * @param {string} line
 * @param {boolean} inComment state at the start of this line
 * @returns {boolean}
 */
function commentStateAfter(line, inComment) {
  let cursor = 0;
  while (cursor < line.length) {
    if (inComment) {
      const end = line.indexOf('-->', cursor);
      if (end === -1) return true;
      cursor = end + 3;
      inComment = false;
    } else {
      const start = line.indexOf('<!--', cursor);
      if (start === -1) return false;
      cursor = start + 4;
      inComment = true;
    }
  }
  return inComment;
}

/**
 * Drop leading and trailing blank lines, preserving everything in between —
 * including per-line trailing whitespace, which markdown treats as a hard
 * break. Shared by body extraction on read and text normalisation on write,
 * so `expectedText` compares byte-for-byte against what a round trip produces.
 * @param {string[]} lines
 * @returns {string[]}
 */
function trimBlankEdges(lines) {
  const result = [...lines];
  while (result.length && result[0]?.trim() === '') result.shift();
  while (result.length && result.at(-1)?.trim() === '') result.pop();
  return result;
}

/**
 * Find every real entry. `ordinal` is the entry's position among entries
 * (what the client sends back); `startLine`/`endLine` are positions in the
 * raw file.
 *
 * Recognition of an entry heading — and of the generic h1/h2 that terminates
 * one — is suppressed inside an HTML comment or a fenced code block.
 * Accumulation into a body is never suppressed: a fenced block inside an
 * entry's body is captured verbatim, `##` lines and all. An unclosed fence
 * therefore swallows every following heading to EOF.
 * @param {string[]} lines
 * @returns {ParsedEntry[]}
 */
function indexEntries(lines) {
  /** @type {ParsedEntry[]} */
  const entries = [];
  let inComment = false;
  /** @type {string | null} */
  let fence = null;
  /** @type {{ startLine: number, timestamp: string, bodyLines: string[] } | null} */
  let current = null;

  /** @param {number} endLine */
  function close(endLine) {
    if (!current) return;
    entries.push({
      ordinal: entries.length,
      timestamp: current.timestamp,
      text: trimBlankEdges(current.bodyLines).join('\n'),
      startLine: current.startLine,
      endLine,
    });
    current = null;
  }

  lines.forEach((line, lineNo) => {
    const openingFence = !inComment && /^\s*(`{3,}|~{3,})/.exec(line);
    let recognized = false;

    if (openingFence) {
      const marker = openingFence[1]?.[0] ?? '`';
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
    } else if (!inComment && fence === null) {
      const entryMatch = ENTRY_RE.exec(line);
      if (entryMatch) {
        close(lineNo - 1);
        current = { startLine: lineNo, timestamp: `${entryMatch[1]} ${entryMatch[2]}`, bodyLines: [] };
        recognized = true;
      } else if (HEADING_RE.test(line)) {
        close(lineNo - 1);
        recognized = true;
      }
    }

    if (!recognized && current) current.bodyLines.push(line);

    inComment = commentStateAfter(line, inComment);
  });

  close(lines.length - 1);
  return entries;
}

/**
 * Build an Error the HTTP layer can turn into a status code.
 * @param {number} status
 * @param {string} message
 * @returns {HttpError}
 */
function httpError(status, message) {
  const err = /** @type {HttpError} */ (new Error(message));
  err.status = status;
  return err;
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function readFileOrCreate(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, FILE_TEMPLATE, 'utf8');
    return FILE_TEMPLATE;
  }
}

/**
 * Write via a temp file + rename so a crash can never truncate the journal.
 * @param {string} filePath
 * @param {string} contents
 */
async function writeFileAtomic(filePath, contents) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * @param {string} filePath
 * @returns {Promise<JournalDocument>}
 */
async function loadDocument(filePath) {
  const raw = await readFileOrCreate(filePath);
  // Normalised here so a CRLF file yields no stray `\r` anywhere downstream.
  const lines = raw.split(/\r?\n/);
  return { lines, entries: indexEntries(lines) };
}

/**
 * Guard against acting on the wrong entry when the file changed underneath us
 * (a hand edit in an editor, another tab). The client sends the text it saw.
 * A multi-line body makes this stricter than the todo store's guard: any hand
 * edit anywhere in the entry blocks deleting it until the panel reloads. See
 * docs/adr/0005 and docs/plans/journal-panel.md.
 * @param {JournalDocument} doc
 * @param {number} ordinal
 * @param {string} [expectedText]
 * @returns {ParsedEntry}
 */
function resolveEntry(doc, ordinal, expectedText) {
  const entry = doc.entries[ordinal];
  if (!entry) {
    throw httpError(409, 'That entry no longer exists — the file changed. Reloading.');
  }
  if (typeof expectedText === 'string' && entry.text !== expectedText) {
    throw httpError(409, 'That entry changed on disk — reloading so you do not edit the wrong one.');
  }
  return entry;
}

/**
 * @param {ParsedEntry} entry
 * @returns {JournalEntry}
 */
function toWire(entry) {
  return { ordinal: entry.ordinal, timestamp: entry.timestamp, text: entry.text };
}

/**
 * `YYYY-MM-DD HH:MM`, local wall-clock — the client's clock stamps the entry,
 * not the server's, so this is only the fallback when `timestamp` is omitted.
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Serialize mutations. Every write is read-modify-write on the same file, so
 * two overlapping requests must not interleave. This queue is module-global
 * to journal.js and independent of the one in todos.js — the two files must
 * not share a write queue, or a slow todo write would stall a journal entry.
 */
/** @type {Promise<unknown>} */
let queue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * @param {string} filePath
 */
export function createJournalStore(filePath) {
  /** @returns {Promise<JournalEntry[]>} */
  async function list() {
    const doc = await loadDocument(filePath);
    return doc.entries.map(toWire);
  }

  /**
   * @param {(doc: JournalDocument) => void} apply
   * @returns {Promise<JournalEntry[]>}
   */
  async function mutate(apply) {
    return withLock(async () => {
      const doc = await loadDocument(filePath);
      apply(doc);
      await writeFileAtomic(filePath, doc.lines.join('\n'));
      // Re-index from the mutated lines so ordinals returned to the client are fresh.
      return indexEntries(doc.lines).map(toWire);
    });
  }

  return {
    filePath,
    list,

    /**
     * `async` so validation failures reject rather than throw synchronously —
     * every method on this store returns a promise, including on bad input.
     * @param {NewEntry} input
     */
    async add({ text, timestamp }) {
      const normalized = trimBlankEdges(String(text ?? '').split(/\r?\n/)).join('\n');
      if (!normalized) throw httpError(400, 'Entry text is required.');

      /** @type {string} */
      let ts;
      if (timestamp === undefined) {
        ts = formatTimestamp(new Date());
      } else if (typeof timestamp === 'string' && TIMESTAMP_RE.test(timestamp)) {
        ts = timestamp;
      } else {
        throw httpError(400, 'Malformed timestamp.');
      }

      return mutate((doc) => {
        const first = doc.entries[0];
        const preambleEnd = first ? first.startLine : doc.lines.length;

        // Preserved byte-for-byte except for this blank run, which is
        // normalised to exactly one blank line before the new heading.
        const preamble = doc.lines.slice(0, preambleEnd);
        while (preamble.length && preamble.at(-1)?.trim() === '') preamble.pop();
        if (preamble.length) preamble.push('');

        const entryLines = [`## ${ts}`, '', ...normalized.split('\n'), ''];
        const rest = doc.lines.slice(preambleEnd);

        doc.lines = [...preamble, ...entryLines, ...rest];
      });
    },

    /** @param {EntryRef} ref */
    remove({ ordinal, expectedText }) {
      return mutate((doc) => {
        const entry = resolveEntry(doc, ordinal, expectedText);
        // The region owns its trailing blanks, so neighbours keep exactly one
        // blank line between them and repeated add/delete cannot drift.
        doc.lines.splice(entry.startLine, entry.endLine - entry.startLine + 1);
      });
    },
  };
}

export const _internals = { indexEntries, trimBlankEdges, formatTimestamp };
