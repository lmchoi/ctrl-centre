import { el, clear, api } from '../lib/dom.js';

/**
 * @typedef {import('../../types.d.ts').JournalEntry} JournalEntry
 * @typedef {import('../../types.d.ts').Panel} Panel
 * @typedef {import('../../types.d.ts').HttpError} HttpError
 */

/**
 * `YYYY-MM-DD HH:MM`, local wall-clock — the client's clock stamps the entry,
 * not the server's (see docs/plans/journal-panel.md).
 * @returns {string}
 */
function nowTimestamp() {
  const now = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * The store gives `timestamp` as `YYYY-MM-DD HH:MM` local wall-clock — parse
 * it as local time via the `T`-separated form, not `Date.parse` of the raw
 * space-separated string, which is not reliably local across engines.
 * @param {string} timestamp
 * @returns {string}
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return timestamp;
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

/** @type {Panel} */
export const journalPanel = {
  id: 'journal',
  label: 'Journal',
  icon: '◨',
  title: 'Journal',

  mount(host) {
    /**
     * @type {{ entries: JournalEntry[], file: string, error: string, busy: boolean }}
     */
    const state = { entries: [], file: '', error: '', busy: false };

    // --- Persistent chrome (built once, contents re-rendered on change) ---
    const summary = el('p', { class: 'card-desc', text: '—' });
    const banner = el('div', { class: 'banner', role: 'status' });
    const listEl = el('div', { class: 'journal-list' });
    const storageLabel = el('span', { class: 'mono journal-storage', text: '' });

    const draftText = el('textarea', {
      class: 'field',
      placeholder: "Write today's entry…",
      'aria-label': 'Journal entry',
      style: 'height:80px;',
    });

    const saveButton = el('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: 'Save entry',
      style: 'align-self:flex-end;',
      onclick: () => saveEntry(),
    });

    const card = el('section', { class: 'card' }, [
      el('div', { class: 'card-header' }, [
        el('h2', { class: 'card-title', text: 'Journal' }),
        summary,
      ]),
      el('div', { class: 'card-content' }, [
        banner,
        el('div', { class: 'journal-compose' }, [draftText, saveButton]),
        listEl,
      ]),
      el('div', { class: 'card-footer' }, [storageLabel]),
    ]);

    clear(host).append(card);

    // --- Data flow ---

    /**
     * Run a mutation, adopting the fresh entry list the server returns.
     * @param {() => Promise<{ entries?: JournalEntry[] }>} action
     */
    async function run(action) {
      if (state.busy) return;
      state.busy = true;
      setBusy(true);
      try {
        const payload = await action();
        if (payload.entries) state.entries = payload.entries;
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
        const payload = await api('/api/journal');
        state.entries = payload.entries;
        state.file = payload.file;
        if (!keepError) state.error = '';
      } catch (err) {
        state.error = /** @type {HttpError} */ (err).message;
      }
      render();
    }

    function saveEntry() {
      const text = draftText.value.trim();
      if (!text) {
        draftText.focus();
        return;
      }
      run(async () => {
        const payload = await api('/api/journal', {
          method: 'POST',
          body: { text, timestamp: nowTimestamp() },
        });
        draftText.value = '';
        draftText.focus();
        return payload;
      });
    }

    /** @param {boolean} busy */
    function setBusy(busy) {
      for (const node of [draftText, saveButton]) node.disabled = busy;
    }

    // --- Rendering ---

    /**
     * @param {JournalEntry} entry
     * @returns {HTMLElement}
     */
    function renderRow(entry) {
      return el('div', { class: 'journal-row' }, [
        el('div', { class: 'journal-row-header' }, [
          el('span', { class: 'mono journal-date', text: formatTimestamp(entry.timestamp) }),
          el('button', {
            class: 'btn btn-ghost btn-icon',
            type: 'button',
            text: '×',
            title: 'Delete',
            'aria-label': `Delete entry from ${entry.timestamp}`,
            style: 'width:30px;height:30px;font-size:16px;',
            onclick: () => run(() => api('/api/journal/delete', {
              method: 'POST',
              body: { ordinal: entry.ordinal, expectedText: entry.text },
            })),
          }),
        ]),
        el('div', { class: 'journal-text', text: entry.text }),
      ]);
    }

    function render() {
      summary.textContent = state.entries.length === 1
        ? '1 entry'
        : `${state.entries.length} entries`;

      banner.textContent = state.error;
      banner.dataset.visible = String(Boolean(state.error));

      storageLabel.textContent = state.file ? `saved to ${state.file}` : '';
      storageLabel.title = state.file; // full path, since the label ellipsizes

      clear(listEl);
      if (state.entries.length === 0) {
        listEl.append(el('div', {
          class: 'journal-empty',
          text: 'No entries yet — write your first above.',
        }));
      } else {
        for (const entry of state.entries) listEl.append(renderRow(entry));
      }
    }

    render();
    load();

    return () => clear(host);
  },
};
