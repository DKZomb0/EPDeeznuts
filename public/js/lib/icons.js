/**
 * Line icons, inline.
 *
 * Het ontwerp gebruikt Phosphor via een CDN. Die afhankelijkheid is hier
 * vervangen door een eigen set in dezelfde tekenstijl — 24-raster, streek 1,6,
 * ronde uiteinden — omdat de toepassing ook moet starten op een laptop zonder
 * netwerk. Eén familie, één streekbreedte, geen vullingen.
 */

const P = {
  stack: 'M12 3 3 8l9 5 9-5-9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5',
  lock: 'M5 10h14v10H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v2',
  lockOpen: 'M5 10h14v10H5z M8 10V7a4 4 0 0 1 7.5-2 M12 14v2',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3.5 6h1 M3.5 12h1 M3.5 18h1',
  calculator: 'M5 3h14v18H5z M8 7h8 M8.5 11.5h.01 M12 11.5h.01 M15.5 11.5h.01 M8.5 15.5h.01 M12 15.5h.01 M15.5 15.5h.01',
  truck: 'M2 7h11v10H2z M13 10h4l4 4v3h-8 M6.5 17.5a2 2 0 1 0 0 .01 M17.5 17.5a2 2 0 1 0 0 .01',
  sealCheck:
    'M12 2.5l2.2 1.9 2.9-.3 1 2.7 2.6 1.3-.9 2.8.9 2.8-2.6 1.3-1 2.7-2.9-.3L12 21.5l-2.2-1.9-2.9.3-1-2.7-2.6-1.3.9-2.8-.9-2.8 2.6-1.3 1-2.7 2.9.3Z M9 12l2 2 4-4',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  plug: 'M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v4',
  plus: 'M12 5v14 M5 12h14',
  funnel: 'M3 5h18l-7 8v6l-4 2v-8z',
  warningCircle: 'M12 3a9 9 0 1 0 .01 0 M12 8v5 M12 16.5h.01',
  warning: 'M12 3.5 2.5 20h19z M12 10v4 M12 17h.01',
  arrowRight: 'M4 12h15 M13 6l6 6-6 6',
  arrowLeft: 'M20 12H5 M11 6l-6 6 6 6',
  caretRight: 'M9 5l7 7-7 7',
  caretDown: 'M5 9l7 7 7-7',
  paperclip: 'M20 11.5l-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8',
  check: 'M4 12.5l5 5L20 6.5',
  checkCircle: 'M12 3a9 9 0 1 0 .01 0 M8 12l3 3 5-5.5',
  prohibit: 'M12 3a9 9 0 1 0 .01 0 M5.6 5.6l12.8 12.8',
  xCircle: 'M12 3a9 9 0 1 0 .01 0 M9 9l6 6 M15 9l-6 6',
  x: 'M6 6l12 12 M18 6L6 18',
  lightning: 'M13 2 4 14h7l-1 8 9-12h-7z',
  send: 'M21 3 3 10.5l7 3 3 7z M10 13.5 21 3',
  hourglass: 'M7 3h10 M7 21h10 M7 3c0 5 5 6 5 9s-5 4-5 9 M17 3c0 5-5 6-5 9s5 4 5 9',
  upload: 'M12 17V4 M7 9l5-5 5 5 M4 20h16',
  download: 'M12 4v13 M7 12l5 5 5-5 M4 20h16',
  search: 'M11 4a7 7 0 1 0 .01 0 M16 16l4.5 4.5',
  signOut: 'M14 4h5v16h-5 M10 8l-4 4 4 4 M6 12h9',
  bell: 'M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6 M10 20a2.2 2.2 0 0 0 4 0',
  clipboard: 'M9 4h6v3H9z M15 5.5h3V21H6V5.5h3 M9 11h6 M9 15h4',
  buildings: 'M3 21V8l7-4v17 M10 12h8v9 M13.5 15.5h.01 M13.5 18.5h.01 M6 11h.01 M6 14.5h.01 M6 18h.01',
  gear: 'M12 8.5a3.5 3.5 0 1 0 .01 0 M19.5 12l1.7-1.3-1.6-3-2 .7-1.8-1 -.3-2.1h-3.4l-.3 2.1-1.8 1-2-.7-1.6 3L8.1 12l-1.7 1.3 1.6 3 2-.7 1.8 1 .3 2.1h3.4l.3-2.1 1.8-1 2 .7 1.6-3z',
  fileText: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6',
  users: 'M9 11a3.5 3.5 0 1 0 .01 0 M3 20c0-3 2.7-5 6-5s6 2 6 5 M16 11.2a3.2 3.2 0 1 0-.01-6.4 M17 15.3c2.4.4 4 2.2 4 4.7',
  factory: 'M3 21V10l5 3V10l5 3V10l5 3v8z M6.5 17h.01 M11 17h.01 M15.5 17h.01',
  flask: 'M10 3h4 M11 3v6L5 19a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 19l-6-10V3 M7.5 14h9',
  scales: 'M12 4v16 M7 20h10 M4 8h16 M4 8 1.5 14h5zM20 8l2.5 6h-5z',
  clock: 'M12 3a9 9 0 1 0 .01 0 M12 7v5.2l3.2 2',
  info: 'M12 3a9 9 0 1 0 .01 0 M12 11v5.5 M12 7.5h.01',
  dots: 'M6 12h.01 M12 12h.01 M18 12h.01',
  eye: 'M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6Z M12 9.2a2.8 2.8 0 1 0 .01 0',
  eyeOff: 'M4 4l16 16 M9.5 9.7A2.8 2.8 0 0 0 12 14.8 M6.3 6.6C3.6 8.3 2 12 2 12s3.8 6 10 6c1.7 0 3.2-.4 4.5-1.1 M12 6c6.2 0 10 6 10 6s-.9 1.4-2.5 2.9',
  printer: 'M7 8V3h10v5 M7 17H4V8h16v9h-3 M7 13h10v8H7z',
  link: 'M10 13a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6 M14 11a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1 M3 4v4h4 M12 7.5V12l3 1.8',
  shieldCheck: 'M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6z M9 12l2.2 2.2L15.5 10',
  minus: 'M5 12h14',
  drop: 'M12 3.5S5.5 10.6 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.6 12 3.5 12 3.5Z',
};

export const ICON_NAMES = Object.keys(P);

/**
 * @param {string} name   sleutel uit de set hierboven
 * @param {object} [opts] { size = 17, className, title }
 */
export function icon(name, opts = {}) {
  const size = opts.size ?? 17;
  const d = P[name];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', ['icon', opts.className].filter(Boolean).join(' '));
  svg.setAttribute('aria-hidden', opts.title ? 'false' : 'true');
  if (opts.title) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = opts.title;
    svg.appendChild(t);
  }

  if (!d) {
    // Een ontbrekend icoon mag de pagina niet breken; een stip is duidelijk
    // genoeg als teken dat er een naam fout staat.
    svg.setAttribute('stroke-width', '2.4');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    dot.setAttribute('d', 'M12 12h.01');
    svg.appendChild(dot);
    return svg;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}
