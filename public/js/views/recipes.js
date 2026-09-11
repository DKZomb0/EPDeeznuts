/**
 * Recepturenoverzicht: KPI-strip, meldingen van leveranciers, en de tabel met
 * de afwijking t.o.v. de laatste verificatie.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount, formData } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  panel, kpiStrip, tablePanel, banner, tag, verdictTag, statusTag, pageHead, toast, modal,
  textField, selectField, btn, ref, smart, pct, empty,
} from '../lib/ui.js';

const { div, span, strong, form, table, thead, tbody, tr, th, td, input, select, option, button, p, small } = tags;

export async function render(outlet, { setTitle, navigate }) {
  setTitle('Recepturen');
  const host = div({ class: 'stack' });

  const load = async () => {
    const [{ recipes }, dashboard] = await Promise.all([
      api.get('/recipes'),
      api.get('/dashboard').catch(() => null),
    ]);
    draw(recipes, dashboard);
  };

  const draw = (recipes, dashboard) => {
    const settings = ref().settings ?? {};
    const tolerance = Number(settings.bypass_tolerance_pct ?? 3);

    const rows = recipes.map((recipe) => {
      const declared = declaredValue(recipe);
      const delta = declared && recipe.lead ? ((recipe.lead - declared) / declared) * 100 : null;
      return { ...recipe, delta, within: delta === null ? null : Math.abs(delta) <= tolerance };
    });

    const supplierAlert = (dashboard?.notifications ?? []).find((n) => n.kind === 'MATERIAL_CHANGED');

    mount(
      host,
      state.user.orgType === 'PRODUCER'
        ? kpiStrip([
            { label: 'Actieve recepturen', value: String(rows.length), note: `${new Set(rows.map((r) => r.site_name).filter(Boolean)).size || 1} centrale(s)` },
            { label: 'Geverifieerd', value: String(rows.filter((r) => ['PUBLISHED', 'VERIFIED', 'AUTO_ACCEPTED'].includes(r.declaration?.status)).length), note: 'BEPD A1–A3 geldig', tone: 'ok' },
            { label: 'In wachtrij', value: String(rows.filter((r) => ['SUBMITTED', 'UNDER_VERIFICATION'].includes(r.declaration?.status)).length), note: 'bij het controlebureau' },
            { label: 'Ongeldig', value: String(rows.filter((r) => r.verdict === 'INVALID').length), note: 'input zonder BEPD', tone: 'bad' },
          ])
        : null,

      supplierAlert
        ? banner('accent', {
            icon: 'warningCircle',
            title: supplierAlert.title,
            body: supplierAlert.body,
          })
        : null,

      tablePanel(
        [
          { label: 'Receptuur', render: (r) => div({}, div({ class: 'strong' }, r.code), div({ class: 'sub' }, r.name)) },
          state.user.orgType !== 'PRODUCER' ? { label: 'Producent', muted: true, render: (r) => r.producer_name } : null,
          { label: 'Sterkteklasse', muted: true, render: (r) => r.strength_class ?? '—' },
          { label: 'Omgevingsklasse', muted: true, render: (r) => r.exposure_classes ?? '—' },
          {
            label: 'GWP A1–A3',
            align: 'right',
            render: (r) => (r.lead === null ? '—' : div({}, span({ class: 'tnum' }, smart(r.lead)), div({ class: 'sub' }, 'kg CO₂e / m³'))),
          },
          {
            label: 'Δ t.o.v. verificatie',
            align: 'right',
            render: (r) =>
              r.delta === null
                ? span({ class: 'muted' }, '—')
                : span({ class: 'tnum', style: { color: r.within ? 'var(--color-neutral-700)' : 'var(--color-accent-800)' } }, pct(r.delta, 1)),
          },
          { label: 'Status', render: (r) => statusCell(r) },
          { label: '', align: 'right', render: (r) => btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/recipes/${r.id}` }) },
        ],
        rows,
        { onRow: (r) => navigate(`/recipes/${r.id}`), emptyTitle: 'Nog geen recepturen', emptyText: 'Maak een eerste receptuur aan om te beginnen.' },
      ),
    );
  };

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        title: 'Recepturen',
        lede:
          state.user.orgType === 'PRODUCER'
            ? `${state.user.orgName} — een receptuur is een omhulsel; alles zit in haar versies. Elke wijziging opent een nieuwe versie met haar eigen ingangsdatum.`
            : 'Alle recepturen waarvoor u inzage hebt.',
        actions: can('recipes:write') ? [btn('Receptuur aanmaken', { variant: 'primary', icon: 'plus', onClick: () => openCreate(navigate) })] : null,
      }),
      host,
    ),
  );

  await load();
}

function statusCell(recipe) {
  if (recipe.verdict === 'INVALID') return tag('Ongeldig — geen BEPD', 'tag-neutral');
  if (!recipe.declaration) return tag('Niet ingediend', 'tag-quiet');
  if (recipe.within === false) return tag('Verificatie vereist', 'tag-outline');
  return statusTag(recipe.declaration.status);
}

function declaredValue(recipe) {
  return recipe.declaration && recipe.lead !== null ? recipe.lead : null;
}

/* ------------------------------------------------------------------ */
/* Samenstellingseditor                                                */
/* ------------------------------------------------------------------ */

/**
 * De samenstellingstabel. Elke regel is een grondstof waartoe de producent
 * effectief inzage heeft, plus de rit van de poort van die leverancier naar
 * deze centrale — het getal dat niemand stroomopwaarts kan kennen.
 */
export function compositionEditor(materials, profiles, initial = []) {
  const rows = [];
  const body = tbody();
  const usable = materials.filter((m) => !m.restricted);

  const addRow = (preset = {}) => {
    const row = { id: Math.random().toString(36).slice(2) };
    rows.push(row);

    const materialSelect = select(
      {},
      option({ value: '' }, '— kies grondstof —'),
      usable.map((m) => option({ value: m.id, selected: m.id === preset.materialId }, `${m.name} · ${m.supplier_name}`)),
    );
    const qty = input({ class: 'input input-inline', type: 'number', step: '0.1', min: '0', value: preset.quantityKg ?? '' });
    const km = input({ class: 'input input-inline', type: 'number', step: '1', min: '0', value: preset.transportKm ?? 0 });
    const profile = select(
      {},
      option({ value: '' }, '— geen transport —'),
      profiles.map((pr) => option({ value: pr.id, selected: pr.id === preset.transportProfileId }, pr.name)),
    );

    row.read = () => ({
      materialId: materialSelect.value,
      quantityKg: Number(qty.value),
      transportKm: Number(km.value) || 0,
      transportProfileId: profile.value || null,
    });

    const rowEl = tr(
      {},
      td({}, materialSelect),
      td({ style: { textAlign: 'right' } }, qty),
      td({ style: { textAlign: 'right' } }, km),
      td({}, profile),
      td(
        { style: { textAlign: 'right' } },
        button(
          {
            type: 'button',
            class: 'btn btn-ghost btn-sm',
            onClick: () => {
              rowEl.remove();
              rows.splice(rows.indexOf(row), 1);
            },
          },
          '✕',
        ),
      ),
    );
    body.appendChild(rowEl);
  };

  if (initial.length) initial.forEach(addRow);
  else [{}, {}, {}].forEach(addRow);

  const wrapper = div(
    { class: 'flex-col' },
    usable.length
      ? null
      : banner('neutral', { icon: 'lock', body: 'U hebt nog tot geen enkele grondstof inzage. Vraag eerst toegang aan bij uw leveranciers voordat u een receptuur samenstelt.' }),
    div(
      { class: 'panel panel--table' },
      table(
        { class: 'table' },
        thead({}, tr({}, th({}, 'Grondstof'), th({ style: { textAlign: 'right' } }, 'kg / m³'), th({ style: { textAlign: 'right' } }, 'Afstand km'), th({}, 'Transportprofiel'), th({}))),
        body,
      ),
    ),
    div({}, btn('Regel toevoegen', { variant: 'secondary', small: true, icon: 'plus', onClick: () => addRow() })),
  );

  wrapper.readComponents = () => rows.map((r) => r.read()).filter((c) => c.materialId && c.quantityKg > 0);
  return wrapper;
}

/* ------------------------------------------------------------------ */

async function openCreate(navigate) {
  const [{ materials }, { sites }] = await Promise.all([api.get('/materials'), api.get('/sites')]);
  const profiles = ref().transportProfiles ?? [];
  const classes = ref().strengthClasses ?? [];

  const editor = compositionEditor(materials, profiles);
  let formEl;

  modal({
    title: 'Nieuwe receptuur',
    hint: 'De eerste versie gaat meteen in productie en moet altijd door een externe verificatie voordat ze als declaratie geldt.',
    wide: true,
    body: () => {
      formEl = form(
        { onSubmit: (e) => e.preventDefault(), class: 'flex-col', style: { gap: '11.2px' } },
        div(
          { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '11.2px' } },
          textField('code', 'Code', { required: true, placeholder: 'C30/37-EE3-S4' }),
          textField('name', 'Benaming', { required: true, placeholder: 'Standaard buitenbeton C30/37' }),
        ),
        div(
          { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '11.2px' } },
          selectField('strengthClass', 'Sterkteklasse', classes.map((c) => ({ value: c.code, label: c.code })), { required: true }),
          textField('exposureClasses', 'Omgevingsklassen', { placeholder: 'EE3' }),
          textField('consistency', 'Consistentie', { placeholder: 'S4' }),
        ),
        div(
          { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '11.2px' } },
          textField('dmax', 'Dmax (mm)', { type: 'number', step: '1', value: 14 }),
          textField('density', 'Densiteit (kg/m³)', { type: 'number', step: '10', value: 2350, hint: 'Gebruikt voor module A4.' }),
          selectField('siteId', 'Centrale', sites.map((s) => ({ value: s.id, label: s.name })), { placeholder: '— geen —' }),
        ),
        div({ class: 'card-kicker mt-2' }, 'Samenstelling per m³'),
        p({ class: 'field__hint' }, 'De aanvoerafstand is de rit van de leverancier naar úw centrale. Die staat nooit in de declaratie van de leverancier — daarom vult u ze hier in.'),
        editor,
      );
      return formEl;
    },
    actions: (close) => [
      btn('Annuleren', { variant: 'ghost', onClick: close }),
      btn('Aanmaken', {
        variant: 'primary',
        icon: 'plus',
        onClick: async (event) => {
          if (!formEl.reportValidity()) return;
          const components = editor.readComponents();
          if (!components.length) return toast('Voeg minstens één grondstof toe.', 'bad');

          event.currentTarget.disabled = true;
          try {
            const { recipe } = await api.post('/recipes', { ...formData(formEl), components, activate: true });
            close();
            toast('Receptuur aangemaakt.', 'ok');
            navigate(`/recipes/${recipe.id}`);
          } catch (err) {
            toast(err.message, 'bad');
            event.currentTarget.disabled = false;
          }
        },
      }),
    ],
  });
}
