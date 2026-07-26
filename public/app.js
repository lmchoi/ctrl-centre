import { el, clear } from './lib/dom.js';
import { todoPanel } from './panels/todo.js';

/**
 * Panel registry. To add a panel later: write `panels/<name>.js` exporting a
 * panel object ({ id, label, icon, title, mount(host) → cleanup }), import it,
 * and swap it in for the `panel: null` placeholder below.
 */
const PANELS = [
  { id: 'overview', label: 'Overview', icon: '◧', panel: null },
  { id: 'tasks', label: 'Tasks', icon: '☑', panel: todoPanel },
  { id: 'habits', label: 'Habits', icon: '◔', panel: null },
  { id: 'systems', label: 'Systems', icon: '▣', panel: null },
  { id: 'notes', label: 'Notes', icon: '▤', panel: null },
];

const nav = document.getElementById('nav');
const panelHost = document.getElementById('panel-host');
const panelTitle = document.getElementById('panel-title');
const clock = document.getElementById('clock');

let activeId = null;
let unmountActive = null;

function activate(entry) {
  if (!entry.panel || entry.id === activeId) return;

  if (unmountActive) unmountActive();
  activeId = entry.id;

  panelTitle.textContent = entry.panel.title ?? entry.label;
  document.title = `${entry.label} · Ctrl Centre`;
  unmountActive = entry.panel.mount(clear(panelHost)) ?? null;

  for (const button of nav.querySelectorAll('.nav-item')) {
    const isActive = button.dataset.panelId === activeId;
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

for (const entry of PANELS) {
  nav.append(el('button', {
    class: 'nav-item',
    type: 'button',
    disabled: !entry.panel,
    // Spell the panel name into the accessible name — a bare "Coming soon"
    // title leaves screen readers with five identical buttons.
    title: entry.panel ? undefined : `${entry.label} — coming soon`,
    'aria-label': entry.panel ? undefined : `${entry.label} — coming soon`,
    'data-panel-id': entry.id,
    onclick: () => activate(entry),
  }, [
    el('span', { class: 'nav-icon', text: entry.icon }),
    document.createTextNode(entry.label),
  ]));
}

function tickClock() {
  clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
tickClock();
setInterval(tickClock, 1000);

activate(PANELS.find((entry) => entry.panel));
