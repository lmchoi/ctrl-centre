import { el } from './dom.js';

/**
 * Design-system pieces that more than one panel builds identically.
 *
 * Deliberately not in `dom.js`: that file is a minimal DOM helper whose `html`
 * option is justified by "only ever called with literals we author". These
 * builders take caller-supplied *elements*, never strings, so nothing here can
 * become a route for file-sourced text into `innerHTML`.
 *
 * Only what two real call sites justify lives here. See docs/adr/0008.
 */

/**
 * The card scaffold: header with a title and a description line, a content
 * area, and an optional footer. Both panels built this identically.
 *
 * @param {object} parts
 * @param {string} parts.title
 * @param {HTMLElement} parts.description element, so the panel can keep
 *   updating it after mount
 * @param {(HTMLElement | Text)[]} parts.content
 * @param {(HTMLElement | Text)[]} [parts.footer] omitted means no footer node
 * @returns {HTMLElement}
 */
export function card({ title, description, content, footer }) {
  /** @type {HTMLElement[]} */
  const children = [
    el('div', { class: 'card-header' }, [
      el('h2', { class: 'card-title', text: title }),
      description,
    ]),
    el('div', { class: 'card-content' }, content),
  ];
  if (footer) children.push(el('div', { class: 'card-footer' }, footer));
  return el('section', { class: 'card' }, children);
}

/**
 * The error banner and its update rule. Extracted for the update, not the
 * markup: both panels set the same two properties, and `data-visible` driving
 * the CSS is the kind of detail that silently diverges when it is written
 * twice.
 *
 * @returns {{ element: HTMLElement, show(message: string): void }}
 */
export function banner() {
  const element = el('div', { class: 'banner', role: 'status' });
  return {
    element,
    /** @param {string} message empty string hides it */
    show(message) {
      element.textContent = message;
      element.dataset.visible = String(Boolean(message));
    },
  };
}

/**
 * The footer label naming the file on disk. `className` stays a parameter so
 * each panel keeps its own styling hook and the rendered markup is unchanged
 * by this extraction.
 *
 * @param {string} className
 * @returns {{ element: HTMLElement, show(file: string): void }}
 */
export function storageLabel(className) {
  const element = el('span', { class: `mono ${className}`, text: '' });
  return {
    element,
    /** @param {string} file resolved path, already display-formatted */
    show(file) {
      element.textContent = file ? `saved to ${file}` : '';
      element.title = file; // full path, since the label ellipsizes
    },
  };
}
