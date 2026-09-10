/**
 * The material catalogue.
 *
 * Everybody sees every listed supplier's products; only the numbers are gated.
 * A producer that cannot see a value gets a "toegang vragen" button in its
 * place rather than a blank row.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  card, dataTable, badge, verdictBadge, evidenceBadge, pageHead, toast, formModal,
  textField, selectField, textAreaField, checkField, note, ref,
} from '../lib/ui.js';
import { smart, date } from '../lib/format.js';

const { div, span, strong, button, a, input, select, option, small } = tags;

export async function render(outlet, { setTitle, navigate }) {
  const isSupplier = state.user.orgType === 'SUPPLIER';
  setTitle(isSupplier ? 'Mijn grondstoffen' : 'Grondstofcatalogus', '');

  const filters = { q: '', category: '', scope: isSupplier ? 'own' : 'all' };
  const listHost = div();

  const load = async () => {
    mount(listHost, div({ class: 'empty' }, 'Bezig met laden…'));
    const { materials } = await api.get(`/materials${qs(filters)}`);
    mount(listHost, table(materials, navigate, isSupplier));
  };

  mount(
    outlet,
    pageHead(
      isSupplier ? 'Mijn grondstoffen' : 'Grondstofcatalogus',
      isSupplier
        ? 'Elke grondstof draagt haar eigen milieudeclaratie. Wijzigt uw proces, dan maakt u een nieuwe versie aan — de oude blijft gelden voor leveringen uit die periode.'
        : 'Alle geregistreerde grondstoffen van aangesloten leveranciers. De milieuparameters zijn pas zichtbaar nadat de leverancier u toegang verleent.',
      isSupplier && can('materials:write') ? [button({ class: 'btn btn--accent', onClick: () => openCreate(load) }, '+ Grondstof registreren')] : null,
    ),
    div(
      { class: 'toolbar' },
      input({
        type: 'search',
        placeholder: 'Zoek op naam, code of leverancier…',
        onInput: debounce((e) => {
          filters.q = e.target.value;
          load();
        }, 250),
      }),
      select(
        {
          onChange: (e) => {
            filters.category = e.target.value;
            load();
          },
        },
        option({ value: '' }, 'Alle categorieën'),
        (ref().materialCategories ?? []).map((c) => option({ value: c.code }, c.label)),
      ),
      !isSupplier
        ? select(
            {
              onChange: (e) => {
                filters.scope = e.target.value;
                load();
              },
            },
            option({ value: 'all' }, 'Volledige catalogus'),
            option({ value: 'own' }, 'Enkel eigen gegevens'),
          )
        : null,
    ),
    listHost,
  );

  await load();
}

function table(materials, navigate, isSupplier) {
  const categoryLabel = (code) => ref().materialCategories?.find((c) => c.code === code)?.label ?? code;

  return card(
    `${materials.length} grondstof${materials.length === 1 ? '' : 'fen'}`,
    dataTable(
      [
        {
          label: 'Grondstof',
          render: (m) => div({}, strong({}, m.name), span({ class: 'sub' }, `${m.code}${m.site_name ? ` · ${m.site_name}` : ''}`)),
        },
        !isSupplier ? { label: 'Leverancier', render: (m) => m.supplier_name } : null,
        { label: 'Categorie', render: (m) => span({ class: 'small' }, categoryLabel(m.category)) },
        { label: 'Bewijsstuk', render: (m) => evidenceBadge(m.evidence_type) },
        { label: 'Oordeel', render: (m) => verdictBadge(m.verdict) },
        {
          label: 'GWP-totaal',
          align: 'right',
          render: (m) =>
            m.restricted
              ? span({ class: 'muted small' }, 'afgeschermd')
              : span({}, smart(gwpOf(m)), small({ class: 'muted' }, ' kg CO₂/t')),
        },
        {
          label: 'Versie',
          render: (m) => (m.version ? span({ class: 'small' }, `v${m.version.version_no} · ${date(m.version.effective_from)}`) : span({ class: 'muted small' }, '—')),
        },
        {
          label: '',
          align: 'right',
          render: (m) =>
            m.restricted && can('access:request')
              ? button({ class: 'btn btn--small', onClick: (e) => (e.stopPropagation(), requestAccess(m)) }, 'Toegang vragen')
              : a({ href: `#/materials/${m.id}`, class: 'btn btn--small btn--ghost' }, 'Openen'),
        },
      ].filter(Boolean),
      materials,
      { onRow: (m) => navigate(`/materials/${m.id}`), emptyText: 'Geen grondstoffen gevonden voor deze filters.' },
    ),
    { flush: true },
  );
}

/** A1+A2+A3 of the supplier's own declaration, per declared unit. */
function gwpOf(material) {
  if (!material.values) return null;
  return ['A1', 'A2', 'A3'].reduce((sum, m) => sum + (material.values[m]?.GWP_TOTAL ?? 0), 0);
}

function requestAccess(material) {
  formModal({
    title: `Toegang vragen aan ${material.supplier_name}`,
    hint: 'De leverancier ziet uw motivering en beslist. Zonder toestemming kunt u deze grondstof niet in een receptuur gebruiken.',
    fields: [
      note('info', `Aanvraag voor: `, strong({}, material.name), ` (${material.code})`),
      textAreaField('reason', 'Motivering', {
        required: true,
        placeholder: 'Bv. "Wij starten in maart een levering en hebben de milieuparameters nodig voor onze declaratie. Contractnummer …"',
      }),
    ],
    submitLabel: 'Aanvraag versturen',
    onSubmit: async (values, close) => {
      await api.post('/access', { ownerOrgId: material.org_id, reason: values.reason });
      close();
      toast('Aanvraag verstuurd naar de leverancier.', 'ok');
    },
  });
}

/* ------------------------------------------------------------------ */
/* Creating a material                                                 */
/* ------------------------------------------------------------------ */

async function openCreate(onDone) {
  const { sites } = await api.get('/sites');
  const reference = ref();
  const modules = ['A1', 'A2', 'A3'];

  // Only GWP is asked for in the form; the remaining EN 15804 indicators come
  // from the uploaded declaration in a real integration. The form is honest
  // about that rather than pretending one number is a full LCA.
  const valueFields = modules.map((module) =>
    textField(`gwp_${module}`, `${module} — GWP-totaal (kg CO₂ eq. per ton)`, {
      type: 'number',
      step: '0.0001',
      required: module === 'A1',
      hint: { A1: 'Winning van de grondstof zelf.', A2: 'Transport naar uw eigen productiesite.', A3: 'Verwerking op uw site.' }[module],
    }),
  );

  formModal({
    title: 'Grondstof registreren',
    hint: 'De eerste versie wordt meteen actief vanaf vandaag.',
    wide: true,
    fields: [
      div(
        { class: 'field-row' },
        textField('code', 'Code', { required: true, placeholder: 'CEM III/A 42,5 N' }),
        textField('name', 'Benaming', { required: true, placeholder: 'Hoogovencement CEM III/A 42,5 N LA' }),
      ),
      div(
        { class: 'field-row' },
        selectField('category', 'Categorie', reference.materialCategories.map((c) => ({ value: c.code, label: c.label })), { required: true }),
        selectField('siteId', 'Productielocatie', sites.map((s) => ({ value: s.id, label: s.name })), { placeholder: '— geen —' }),
      ),
      div({ class: 'card__title mt-2 mb-1' }, 'Bewijsstuk'),
      note(
        'info',
        'Het type bepaalt of het eindresultaat als BEPD bruikbaar is. Een eigen opgave rekent wel door, maar maakt elk dossier dat erop steunt ongeldig.',
      ),
      selectField(
        'evidenceType',
        'Type declaratie',
        Object.values(reference.evidenceTypes).map((t) => ({ value: t.code, label: t.label })),
        { required: true, value: 'BEPD' },
      ),
      div(
        { class: 'field-row' },
        textField('evidenceNumber', 'Registratienummer', { placeholder: 'BEPD-2026-CEM-0001', hint: 'Verplicht voor een BEPD of internationale EPD.' }),
        textField('evidenceProgramme', 'Programma / databank', { placeholder: 'BEPD (federale databank)' }),
      ),
      div(
        { class: 'field-row' },
        textField('evidenceIssuer', 'Verificatie-instelling', {}),
        textField('validUntil', 'Geldig tot', { type: 'date' }),
      ),
      div({ class: 'card__title mt-2 mb-1' }, 'Milieuparameters per ton'),
      ...valueFields,
      checkField('includesInboundTransport', 'Levering franco: het transport naar de klant zit al in deze cijfers', {
        hint: 'Aanvinken voorkomt dat de afnemer het transport een tweede keer aanrekent.',
      }),
    ],
    submitLabel: 'Registreren',
    onSubmit: async (values, close) => {
      const payload = {
        code: values.code,
        name: values.name,
        category: values.category,
        siteId: values.siteId || null,
        declaredUnit: 'TONNE',
        includesInboundTransport: values.includesInboundTransport,
        evidence: {
          type: values.evidenceType,
          number: values.evidenceNumber,
          programme: values.evidenceProgramme,
          issuer: values.evidenceIssuer,
          validUntil: values.validUntil || null,
        },
        values: Object.fromEntries(
          modules
            .filter((m) => values[`gwp_${m}`] !== null && values[`gwp_${m}`] !== '')
            .map((m) => [m, { GWP_TOTAL: values[`gwp_${m}`] }]),
        ),
      };
      await api.post('/materials', payload);
      close();
      toast('Grondstof geregistreerd.', 'ok');
      await onDone();
    },
  });
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
