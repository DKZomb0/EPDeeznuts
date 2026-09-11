/**
 * Gedeelde interface-onderdelen, op het nocturne-designsysteem.
 *
 * Eén plek, zodat het oordeel "geldig / met opmerking / ongeldig" er overal
 * identiek uitziet — in de catalogus, in het rekenblad en in het
 * verificatiedossier. Daar hangt het hele platform aan vast.
 */
import { h, tags, mount } from './dom.js';
import { icon } from './icons.js';
import { num, smart, pct, date, dateTime, VERDICT_TAG, STATUS_TAG, EVIDENCE_TAG, GATE_LABELS } from './format.js';

const { div, span, p, h1, h2, table, thead, tbody, tr, th, td, button, label, input, select, option, textarea, dl, dt, dd, form, strong, small, ul, li, a } = tags;

let reference = {};
export function setReference(ref) {
  reference = ref ?? {};
}
export function ref() {
  return reference;
}

/* ------------------------------------------------------------------ */
/* Vlakken                                                             */
/* ------------------------------------------------------------------ */

/**
 * Een oppervlak. `variant: 'table'` haalt de padding weg zodat een tabel tot
 * aan de rand loopt, zoals in het ontwerp.
 */
export function panel({ kicker, title, sub, actions, body, variant, foot, className } = {}) {
  const hasHead = kicker || title || sub || actions;
  return div(
    { class: ['panel', variant === 'table' && 'panel--table', variant === 'flush' && 'panel--flush', className] },
    hasHead
      ? div(
          { class: 'panel__head panel__head--plain' },
          div(
            { class: 'grow' },
            kicker && div({ class: 'panel__kicker' }, kicker),
            title && div({ class: 'panel__title' }, title),
            sub && div({ class: 'panel__sub' }, sub),
          ),
          actions && div({ class: 'panel__actions' }, actions),
        )
      : null,
    body,
    foot && div({ class: 'panel__sub mt-2' }, foot),
  );
}

/** Het kleine toelichtingskaartje uit het ontwerp. */
export function card({ kicker, title, body, className }) {
  return div(
    { class: ['card', 'elev-sm', className] },
    kicker && div({ class: 'card-kicker' }, kicker),
    title && div({ class: 'card-title' }, title),
    body && p({ class: 'card-body' }, body),
  );
}

/** KPI-strip: één vlak, haarlijnen ertussen. */
export function kpiStrip(items) {
  return div(
    { class: 'kpis' },
    items.map((item) =>
      div(
        { class: ['kpi', item.tone && `kpi--${item.tone}`] },
        div({ class: 'kpi__label' }, item.label),
        div({ class: 'kpi__value' }, item.value),
        item.note && div({ class: 'kpi__note' }, item.note),
      ),
    ),
  );
}

/** Groot cijfer met eenheid ernaast. */
export function figure(value, unit) {
  return div({ class: 'figure' }, span({ class: 'figure__value' }, value), span({ class: 'figure__unit' }, unit));
}

/* ------------------------------------------------------------------ */
/* Banners                                                             */
/* ------------------------------------------------------------------ */

const BANNER_ICON = { accent: 'checkCircle', warn: 'warning', neutral: 'prohibit', plain: 'info' };

export function banner(tone, { icon: iconName, title, body, actions } = {}) {
  return div(
    { class: ['banner', tone !== 'accent' && `banner--${tone}`] },
    icon(iconName ?? BANNER_ICON[tone] ?? 'info', { size: 19, className: 'banner__icon' }),
    div({ class: 'grow' }, title && div({ class: 'banner__title' }, title), body && div({}, body)),
    actions && div({ class: 'btn-row' }, actions),
  );
}

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

export function tag(text, cls = 'tag-quiet', opts = {}) {
  return span({ class: `tag ${cls}`, title: opts.title ?? '' }, opts.icon ? icon(opts.icon, { size: 13 }) : null, text);
}

export function verdictTag(verdict) {
  const meta = reference.verdicts?.[verdict];
  return tag(meta?.label ?? verdict ?? '—', VERDICT_TAG[verdict] ?? 'tag-quiet', { title: meta?.description ?? '' });
}

export function statusTag(status, labels = reference.declarationStatusLabels) {
  return tag(labels?.[status] ?? status ?? '—', STATUS_TAG[status] ?? 'tag-quiet');
}

export function evidenceTag(type) {
  if (!type) return tag('Geen bron', 'tag-neutral');
  const meta = reference.evidenceTypes?.[type];
  return tag(meta?.short ?? type, EVIDENCE_TAG[type] ?? 'tag-quiet', { title: meta?.description ?? '' });
}

/* ------------------------------------------------------------------ */
/* Tabel                                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<{label,render,align,width,wrap}>} columns
 * @param {Array<object>} rows
 * @param {object} [options] { onRow, emptyTitle, emptyText, foot }
 */
export function dataTable(columns, rows, options = {}) {
  const cols = columns.filter(Boolean);
  if (!rows?.length) return empty(options.emptyTitle ?? 'Nog niets te tonen', options.emptyText);

  return table(
    { class: 'table' },
    thead(
      {},
      tr(
        {},
        cols.map((col) =>
          th({ class: col.wrap ? 'wrap' : '', style: { textAlign: col.align ?? 'left', ...(col.width ? { width: col.width } : {}) } }, col.label),
        ),
      ),
    ),
    tbody(
      {},
      rows.map((row) =>
        tr(
          { class: [options.onRow && 'is-clickable', options.rowClass?.(row)], onClick: options.onRow ? () => options.onRow(row) : undefined },
          cols.map((col) =>
            td(
              { class: [col.align === 'right' ? 'num' : '', col.wrap ? 'wrap' : '', col.muted ? 'muted-cell' : ''], style: { textAlign: col.align ?? 'left' } },
              col.render ? col.render(row) : row[col.key] ?? '—',
            ),
          ),
        ),
      ),
    ),
    options.foot ? h('tfoot', {}, options.foot) : null,
  );
}

/** Tabel in een eigen vlak, zoals het ontwerp ze overal zet. */
export function tablePanel(columns, rows, options = {}) {
  return panel({ variant: 'table', body: dataTable(columns, rows, options), className: options.className });
}

export function kv(entries) {
  return dl(
    { class: 'kv' },
    entries.filter(Boolean).flatMap(([term, value]) => [dt({}, term), dd({}, value ?? '—')]),
  );
}

export function empty(title, hint, action) {
  return div({ class: 'empty' }, div({ class: 'empty__title' }, title), hint && p({}, hint), action && div({ class: 'mt-2' }, action));
}

export function loading(text = 'Bezig met laden…') {
  return div({ class: 'empty' }, text);
}

/* ------------------------------------------------------------------ */
/* Knoppen en schakelaars                                              */
/* ------------------------------------------------------------------ */

export function btn(text, { variant = 'secondary', icon: iconName, onClick, href, small: isSmall, disabled, title } = {}) {
  const children = [iconName ? icon(iconName, { size: 15 }) : null, text];
  const className = ['btn', `btn-${variant}`, isSmall && 'btn-sm'];
  if (href) return a({ class: className, href, title }, ...children);
  return button({ class: className, onClick, disabled, title, type: 'button' }, ...children);
}

/** Segmentkeuze. `options: [{key,label}]` */
export function seg(options, active, onPick) {
  return div(
    { class: 'seg' },
    options.map((o) =>
      button(
        { class: ['seg-opt', o.key === active && 'is-active'], onClick: () => onPick(o.key), type: 'button' },
        o.label,
      ),
    ),
  );
}

export function tabs(items, active, onSelect) {
  return div(
    { class: 'tabs' },
    items.map((item) => button({ class: item.key === active ? 'is-active' : '', onClick: () => onSelect(item.key), type: 'button' }, item.label)),
  );
}

/* ------------------------------------------------------------------ */
/* Formuliervelden                                                     */
/* ------------------------------------------------------------------ */

export function field(labelText, control, { hint, required, style } = {}) {
  return div(
    { class: 'field', style },
    labelText ? label({}, labelText, required && span({ class: 'field__req' }, ' *')) : null,
    control,
    hint && div({ class: 'field__hint' }, hint),
  );
}

export function textField(name, labelText, options = {}) {
  return field(
    labelText,
    input({
      class: 'input',
      type: options.type ?? 'text',
      name,
      value: options.value ?? '',
      placeholder: options.placeholder ?? '',
      required: options.required,
      step: options.step,
      min: options.min,
      max: options.max,
      disabled: options.disabled,
    }),
    options,
  );
}

export function selectField(name, labelText, options, opts = {}) {
  return field(
    labelText,
    select(
      { name, required: opts.required, disabled: opts.disabled },
      opts.placeholder !== false && option({ value: '' }, opts.placeholder ?? '— kies —'),
      options.map((o) => option({ value: o.value, selected: String(o.value) === String(opts.value) }, o.label)),
    ),
    opts,
  );
}

export function textAreaField(name, labelText, options = {}) {
  return field(labelText, textarea({ class: 'input', name, placeholder: options.placeholder ?? '', required: options.required }, options.value ?? ''), options);
}

export function checkField(name, labelText, options = {}) {
  return div(
    { class: 'field' },
    label(
      { class: 'flex', style: { cursor: 'pointer', fontSize: '13px' } },
      input({ type: 'checkbox', name, checked: !!options.value }),
      span({}, labelText),
    ),
    options.hint && div({ class: 'field__hint' }, options.hint),
  );
}

/** Keuzerij met radio, zoals de bronkeuze in het ontwerp. */
export function pickRow({ active, name, value, title, meta, right, tagEl, onPick }) {
  return label(
    { class: ['pickrow', active && 'is-active'] },
    span(
      { class: 'radio' },
      input({ type: 'radio', name, value, checked: !!active, onChange: () => onPick?.(value) }),
      span({ class: 'dot' }),
    ),
    span({ class: 'pickrow__main' }, span({ class: 'pickrow__name' }, title), meta && span({ class: 'pickrow__meta' }, meta)),
    right && span({ class: 'tnum small dim nowrap' }, right),
    tagEl,
  );
}

export function checkRow({ active, label: text, value, onToggle }) {
  return label(
    { class: ['checkrow', active && 'is-active'] },
    input({ type: 'checkbox', checked: !!active, onChange: () => onToggle?.() }),
    span({ class: 'grow' }, text),
    value && span({ class: 'tnum small dim' }, value),
  );
}

/* ------------------------------------------------------------------ */
/* Grafiek-achtige onderdelen                                          */
/* ------------------------------------------------------------------ */

/** Horizontale balkjes met labels, zoals de A1/A2/A3-verdeling. */
export function barLines(entries, { unit = '', quiet = false } = {}) {
  const max = Math.max(...entries.map((e) => Math.abs(e.value)), 1);
  return div(
    { class: 'flex-col', style: { gap: '5.6px' } },
    entries.map((e) =>
      div(
        { class: 'barline' },
        span({ class: 'barline__label' }, e.label),
        span(
          { class: 'bar', title: `${smart(e.value)} ${unit}` },
          span({ class: ['bar__fill', quiet && 'bar__fill--quiet'], style: { width: `${(Math.abs(e.value) / max) * 100}%` } }),
        ),
        span({ class: 'barline__value' }, smart(e.value)),
      ),
    ),
  );
}

/** Min–gemiddelde–max als een span met een streep, voor de spreiding. */
export function rangeBar({ min, max, mean, scaleMax }) {
  const top = scaleMax || max || 1;
  return span(
    { class: 'rangebar', title: `min ${smart(min)} · gemiddelde ${smart(mean)} · max ${smart(max)}` },
    span({ class: 'rangebar__span', style: { left: `${(min / top) * 100}%`, width: `${Math.max(1.5, ((max - min) / top) * 100)}%` } }),
    span({ class: 'rangebar__mean', style: { left: `${(mean / top) * 100}%` } }),
  );
}

/* ------------------------------------------------------------------ */
/* Berekening                                                          */
/* ------------------------------------------------------------------ */

/**
 * De trace: elke term met formule, factor, bron en bewijsstuk. Dit is het
 * onderdeel waar de administratie op toetst, dus het staat er voluit.
 */
export function traceView(modules, unit) {
  return div(
    { class: 'trace' },
    modules.map((module) =>
      div(
        { class: 'trace__module' },
        div(
          { class: 'trace__head' },
          span({ class: 'trace__code' }, module.code),
          div({ class: 'grow' }, div({ class: 'trace__name' }, module.label), div({ class: 'trace__desc' }, module.description)),
          span({ class: 'trace__sum' }, `${smart(module.subtotal)} ${unit}`),
        ),
        module.lines.length
          ? module.lines.map((line) => traceLine(line, unit))
          : div({ class: 'trace__line' }, div({ class: 'muted small' }, 'Geen bijdragen in deze module.')),
      ),
    ),
  );
}

function traceLine(line, unit) {
  return div(
    { class: 'trace__line' },
    div(
      {},
      div({ class: 'trace__label' }, line.label),
      line.detail && div({ class: 'trace__meta' }, line.detail),
      div(
        { class: 'flex gap-sm mt-1', style: { flexWrap: 'wrap' } },
        line.evidence?.type ? evidenceTag(line.evidence.type) : null,
        line.evidence?.number ? span({ class: 'tiny muted mono' }, line.evidence.number) : null,
        line.overridden ? tag('Eigen waarde', 'tag-outline') : null,
      ),
    ),
    div(
      {},
      div({ class: 'trace__formula' }, line.formula),
      line.factor?.source && div({ class: 'trace__source' }, `Bron: ${line.factor.source}`),
      line.justification && div({ class: 'trace__source' }, `Verantwoording: ${line.justification}`),
    ),
    div({ class: 'trace__value' }, smart(line.values?.GWP_TOTAL ?? 0), small({ class: 'muted' }, ` ${unit}`)),
  );
}

/** Toetsenlijst van de wijzigingscontrole of de leveringscontrole. */
export function checklist(items) {
  return ul(
    { class: 'checklist' },
    items.map((item) =>
      li(
        {},
        icon(item.passed ? 'check' : 'x', { size: 15, className: `checklist__mark checklist__mark--${item.passed ? 'pass' : 'fail'}` }),
        div({ class: 'grow' }, item.message),
      ),
    ),
  );
}

export function logList(entries, { limit = 12 } = {}) {
  if (!entries?.length) return div({ class: 'muted small' }, 'Nog geen registraties.');
  return div(
    { class: 'flex-col', style: { gap: '8.4px' } },
    entries.slice(0, limit).map((e) =>
      div(
        { class: 'logrow' },
        span({ class: 'logrow__when' }, shortWhen(e.ts ?? e.created_at)),
        span({ class: 'logrow__what' }, strong({}, e.actor_label ?? e.title ?? 'Systeem'), ' ', e.summary ?? e.body ?? ''),
      ),
    ),
  );
}

function shortWhen(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(today.getTime() - 86400_000);
  if (d.toDateString() === yesterday.toDateString()) return 'gisteren';
  return date(value);
}

/* ------------------------------------------------------------------ */
/* Paginakop                                                           */
/* ------------------------------------------------------------------ */

export function pageHead({ crumb, title, lede, actions }) {
  return div(
    { class: 'pagehead' },
    div(
      { class: 'pagehead__text' },
      crumb && crumbBar(crumb),
      h1({}, title),
      lede && p({ class: 'pagehead__lede' }, lede),
    ),
    actions ? div({ class: 'pagehead__actions' }, actions) : null,
  );
}

function crumbBar(items) {
  const parts = [];
  items.forEach((item, i) => {
    if (i) parts.push(icon('caretRight', { size: 11 }));
    parts.push(item.onClick ? button({ onClick: item.onClick, type: 'button' }, item.label) : span({}, item.label));
  });
  return div({ class: 'crumb' }, parts);
}

/* ------------------------------------------------------------------ */
/* Modal en toast                                                      */
/* ------------------------------------------------------------------ */

export function modal({ title, hint, body, actions, wide = false, onClose }) {
  const backdrop = div({ class: 'modal-backdrop' });

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);

  mount(
    backdrop,
    div(
      { class: ['modal', wide && 'modal--wide'] },
      div(
        { class: 'modal__head' },
        div({ class: 'grow' }, div({ class: 'panel__title' }, title), hint && div({ class: 'panel__sub' }, hint)),
        button({ class: 'modal__close', onClick: close, 'aria-label': 'Sluiten', type: 'button' }, icon('x', { size: 18 })),
      ),
      div({ class: 'modal__body' }, typeof body === 'function' ? body(close) : body),
      actions && div({ class: 'modal__foot' }, typeof actions === 'function' ? actions(close) : actions),
    ),
  );

  document.body.appendChild(backdrop);
  backdrop.querySelector('input, select, textarea')?.focus();
  return { close, element: backdrop };
}

/** Modal met formulier; `onSubmit` krijgt de ingevulde waarden. */
export function formModal({ title, hint, fields, submitLabel = 'Opslaan', submitIcon, onSubmit, wide }) {
  let formEl;
  return modal({
    title,
    hint,
    wide,
    body: () => {
      formEl = form({ onSubmit: (e) => e.preventDefault(), class: 'flex-col', style: { gap: '11.2px' } }, fields.filter(Boolean));
      return formEl;
    },
    actions: (close) => [
      btn('Annuleren', { variant: 'ghost', onClick: close }),
      btn(submitLabel, {
        variant: 'primary',
        icon: submitIcon,
        onClick: async (event) => {
          const target = event.currentTarget;
          if (!formEl.reportValidity()) return;
          target.disabled = true;
          try {
            const { formData } = await import('./dom.js');
            await onSubmit(formData(formEl), close);
          } catch (err) {
            toast(err.message, 'bad');
          } finally {
            target.disabled = false;
          }
        },
      }),
    ],
  });
}

let toastHost = null;
export function toast(message, tone = '') {
  if (!toastHost) {
    toastHost = div({ class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const el = div(
    { class: ['toast', tone === 'ok' && 'toast--ok'] },
    icon(tone === 'bad' ? 'warning' : tone === 'ok' ? 'check' : 'info', { size: 16 }),
    div({ class: 'grow' }, message),
  );
  toastHost.appendChild(el);
  setTimeout(
    () => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    },
    tone === 'bad' ? 6000 : 3600,
  );
}

export { num, smart, pct, date, dateTime, icon, GATE_LABELS };
