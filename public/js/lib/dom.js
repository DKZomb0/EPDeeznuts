/**
 * A ~60 line hyperscript helper.
 *
 * The client has no build step and no framework, so this is the whole view
 * layer: `h(tag, props, ...children)` plus a mount that swaps children. Views
 * re-render whole sections rather than diffing, which at this data volume is
 * both fast enough and much easier to reason about.
 */

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key === 'html') {
      // Only ever used with strings this application generated itself.
      el.innerHTML = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace everything inside `target` with `children`. */
export function mount(target, ...children) {
  target.replaceChildren();
  append(target, children);
  return target;
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
};

/** Shorthands for the tags this app actually uses. */
const TAGS = [
  'div', 'span', 'p', 'a', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'th', 'td', 'form', 'label', 'input', 'select', 'option', 'textarea', 'button', 'strong',
  'em', 'small', 'code', 'pre', 'i', 'b', 'img', 'hr', 'br', 'caption', 'colgroup', 'col', 'fieldset', 'legend',
];

export const tags = Object.fromEntries(TAGS.map((tag) => [tag, (...args) => build(tag, args)]));

function build(tag, args) {
  const [first, ...rest] = args;
  const hasProps = first !== null && typeof first === 'object' && !(first instanceof Node) && !Array.isArray(first);
  return hasProps ? h(tag, first, ...rest) : h(tag, null, ...args);
}

/** Delegate a click on any element matching `selector` inside `root`. */
export function onClick(root, selector, handler) {
  root.addEventListener('click', (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
}

/** Read a form into a plain object; unchecked boxes become false. */
export function formData(form) {
  const out = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    if (element.type === 'checkbox') out[element.name] = element.checked;
    else if (element.type === 'number') out[element.name] = element.value === '' ? null : Number(element.value);
    else out[element.name] = element.value;
  }
  return out;
}
