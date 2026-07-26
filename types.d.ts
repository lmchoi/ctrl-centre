/**
 * Shapes that cross a boundary nothing else enforces: server → JSON → client,
 * and the shell → panel contract. See docs/adr/0004.
 */

export type Priority = 'low' | 'medium' | 'high';

/** A task as it is sent to the client. Mirrors `toWire()` in server/todos.js. */
export interface Task {
  /**
   * Position among tasks in the file. NOT stable across edits — it is only
   * meaningful for the file as it was read, which is why mutations also send
   * the text the client saw. See docs/adr/0005.
   */
  ordinal: number;
  text: string;
  done: boolean;
  priority: Priority;
  /** ISO `YYYY-MM-DD`, or empty string when no due date is set. */
  due: string;
}

/** A task as it exists in the parsed document, before going over the wire. */
export interface ParsedTask extends Task {
  /** Leading whitespace, preserved so indented items stay indented. */
  indent: string;
  /** The bullet character used (`-`, `*` or `+`), preserved as written. */
  bullet: string;
  /** Zero-based line number in the raw file. */
  lineNo: number;
}

/** The file split into lines, with its checklist lines indexed. */
export interface TodoDocument {
  lines: string[];
  tasks: ParsedTask[];
}

/** What `POST /api/todos` accepts. Fields are validated and normalised. */
export interface NewTask {
  text: string;
  priority?: string;
  due?: string;
}

/** Identifies a task to mutate, plus the guard against acting on the wrong one. */
export interface TaskRef {
  ordinal: number;
  expectedText?: string;
}

/** An Error carrying the HTTP status the API layer should respond with. */
export interface HttpError extends Error {
  status?: number;
}

/** A journal entry as it is sent to the client. Mirrors `toWire()` in server/journal.js. */
export interface JournalEntry {
  /**
   * Position among entries in the file. NOT stable across edits — see
   * docs/adr/0005, reused here rather than a new mechanism.
   */
  ordinal: number;
  /** `YYYY-MM-DD HH:MM`, local wall-clock, as written in the file. */
  timestamp: string;
  /** May contain newlines — unlike a todo, an entry is not one-line-per-task. */
  text: string;
}

/** A journal entry as it exists in the parsed document, before going over the wire. */
export interface ParsedEntry extends JournalEntry {
  /** Heading line, zero-based. */
  startLine: number;
  /** Last occupied line, trailing blanks included — not the last non-blank body line. */
  endLine: number;
}

/** The journal file split into lines, with its entries indexed. */
export interface JournalDocument {
  lines: string[];
  entries: ParsedEntry[];
}

/** What `POST /api/journal` accepts. */
export interface NewEntry {
  text: string;
  /** `YYYY-MM-DD HH:MM`; falls back to the server's clock when omitted. */
  timestamp?: string;
}

/** Identifies an entry to mutate, plus the guard against acting on the wrong one. */
export interface EntryRef {
  ordinal: number;
  expectedText?: string;
}

/** A dashboard panel module. See docs/adr/0006. */
export interface Panel {
  id: string;
  label: string;
  icon: string;
  /** Heading shown in the top bar; falls back to the registry entry's label. */
  title?: string;
  /** Build the panel into `host`. Return a cleanup function if it needs one. */
  mount(host: HTMLElement): (() => void) | void;
}

/** A row in the `PANELS` registry in public/app.js. */
export interface PanelEntry {
  id: string;
  label: string;
  icon: string;
  /** `null` until the panel is implemented; renders as a disabled nav entry. */
  panel: Panel | null;
}
