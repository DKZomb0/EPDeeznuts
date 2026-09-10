/**
 * Shared interface pieces.
 *
 * Kept in one place so the verdict badge on the catalogue and the verdict badge
 * inside a verification dossier are literally the same component - the whole
 * platform hinges on people reading those three states consistently.
 */
import { h, tags, mount } from './dom.js';
import { num, smart, pct, date, dateTime, VERDICT_TONE, STATUS_TONE, EVIDENCE_TONE, GATE_LABELS } from './format.js';

const { div, span, p, h2, h3, table, thead, tbody, tr, th, td, button, label, input, select, option, textarea, ul, li, dl, dt, dd, form, strong, small } = tags;

let reference = {};
export function setReference(ref) {
  reference = ref ?? {};
}
export function ref() {
  return reference;
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export function card(title, body, options = {}) {
  return div(
    { class: ['card', options.class] },
    title &&
      div(
        { class: 'card__head' },
        div({}, div({ class: 'card__title' }, title), options.hint && div({ class: 'card__hint' }, options.hint)),
        options.actions && div({ class: 'btn-row' }, options.actions),
      ),
    div({ class: options.flush ? 'card__body card__body--flush' : 'card__body' }, body),
    options.footer && div({ class: 'card__foot' }, options.footer),
  );
}

export function stat({ label: text, value, unit, note, tone }) {
  return div(
    { class: ['stat', tone && `stat--${tone}`] },
    div({ class: 'stat__label' }, text),
    div({ class: 'stat__value' }, value, unit && span({ class: 'stat__unit' }, unit)),
    note && div({ class: 'stat__note' }, note),
  );
}

export function badge(text, tone = 'muted', options = {}) {
  return span({ class: `badge badge--${tone}`, title: options.title ?? '' }, options.dot !== false && span({ class: 'badge__dot' }), text);
}

export function verdictBadge(verdict) {
  const meta = reference.verdicts?.[verdict];
  return badge(meta?.label ?? verdict ?? '—', VERDICT_TONE[verdict] ?? 'muted', { title: meta?.description ?? '' });
}

export function statusBadge(status, labels = reference.declarationStatusLabels) {
  return badge(labels?.[status] ?? status ?? '—', STATUS_TONE[status] ?? 'muted');
}

export function evidenceBadge(type) {
  if (!type) return badge('Geen bewijsstuk', 'bad');
  const meta = reference.evidenceTypes?.[type];
  return badge(meta?.short ?? type, EVIDENCE_TONE[type] ?? 'muted', { title: meta?.description ?? '' });
}

export function note(tone, ...content) {
  const icons = { ok: '✓', warn: '!', bad: '✕', info: 'i', muted: '·' };
  return div({ class: `note note--${tone}` }, span({ class: 'note__icon' }, icons[tone] ?? 'i'), div({}, ...content));
}

export function empty(title, hint, action) {
  return div({ class: 'empty' }, div({ class: 'empty__title' }, title), hint && p({}, hint), action && div({ class: 'mt-1' }, action));
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<{key,label,align,render,width}>} columns
 * @param {Array<object>} rows
 * @param {object} [options] { onRow, emptyText, compact, rowClass }
 */
export function dataTable(columns, rows, options = {}) {
  if (!rows?.length) return empty(options.emptyTitle ?? 'Nog niets te tonen', options.emptyText);

  return div(
    { class: 'table-wrap' },
    table(
      { class: ['table', options.compact && 'table--compact'] },
      thead({}, tr({}, columns.map((col) => th({ class: col.align === 'right' ? 'num' : '', style: col.width ? { width: col.width } : {} }, col.label)))),
      tbody(
        {},
        rows.map((row) =>
          tr(
            {
              class: [options.onRow && 'is-clickable', options.rowClass?.(row)],
              onClick: options.onRow ? () => options.onRow(row) : undefined,
            },
            columns.map((col) => td({ class: col.align === 'right' ? 'num' : '' }, col.render ? col.render(row) : row[col.key] ?? '—')),
          ),
        ),
      ),
    ),
  );
}

export function kv(entries) {
  return dl(
    { class: 'kv' },
    entries.filter(Boolean).flatMap(([term, value]) => [dt({}, term), dd({}, value ?? '—')]),
  );
}

export function tabs(items, active, onSelect) {
  return div(
    { class: 'tabs' },
    items.map((item) =>
      button({ class: item.key === active ? 'is-active' : '', onClick: () => onSelect(item.key) }, item.label),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

const MODULE_COLOURS = { A1: '#16506b', A2: '#2b7f9e', A3: '#4aa3a0', A4: '#7fb069', A5: '#b0ab5b' };

/** Stacked bar of the A1..A5 split, with a legend carrying the real numbers. */
export function moduleBar(byModule, modules, unit) {
  const entries = modules.map((code) => ({ code, value: Math.max(0, Number(byModule?.[code] ?? 0)) }));
  const total = entries.reduce((sum, e) => sum + e.value, 0) || 1;

  return div(
    {},
    div(
      { class: 'modulebar' },
      entries
        .filter((e) => e.value > 0)
        .map((e) =>
          div(
            {
              class: 'modulebar__seg',
              dataset: { module: e.code },
              style: { width: `${(e.value / total) * 100}%` },
              title: `${e.code}: ${smart(e.value)} ${unit} (${((e.value / total) * 100).toFixed(1)} %)`,
            },
            (e.value / total) > 0.07 ? e.code : '',
          ),
        ),
    ),
    div(
      { class: 'modulebar-legend' },
      entries.map((e) =>
        span(
          {},
          h('i', { style: { background: MODULE_COLOURS[e.code] } }),
          `${e.code} · ${smart(e.value)} ${unit}`,
        ),
      ),
    ),
  );
}

/**
 * Min-mean-max per group. This chart carries the sector's central argument, so
 * the range is drawn as a band rather than the mean as a single dot.
 */
export function spreadChart(rows, { unit = '', max: forcedMax = null } = {}) {
  if (!rows.length) return empty('Nog geen gepubliceerde declaraties om te middelen');
  const max = forcedMax ?? Math.max(...rows.map((r) => r.max)) * 1.05;

  return div(
    {},
    rows.map((row) =>
      div(
        { class: 'spread' },
        div({ class: 'spread__label' }, row.label ?? row.strengthClass),
        div(
          { class: 'spread__track', title: `min ${smart(row.min)} · gemiddelde ${smart(row.mean)} · max ${smart(row.max)} ${unit}` },
          div({ class: 'spread__range', style: { left: `${(row.min / max) * 100}%`, width: `${Math.max(1, ((row.max - row.min) / max) * 100)}%` } }),
          div({ class: 'spread__mean', style: { left: `${((row.weightedMean ?? row.mean) / max) * 100}%` } }),
        ),
        div({ class: 'spread__value' }, `${smart(row.weightedMean ?? row.mean)}`, small({ class: 'muted' }, ` (${smart(row.min)}–${smart(row.max)})`)),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Calculation trace                                                   */
/* ------------------------------------------------------------------ */

/**
 * The heart of the transparency requirement: every term with its own inputs,
 * factor, factor source and the evidence behind it.
 */
export function traceView(calculation, unit) {
  return div(
    { class: 'trace' },
    calculation.modules.map((module) =>
      div(
        { class: 'trace__module' },
        div(
          { class: 'trace__head' },
          div(
            {},
            span({ class: 'trace__code' }, module.code),
            strong({}, module.label),
            div({ class: 'trace__desc' }, module.description),
          ),
          div({ class: 'trace__sum' }, `${smart(module.subtotal)} ${unit}`),
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
      line.evidence?.type && div({ class: 'mt-1' }, evidenceBadge(line.evidence.type), line.evidence.number && small({ class: 'muted' }, ` ${line.evidence.number}`)),
      line.overridden && div({ class: 'mt-1' }, badge('Overschreven', 'warn')),
    ),
    div(
      {},
      div({ class: 'trace__formula' }, line.formula),
      line.factor?.source && div({ class: 'trace__source' }, `Bron: ${line.factor.source}`),
      line.justification && div({ class: 'trace__source' }, `Verantwoording: ${line.justification}`),
    ),
    div({ class: 'trace__value' }, `${smart(line.values?.GWP_TOTAL ?? 0)}`, small({ class: 'muted' }, ` ${unit}`)),
  );
}

/* ------------------------------------------------------------------ */
/* Gate panel                                                          */
/* ------------------------------------------------------------------ */

/** The change-control or delivery decision, with its checks laid out. */
export function gatePanel({ decision, title, subtitle, checks }) {
  const tone = decision === 'GO' || decision === 'AUTO_ACCEPT' ? 'go' : decision === 'NO_GO' ? 'stop' : 'warn';
  const icon = tone === 'go' ? '✓' : tone === 'stop' ? '✕' : '!';

  return div(
    { class: 'gate' },
    div(
      { class: `gate__verdict gate__verdict--${tone}` },
      div({ class: 'gate__icon' }, icon),
      div({}, div({ class: 'gate__title' }, title), subtitle && div({ class: 'gate__sub' }, subtitle)),
    ),
    ul(
      { class: 'gate__checks' },
      (checks ?? []).map((check) =>
        li(
          { class: `gate__check ${check.passed ? 'gate__check--pass' : 'gate__check--fail'}` },
          h('i', {}, check.passed ? '✓' : '✕'),
          div({}, check.message),
        ),
      ),
    ),
  );
}

export function gateDecisionLabel(decision) {
  return GATE_LABELS[decision] ?? decision;
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export function timeline(entries, { highlight = () => false } = {}) {
  if (!entries?.length) return empty('Nog geen registraties');
  return ul(
    { class: 'timeline' },
    entries.map((entry) =>
      li(
        { class: highlight(entry) ? 'is-highlight' : '' },
        div({ class: 'timeline__when' }, dateTime(entry.ts ?? entry.created_at)),
        div({ class: 'timeline__what' }, entry.summary ?? entry.title),
        div({ class: 'timeline__who' }, entry.actor_label ?? entry.body ?? ''),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

export function field(labelText, control, { hint, required } = {}) {
  return div(
    { class: 'field' },
    label({ class: 'field__label' }, labelText, required && span({ class: 'field__req' }, '*')),
    control,
    hint && div({ class: 'field__hint' }, hint),
  );
}

export function textField(name, labelText, options = {}) {
  return field(
    labelText,
    input({ type: options.type ?? 'text', name, value: options.value ?? '', placeholder: options.placeholder ?? '', required: options.required, step: options.step, min: options.min, max: options.max }),
    options,
  );
}

export function selectField(name, labelText, options, opts = {}) {
  return field(
    labelText,
    select(
      { name, required: opts.required },
      opts.placeholder !== false && option({ value: '' }, opts.placeholder ?? '— kies —'),
      options.map((o) => option({ value: o.value, selected: String(o.value) === String(opts.value) }, o.label)),
    ),
    opts,
  );
}

export function textAreaField(name, labelText, options = {}) {
  return field(labelText, textarea({ name, placeholder: options.placeholder ?? '', required: options.required }, options.value ?? ''), options);
}

export function checkField(name, labelText, options = {}) {
  return div(
    { class: 'field' },
    label({ class: 'check' }, input({ type: 'checkbox', name, checked: !!options.value }), span({}, labelText)),
    options.hint && div({ class: 'field__hint' }, options.hint),
  );
}

/* ------------------------------------------------------------------ */
/* Modal & toast                                                       */
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
        div({}, h2({}, title), hint && div({ class: 'card__hint' }, hint)),
        button({ class: 'modal__close', onClick: close, 'aria-label': 'Sluiten' }, '×'),
      ),
      div({ class: 'modal__body' }, typeof body === 'function' ? body(close) : body),
      actions && div({ class: 'modal__foot' }, typeof actions === 'function' ? actions(close) : actions),
    ),
  );

  document.body.appendChild(backdrop);
  const firstInput = backdrop.querySelector('input, select, textarea');
  firstInput?.focus();
  return { close, element: backdrop };
}

/** Modal wrapping a form; `onSubmit` receives the parsed values. */
export function formModal({ title, hint, fields, submitLabel = 'Opslaan', onSubmit, wide }) {
  let formEl;
  const dialog = modal({
    title,
    hint,
    wide,
    body: () => {
      formEl = form({ id: 'modal-form', onSubmit: (e) => e.preventDefault() }, fields);
      return formEl;
    },
    actions: (close) => [
      button({ class: 'btn', onClick: close }, 'Annuleren'),
      button(
        {
          class: 'btn btn--accent',
          onClick: async (event) => {
            const btn = event.currentTarget;
            if (!formEl.reportValidity()) return;
            btn.disabled = true;
            try {
              const { formData } = await import('./dom.js');
              await onSubmit(formData(formEl), close);
            } catch (err) {
              toast(err.message, 'bad');
            } finally {
              btn.disabled = false;
            }
          },
        },
        submitLabel,
      ),
    ],
  });
  return dialog;
}

let toastHost = null;
export function toast(message, tone = '') {
  if (!toastHost) {
    toastHost = div({ class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const el = div({ class: ['toast', tone && `toast--${tone}`] }, message);
  toastHost.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, tone === 'bad' ? 6000 : 3600);
}

/* ------------------------------------------------------------------ */
/* Page scaffolding                                                    */
/* ------------------------------------------------------------------ */

export function pageHead(title, intro, actions) {
  return div(
    { class: 'page-head' },
    div({}, h('h1', {}, title), intro && div({ class: 'page-head__intro' }, intro)),
    actions && div({ class: 'page-head__actions' }, actions),
  );
}

export function loading(text = 'Bezig met laden…') {
  return div({ class: 'empty' }, text);
}

export { num, smart, pct, date, dateTime };
