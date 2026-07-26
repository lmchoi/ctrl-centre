import { el, clear, api } from '../lib/dom.js';

/**
 * @typedef {import('../../types.d.ts').Task} Task
 * @typedef {import('../../types.d.ts').Priority} Priority
 * @typedef {import('../../types.d.ts').Panel} Panel
 * @typedef {import('../../types.d.ts').HttpError} HttpError
 * @typedef {'all' | 'active' | 'done'} Filter
 */

/** @type {Record<Priority, string>} */
const PRIORITY_VARIANT = { high: 'destructive', medium: 'warning', low: 'secondary' };
/** @type {Record<Priority, string>} */
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
/** @type {{ value: Filter, label: string }[]} */
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
];

/** @type {Record<Filter, string>} */
const EMPTY_LABEL = {
  all: 'No tasks yet — add one above.',
  active: 'Nothing left to do.',
  done: 'No completed tasks yet.',
};

const CHECK_SVG =
  '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<path d="M2.5 6.2 4.7 8.4 9.5 3.6" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * @param {string} dateStr
 * @returns {string}
 */
function formatDue(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** @type {Panel} */
export const todoPanel = {
  id: 'tasks',
  label: 'Tasks',
  icon: '☑',
  title: 'Tasks',

  mount(host) {
    /**
     * @type {{ tasks: Task[], file: string, filter: Filter,
     *          error: string, busy: boolean }}
     */
    const state = { tasks: [], file: '', filter: 'all', error: '', busy: false };

    // --- Persistent chrome (built once, contents re-rendered on change) ---
    const summary = el('p', { class: 'card-desc', text: '—' });
    const banner = el('div', { class: 'banner', role: 'status' });
    const listEl = el('div', { class: 'todo-list' });
    const storageLabel = el('span', { class: 'mono todo-storage', text: '' });

    const draftText = el('input', {
      class: 'field field-text',
      type: 'text',
      placeholder: 'Add a task…',
      'aria-label': 'Task description',
      onkeydown: (/** @type {KeyboardEvent} */ event) => {
        if (event.key === 'Enter') addTask();
      },
    });

    const draftPriority = el('select', {
      class: 'field field-priority',
      'aria-label': 'Priority',
    }, [
      el('option', { value: 'low', text: 'Low' }),
      el('option', { value: 'medium', text: 'Medium' }),
      el('option', { value: 'high', text: 'High' }),
    ]);
    draftPriority.value = 'medium';

    const draftDue = el('input', {
      class: 'field field-due',
      type: 'date',
      'aria-label': 'Due date',
    });

    const addButton = el('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: 'Add',
      onclick: () => addTask(),
    });

    const tabsList = el('div', { class: 'tabs-list', role: 'tablist' });
    const tabButtons = FILTERS.map(({ value, label }) => {
      const button = el('button', {
        class: 'tabs-trigger',
        type: 'button',
        role: 'tab',
        text: label,
        onclick: () => {
          state.filter = value;
          render();
        },
      });
      tabsList.append(button);
      return { value, button };
    });

    const clearButton = el('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      text: 'Clear completed',
      onclick: () => run(() => api('/api/todos/clear-completed', { method: 'POST' })),
    });

    const card = el('section', { class: 'card' }, [
      el('div', { class: 'card-header' }, [
        el('h2', { class: 'card-title', text: 'Tasks' }),
        summary,
      ]),
      el('div', { class: 'card-content' }, [
        banner,
        el('div', { class: 'todo-compose' }, [draftText, draftPriority, draftDue, addButton]),
        tabsList,
        listEl,
      ]),
      el('div', { class: 'card-footer' }, [clearButton, storageLabel]),
    ]);

    clear(host).append(card);

    // --- Data flow ---

    /**
     * Run a mutation, adopting the fresh task list the server returns.
     * @param {() => Promise<{ tasks?: Task[] }>} action
     */
    async function run(action) {
      if (state.busy) return;
      state.busy = true;
      setBusy(true);
      try {
        const payload = await action();
        if (payload.tasks) state.tasks = payload.tasks;
        state.error = '';
      } catch (err) {
        const { message, status } = /** @type {HttpError} */ (err);
        state.error = message;
        // A 409 means the file changed underneath us; resync rather than guess.
        if (status === 409) await load({ keepError: true });
      } finally {
        state.busy = false;
        setBusy(false);
        render();
      }
    }

    /** @param {{ keepError?: boolean }} [options] */
    async function load({ keepError = false } = {}) {
      try {
        const payload = await api('/api/todos');
        state.tasks = payload.tasks;
        state.file = payload.file;
        if (!keepError) state.error = '';
      } catch (err) {
        state.error = /** @type {HttpError} */ (err).message;
      }
      render();
    }

    function addTask() {
      const text = draftText.value.trim();
      if (!text) {
        draftText.focus();
        return;
      }
      run(async () => {
        const payload = await api('/api/todos', {
          method: 'POST',
          body: { text, priority: draftPriority.value, due: draftDue.value },
        });
        draftText.value = '';
        draftDue.value = '';
        draftText.focus();
        return payload;
      });
    }

    /** @param {boolean} busy */
    function setBusy(busy) {
      for (const node of [draftText, draftPriority, draftDue, addButton, clearButton]) {
        node.disabled = busy;
      }
    }

    // --- Rendering ---

    /**
     * @param {Task} task
     * @returns {HTMLElement}
     */
    function renderRow(task) {
      const checkbox = el('button', {
        class: 'checkbox',
        type: 'button',
        role: 'checkbox',
        'aria-checked': String(task.done),
        'aria-label': `Mark "${task.text}" as ${task.done ? 'not done' : 'done'}`,
        'data-checked': String(task.done),
        html: task.done ? CHECK_SVG : '',
        onclick: () => run(() => api('/api/todos/toggle', {
          method: 'POST',
          body: { ordinal: task.ordinal, expectedText: task.text },
        })),
      });

      const dueLabel = formatDue(task.due);

      return el('div', { class: 'todo-row', 'data-done': String(task.done) }, [
        checkbox,
        el('span', { class: 'todo-text', text: task.text }),
        dueLabel && el('span', {
          class: 'mono todo-due',
          text: dueLabel,
          'data-overdue': String(!task.done && task.due < todayISO()),
        }),
        el('span', {
          class: `badge badge-${PRIORITY_VARIANT[task.priority] ?? 'secondary'}`,
          text: PRIORITY_LABEL[task.priority] ?? 'Low',
        }),
        el('button', {
          class: 'btn btn-ghost btn-icon',
          type: 'button',
          text: '×',
          title: 'Delete',
          'aria-label': `Delete "${task.text}"`,
          style: 'width:30px;height:30px;font-size:16px;',
          onclick: () => run(() => api('/api/todos/delete', {
            method: 'POST',
            body: { ordinal: task.ordinal, expectedText: task.text },
          })),
        }),
      ]);
    }

    function render() {
      const remaining = state.tasks.filter((task) => !task.done).length;
      const done = state.tasks.length - remaining;
      summary.textContent = `${remaining} open · ${done} done`;

      banner.textContent = state.error;
      banner.dataset.visible = String(Boolean(state.error));

      storageLabel.textContent = state.file ? `saved to ${state.file}` : '';
      storageLabel.title = state.file; // full path, since the label ellipsizes
      clearButton.disabled = state.busy || done === 0;

      for (const { value, button } of tabButtons) {
        button.dataset.active = String(state.filter === value);
        button.setAttribute('aria-selected', String(state.filter === value));
      }

      const { filter } = state;
      const visible = state.tasks.filter((task) =>
        filter === 'all' ||
        (filter === 'active' && !task.done) ||
        (filter === 'done' && task.done));

      clear(listEl);
      if (visible.length === 0) {
        listEl.append(el('div', { class: 'todo-empty', text: EMPTY_LABEL[state.filter] }));
      } else {
        for (const task of visible) listEl.append(renderRow(task));
      }
    }

    render();
    load();

    return () => clear(host);
  },
};
