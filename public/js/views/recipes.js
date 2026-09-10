/**
 * Recipe list, plus the composition editor used to create one.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount, formData } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  card, dataTable, badge, verdictBadge, statusBadge, pageHead, note, toast, modal,
  textField, selectField, field, ref, empty,
} from '../lib/ui.js';
import { smart, date } from '../lib/format.js';

const { div, span, strong, button, a, input, select, option, form, table, thead, tbody, tr, th, td, small, p } = tags;

export async function render(outlet, { setTitle, navigate }) {
  setTitle('Recepturen', state.user.orgName);
  const host = div();

  const load = async () => {
    const { recipes } = await api.get('/recipes');
    mount(
      host,
      card(
        `${recipes.length} receptuur${recipes.length === 1 ? '' : 'en'}`,
        dataTable(
          [
            { label: 'Code', render: (r) => div({}, strong({}, r.code), span({ class: 'sub' }, r.name)) },
            state.user.orgType !== 'PRODUCER' ? { label: 'Producent', render: (r) => r.producer_name } : null,
            { label: 'Klasse', render: (r) => div({}, r.strength_class ?? '—', span({ class: 'sub' }, r.exposure_classes ?? '')) },
            { label: 'BENOR', render: (r) => (r.benor ? badge('BENOR', 'ok') : span({ class: 'muted small' }, '—')) },
            { label: 'Versies', align: 'right', render: (r) => String(r.versionCount) },
            {
              label: 'GWP A1–A3',
              align: 'right',
              render: (r) => (r.lead === null ? '—' : div({}, strong({}, smart(r.lead)), span({ class: 'sub' }, 'kg CO₂ eq./m³'))),
            },
            { label: 'Oordeel', render: (r) => verdictBadge(r.verdict) },
            { label: 'Declaratie', render: (r) => (r.declaration ? statusBadge(r.declaration.status) : badge('Geen', 'muted')) },
          ].filter(Boolean),
          recipes,
          { onRow: (r) => navigate(`/recipes/${r.id}`), emptyText: 'Maak een eerste receptuur aan.' },
        ),
        { flush: true },
      ),
    );
  };

  mount(
    outlet,
    pageHead(
      'Recepturen',
      'Een receptuur is een omhulsel; alles zit in haar versies. Elke wijziging aan de samenstelling opent een nieuwe versie met haar eigen ingangsdatum.',
      can('recipes:write') ? [button({ class: 'btn btn--accent', onClick: () => openCreate(navigate) }, '+ Receptuur aanmaken')] : null,
    ),
    host,
  );

  await load();
}

/* ------------------------------------------------------------------ */
/* Composition editor                                                  */
/* ------------------------------------------------------------------ */

/**
 * The composition table. Each line is a material the producer actually has
 * access to, plus the transport leg from that supplier's gate to this plant -
 * the number nobody upstream can know.
 */
export function compositionEditor(materials, profiles, initial = []) {
  const rows = [];
  const body = tbody();
  const host = div({ class: 'table-wrap' }, table({ class: 'table--compact' },
    thead({}, tr({},
      th({}, 'Grondstof'),
      th({ class: 'num' }, 'kg / m³'),
      th({ class: 'num' }, 'Aanvoer km'),
      th({}, 'Transportprofiel'),
      th({}, ''),
    )),
    body,
  ));

  const usable = materials.filter((m) => !m.restricted);

  const addRow = (preset = {}) => {
    const row = { id: Math.random().toString(36).slice(2) };
    rows.push(row);

    const materialSelect = select(
      { class: 'row-material' },
      option({ value: '' }, '— kies grondstof —'),
      usable.map((m) => option({ value: m.id, selected: m.id === preset.materialId }, `${m.name} · ${m.supplier_name}`)),
    );
    const qty = input({ type: 'number', step: '0.1', min: '0', value: preset.quantityKg ?? '', class: 'row-qty' });
    const km = input({ type: 'number', step: '1', min: '0', value: preset.transportKm ?? 0, class: 'row-km' });
    const profile = select(
      { class: 'row-profile' },
      option({ value: '' }, '— geen transport —'),
      profiles.map((pr) => option({ value: pr.id, selected: pr.id === preset.transportProfileId }, pr.name)),
    );

    row.read = () => ({
      materialId: materialSelect.value,
      quantityKg: Number(qty.value),
      transportKm: Number(km.value) || 0,
      transportProfileId: profile.value || null,
    });

    const trEl = tr(
      {},
      td({}, materialSelect),
      td({}, qty),
      td({}, km),
      td({}, profile),
      td({ class: 'num' }, button({ type: 'button', class: 'btn btn--small btn--ghost', onClick: () => { trEl.remove(); rows.splice(rows.indexOf(row), 1); } }, '✕')),
    );
    body.appendChild(trEl);
  };

  if (initial.length) initial.forEach(addRow);
  else [{}, {}, {}].forEach(addRow);

  const wrapper = div(
    {},
    usable.length
      ? null
      : note('warn', 'U hebt nog tot geen enkele grondstof toegang. Vraag eerst toegang aan bij uw leveranciers voordat u een receptuur samenstelt.'),
    host,
    div({ class: 'mt-1' }, button({ type: 'button', class: 'btn btn--small', onClick: () => addRow() }, '+ Regel toevoegen')),
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
    hint: 'De eerste versie gaat meteen in productie. Ze moet altijd door een externe verificatie voordat ze als declaratie geldt.',
    wide: true,
    body: () => {
      formEl = form(
        { onSubmit: (e) => e.preventDefault() },
        div(
          { class: 'field-row' },
          textField('code', 'Code', { required: true, placeholder: 'C30/37-EE3-S4' }),
          textField('name', 'Benaming', { required: true, placeholder: 'Standaard buitenbeton C30/37' }),
        ),
        div(
          { class: 'field-row' },
          selectField('strengthClass', 'Sterkteklasse', classes.map((c) => ({ value: c.code, label: c.code })), { required: true }),
          textField('exposureClasses', 'Omgevingsklassen', { placeholder: 'EE3' }),
          textField('consistency', 'Consistentie', { placeholder: 'S4' }),
        ),
        div(
          { class: 'field-row' },
          textField('dmax', 'Dmax (mm)', { type: 'number', step: '1', value: 14 }),
          textField('density', 'Densiteit (kg/m³)', { type: 'number', step: '10', value: 2350, hint: 'Gebruikt voor module A4.' }),
          selectField('siteId', 'Centrale', sites.map((s) => ({ value: s.id, label: s.name })), { placeholder: '— geen —' }),
        ),
        div({ class: 'card__title mt-2 mb-1' }, 'Samenstelling per m³'),
        p({ class: 'field__hint mb-1' }, 'De aanvoerafstand is de rit van de leverancier naar úw centrale. Die staat nooit in de declaratie van de leverancier — daarom vult u ze hier in.'),
        editor,
      );
      return formEl;
    },
    actions: (close) => [
      button({ class: 'btn', onClick: close }, 'Annuleren'),
      button(
        {
          class: 'btn btn--accent',
          onClick: async (event) => {
            if (!formEl.reportValidity()) return;
            const components = editor.readComponents();
            if (!components.length) return toast('Voeg minstens één grondstof toe.', 'bad');

            event.currentTarget.disabled = true;
            try {
              const values = formData(formEl);
              const { recipe } = await api.post('/recipes', { ...values, components, activate: true });
              close();
              toast('Receptuur aangemaakt.', 'ok');
              navigate(`/recipes/${recipe.id}`);
            } catch (err) {
              toast(err.message, 'bad');
              event.currentTarget.disabled = false;
            }
          },
        },
        'Aanmaken',
      ),
    ],
  });
}
