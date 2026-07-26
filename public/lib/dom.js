/** @typedef {import('../../types.d.ts').HttpError} HttpError */

/** @typedef {Node | string | false | null | undefined} Child */

/**
 * Minimal DOM helper. Text always goes through textContent — todo text comes
 * from a markdown file on disk and must never be parsed as HTML.
 *
 * Generic over the tag name so callers get the concrete element type back —
 * `el('input', …)` is an HTMLInputElement, with `.value` and `.disabled`
 * checked rather than cast.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [props]
 * @param {Child | Child[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // only ever called with literals we author
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list') /** @type {any} */ (node)[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }

  for (const child of [children].flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/**
 * @template {Element} T
 * @param {T} node
 * @returns {T}
 */
export function clear(node) {
  node.replaceChildren();
  return node;
}

/**
 * Look up a required element. Throws rather than returning null, so a rename in
 * index.html fails immediately instead of somewhere further down.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node;
}

/**
 * Fetch JSON, turning a non-2xx into an Error carrying the server's message.
 *
 * Returns `any`: responses are validated by the server, and the client's own
 * expectations are pinned by the Task type where it matters.
 *
 * @param {string} url
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
export async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    method: options.method,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = /** @type {HttpError} */ (
      new Error(payload.error || `Request failed (${response.status})`)
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}
