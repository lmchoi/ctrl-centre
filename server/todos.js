import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Markdown-backed todo store.
 *
 * A task is any GitHub-style checklist line:
 *
 *   - [ ] Renew domain !high @2026-08-01
 *   - [x] Review weekly budget !low
 *
 * `!high|!medium|!low` sets priority (omitted means medium), `@YYYY-MM-DD` sets
 * the due date. Everything else in the file — headings, prose, comments, nested
 * lists — is preserved verbatim on write, so the file stays hand-editable.
 */

/**
 * @typedef {import('../types.d.ts').Priority} Priority
 * @typedef {import('../types.d.ts').Task} Task
 * @typedef {import('../types.d.ts').ParsedTask} ParsedTask
 * @typedef {import('../types.d.ts').TodoDocument} TodoDocument
 * @typedef {import('../types.d.ts').NewTask} NewTask
 * @typedef {import('../types.d.ts').TaskRef} TaskRef
 * @typedef {import('../types.d.ts').HttpError} HttpError
 */

const TASK_RE = /^(\s*)([-*+])\s+\[([ xX])\]\s*(.*)$/;
const PRIORITY_RE = /\s*!(high|medium|low)\b/i;
const DUE_RE = /\s*@(\d{4}-\d{2}-\d{2})\b/;

/** @type {Priority[]} */
export const PRIORITIES = ['low', 'medium', 'high'];
/** @type {Priority} */
const DEFAULT_PRIORITY = 'medium';

/**
 * Written into a newly created todo file. The comment block is the spec for
 * anyone — human or agent — who opens the file without the dashboard, so it
 * travels with the file wherever the user points CTRL_CENTRE_TODO_FILE.
 */
const FILE_TEMPLATE = `# Todos

<!--
  ctrl-centre todo file. The dashboard and any agent edit this same file.
  Safe to edit by hand.

  A task is a markdown checklist line:

      - [ ] Renew domain !high @2026-08-01
      - [x] Review weekly budget !low

  "[ ]" is open, "[x]" is done. Priority is !high, !medium or !low — omit it
  for medium. Due date is @YYYY-MM-DD. Both tokens go at the end of the line,
  and one task is always exactly one line.

  Editing rules:
    - Only checklist lines are parsed. Headings, prose, blank lines, fenced
      code blocks and these comments are preserved verbatim — keep them.
      (Checklist lines inside comments and code fences are ignored, which is
      why the examples above are not treated as real tasks.)
    - Complete a task by changing [ ] to [x]. Don't delete it unless asked.
    - Indented checklist items are ordinary tasks, not subtasks.
    - Don't reorder or reformat lines you weren't asked to touch.
    - If the dashboard is open in a browser, refresh it to see outside edits.
-->

`;

/**
 * Parse one line into a task, or return null if it isn't a checklist line.
 * @param {string} line
 * @returns {Omit<ParsedTask, 'ordinal' | 'lineNo'> | null}
 */
function parseTaskLine(line) {
  const m = TASK_RE.exec(line);
  if (!m) return null;

  const [, indent = '', bullet = '-', mark = ' '] = m;
  let rest = m[4] ?? '';

  const priorityMatch = PRIORITY_RE.exec(rest);
  if (priorityMatch) rest = rest.replace(PRIORITY_RE, '');

  const dueMatch = DUE_RE.exec(rest);
  if (dueMatch) rest = rest.replace(DUE_RE, '');

  // The regex alternation constrains this to a Priority; the cast just tells
  // the checker what the pattern already guarantees.
  const priority = /** @type {Priority} */ (
    priorityMatch?.[1]?.toLowerCase() ?? DEFAULT_PRIORITY
  );

  return {
    indent,
    bullet,
    done: mark.toLowerCase() === 'x',
    text: rest.trim(),
    priority,
    due: dueMatch?.[1] ?? '',
  };
}

/**
 * Render a task back to its markdown line.
 * @param {Pick<ParsedTask, 'done' | 'text' | 'priority' | 'due'>
 *         & Partial<Pick<ParsedTask, 'indent' | 'bullet'>>} task
 * @returns {string}
 */
function formatTaskLine(task) {
  const parts = [
    `${task.indent ?? ''}${task.bullet ?? '-'} [${task.done ? 'x' : ' '}] ${task.text}`,
  ];
  if (task.priority && task.priority !== DEFAULT_PRIORITY) parts.push(`!${task.priority}`);
  if (task.due) parts.push(`@${task.due}`);
  return parts.join(' ');
}

/**
 * Track HTML comment nesting across a line. Returns the state at end of line.
 * A file that documents its own format has `- [ ]` examples inside comments;
 * those are documentation, not tasks.
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
 * Find every real task line. `ordinal` is the task's position among tasks
 * (what the client sends back); `lineNo` is its position in the raw file.
 * Lines inside HTML comments or fenced code blocks are skipped.
 * @param {string[]} lines
 * @returns {ParsedTask[]}
 */
function indexTasks(lines) {
  /** @type {ParsedTask[]} */
  const tasks = [];
  let inComment = false;
  /** @type {string | null} */
  let fence = null;

  lines.forEach((line, lineNo) => {
    const openingFence = !inComment && /^\s*(`{3,}|~{3,})/.exec(line);
    if (openingFence) {
      const marker = openingFence[1]?.[0] ?? '`';
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
    } else if (!inComment && fence === null) {
      const task = parseTaskLine(line);
      if (task) tasks.push({ ...task, ordinal: tasks.length, lineNo });
    }

    inComment = commentStateAfter(line, inComment);
  });

  return tasks;
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
 * @param {unknown} value
 * @returns {value is Priority}
 */
function isPriority(value) {
  return PRIORITIES.includes(/** @type {Priority} */ (value));
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
 * Write via a temp file + rename so a crash can never truncate the todo file.
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
 * @returns {Promise<TodoDocument>}
 */
async function loadDocument(filePath) {
  const raw = await readFileOrCreate(filePath);
  const lines = raw.split('\n');
  return { lines, tasks: indexTasks(lines) };
}

/**
 * Guard against acting on the wrong task when the file changed underneath us
 * (a hand edit in an editor, another tab). The client sends the text it saw.
 * @param {TodoDocument} doc
 * @param {number} ordinal
 * @param {string} [expectedText]
 * @returns {ParsedTask}
 */
function resolveTask(doc, ordinal, expectedText) {
  const task = doc.tasks[ordinal];
  if (!task) {
    throw httpError(409, 'That task no longer exists — the file changed. Reloading.');
  }
  if (typeof expectedText === 'string' && task.text !== expectedText) {
    throw httpError(409, 'That task changed on disk — reloading so you do not edit the wrong one.');
  }
  return task;
}

/**
 * @param {ParsedTask} task
 * @returns {Task}
 */
function toWire(task) {
  return {
    ordinal: task.ordinal,
    text: task.text,
    done: task.done,
    priority: task.priority,
    due: task.due,
  };
}

/**
 * Serialize mutations. Every write is read-modify-write on the same file, so
 * two overlapping requests must not interleave.
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
export function createTodoStore(filePath) {
  /** @returns {Promise<Task[]>} */
  async function list() {
    const doc = await loadDocument(filePath);
    return doc.tasks.map(toWire);
  }

  /**
   * @param {(doc: TodoDocument) => void} apply
   * @returns {Promise<Task[]>}
   */
  async function mutate(apply) {
    return withLock(async () => {
      const doc = await loadDocument(filePath);
      apply(doc);
      await writeFileAtomic(filePath, doc.lines.join('\n'));
      // Re-index from the mutated lines so ordinals returned to the client are fresh.
      return indexTasks(doc.lines).map(toWire);
    });
  }

  return {
    filePath,
    list,

    /**
     * `async` so validation failures reject rather than throw synchronously —
     * every method on this store returns a promise, including on bad input.
     * @param {NewTask} input
     */
    async add({ text, priority, due }) {
      const trimmed = String(text ?? '').trim();
      if (!trimmed) throw httpError(400, 'Task text is required.');

      const normalizedPriority = isPriority(priority) ? priority : DEFAULT_PRIORITY;
      const normalizedDue = typeof due === 'string' && DUE_RE.test(` @${due}`) ? due : '';

      return mutate((doc) => {
        const line = formatTaskLine({
          indent: '',
          bullet: '-',
          done: false,
          // A literal newline would split one task into two lines.
          text: trimmed.replace(/\r?\n/g, ' '),
          priority: normalizedPriority,
          due: normalizedDue,
        });

        const last = doc.tasks[doc.tasks.length - 1];
        if (last) {
          doc.lines.splice(last.lineNo + 1, 0, line);
          return;
        }
        // No tasks yet: append after the file's existing prose.
        while (doc.lines.length && doc.lines.at(-1)?.trim() === '') doc.lines.pop();
        if (doc.lines.length) doc.lines.push('');
        doc.lines.push(line, '');
      });
    },

    /** @param {TaskRef} ref */
    toggle({ ordinal, expectedText }) {
      return mutate((doc) => {
        const task = resolveTask(doc, ordinal, expectedText);
        doc.lines[task.lineNo] = formatTaskLine({ ...task, done: !task.done });
      });
    },

    /** @param {TaskRef} ref */
    remove({ ordinal, expectedText }) {
      return mutate((doc) => {
        const task = resolveTask(doc, ordinal, expectedText);
        doc.lines.splice(task.lineNo, 1);
      });
    },

    clearCompleted() {
      return mutate((doc) => {
        const doneLines = doc.tasks.filter((t) => t.done).map((t) => t.lineNo);
        // Descending, so each splice leaves the remaining line numbers valid.
        for (const lineNo of doneLines.reverse()) doc.lines.splice(lineNo, 1);
      });
    },
  };
}

export const _internals = { parseTaskLine, formatTaskLine };
