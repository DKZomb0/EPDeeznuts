/**
 * De grondstofcatalogus.
 *
 * Iedereen ziet dát een product bestaat; alleen de cijfers zijn afgeschermd.
 * Zonder dat kan een producent nooit toegang vragen tot iets wat hij niet kan
 * vinden.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  panel, card, tablePanel, banner, tag, evidenceTag, verdictTag, pageHead, toast, formModal,
  textField, selectField, textAreaField, checkField, btn, ref, smart, date,
} from '../lib/ui.js';

const { div, span, strong, input, select, option, small } = tags;

export async function render(outlet, { setTitle, navigate }) {
  const isSupplier = state.user.orgType === 'SUPPLIER';
  setTitle(isSupplier ? 'Grondstoffen' : 'Grondstofcatalogus');

  const filters = { q: '', category: '', scope: isSupplier ? 'own' : 'all' };
  const listHost = div();

  const load = async () => {
    const { materials } = await api.get(`/materials${qs(filters)}`);
    mount(listHost, table(materials, navigate, isSupplier));
  };

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        title: isSupplier ? 'Mijn grondstoffen' : 'Grondstofcatalogus',
        lede: isSupplier
          ? 'Eén regel per product en productielocatie. Wat hier staat, is de input van elke betonproducent die inzage heeft — u publiceert één keer in plaats van vijfduizend keer een fiche door te mailen.'
          : 'Alle geregistreerde grondstoffen van aangesloten leveranciers. De milieuparameters zijn pas zichtbaar nadat de leverancier u inzage verleent.',
        actions:
          isSupplier && can('materials:write')
            ? [
                btn('XML-koppeling', { variant: 'secondary', icon: 'plug', onClick: () => showIntegration() }),
                btn('Materiaal toevoegen', { variant: 'primary', icon: 'plus', onClick: () => openCreate(load) }),
              ]
            : null,
      }),

      div(
        { class: 'toolbar' },
        searchInput((value) => {
          filters.q = value;
          load();
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

      isSupplier
        ? div(
            { class: 'grid grid--cards' },
            card({
              kicker: 'Waarom A4–A5 leeg blijft',
              title: 'Europa bepaalt de verplichte fasen',
              body: 'Voor cement schrijft de productregel enkel A1–A3 voor; transport naar de betoncentrale valt in de A2 van de afnemer. Niet-verplichte fasen blijven leeg — nooit nul.',
            }),
            card({
              kicker: 'Wijziging melden',
              title: 'Nieuwe oven, nieuwe waarde',
              body: 'Elke gewijzigde parameter zet een nieuwe versie met datum, en de afnemers krijgen een melding. Geen maandelijkse publicatie op een website die niemand leest.',
            }),
          )
        : null,
    ),
  );

  await load();
}

function table(materials, navigate, isSupplier) {
  const categoryLabel = (code) => ref().materialCategories?.find((c) => c.code === code)?.label ?? code;

  return tablePanel(
    [
      { label: 'Product', render: (m) => div({}, div({ class: 'strong' }, m.name), div({ class: 'sub' }, m.code)) },
      !isSupplier ? { label: 'Leverancier', muted: true, render: (m) => m.supplier_name } : null,
      { label: 'Productielocatie', muted: true, render: (m) => m.site_name ?? '—' },
      { label: 'Categorie', muted: true, render: (m) => categoryLabel(m.category) },
      {
        label: 'GWP A1–A3',
        align: 'right',
        render: (m) =>
          m.restricted
            ? span({ class: 'muted small' }, 'geen inzage')
            : div({}, span({ class: 'tnum' }, smart(gwpOf(m))), div({ class: 'sub' }, 'kg CO₂e / ton')),
      },
      { label: 'Bron', render: (m) => div({}, evidenceTag(m.evidence_type), m.evidence?.number ? div({ class: 'sub mono' }, m.evidence.number) : null) },
      { label: 'Geldig tot', align: 'left', muted: true, render: (m) => (m.evidence?.valid_until ? date(m.evidence.valid_until) : '—') },
      { label: 'Status', render: (m) => verdictTag(m.verdict) },
      {
        label: '',
        align: 'right',
        render: (m) =>
          m.restricted && can('access:request')
            ? btn('Inzage vragen', { variant: 'ghost', small: true, icon: 'lock', onClick: (e) => (e.stopPropagation(), requestAccess(m)) })
            : btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/materials/${m.id}` }),
      },
    ],
    materials,
    { onRow: (m) => navigate(`/materials/${m.id}`), emptyTitle: 'Geen grondstoffen gevonden', emptyText: 'Pas de filters aan of voeg een materiaal toe.' },
  );
}

/** A1+A2+A3 van de eigen verklaring van de leverancier, per declaratie-eenheid. */
function gwpOf(material) {
  if (!material.values) return 0;
  return ['A1', 'A2', 'A3'].reduce((sum, m) => sum + (material.values[m]?.GWP_TOTAL ?? 0), 0);
}

function searchInput(onChange) {
  let timer;
  const el = input({ type: 'search', placeholder: 'Zoek op naam, code of leverancier…' });
  el.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(el.value), 250);
  });
  return el;
}

/* ------------------------------------------------------------------ */

function requestAccess(material) {
  formModal({
    title: `Inzage vragen aan ${material.supplier_name}`,
    hint: 'De leverancier ziet uw motivering en beslist. Zonder inzage kunt u deze grondstof niet in een receptuur gebruiken.',
    fields: [
      banner('plain', { icon: 'info', body: div({}, 'Aanvraag voor ', strong({}, material.name), ` (${material.code})`) }),
      textAreaField('reason', 'Motivering', {
        required: true,
        placeholder: 'bv. "Wij starten in maart een levering en hebben de milieuparameters nodig voor onze declaratie. Contractnummer …"',
      }),
    ],
    submitLabel: 'Aanvraag versturen',
    submitIcon: 'send',
    onSubmit: async (values, close) => {
      await api.post('/access', { ownerOrgId: material.org_id, reason: values.reason });
      close();
      toast('Aanvraag verstuurd naar de leverancier.', 'ok');
    },
  });
}

function showIntegration() {
  formModal({
    title: 'XML-koppeling',
    hint: 'Zodat niemand vijfduizend fiches moet overtikken.',
    fields: [
      banner('plain', {
        icon: 'plug',
        body: 'Uw systeem levert de milieuparameters aan via de API van het platform. De vorm van het bericht spreken we per leverancier af — XML en JSON zijn allebei goed; wat vastligt is welke velden verplicht zijn.',
      }),
      div({ class: 'formula-block' }, 'POST /api/materials\nPOST /api/materials/:id/versions\n\nAuthorization: Bearer <sleutel van uw organisatie>'),
      textField('contact', 'Contactpersoon voor de koppeling', { placeholder: 'naam@bedrijf.be' }),
    ],
    submitLabel: 'Aanvraag noteren',
    onSubmit: async (_values, close) => {
      close();
      toast('Genoteerd. In deze opstelling wordt er nog geen sleutel uitgegeven.', 'ok');
    },
  });
}

async function openCreate(onDone) {
  const { sites } = await api.get('/sites');
  const reference = ref();
  const modules = ['A1', 'A2', 'A3'];

  formModal({
    title: 'Materiaal toevoegen',
    hint: 'De eerste versie wordt meteen actief vanaf vandaag.',
    wide: true,
    fields: [
      div({ class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '11.2px' } },
        textField('code', 'Code', { required: true, placeholder: 'CEM III/A 42,5 N' }),
        textField('name', 'Benaming', { required: true, placeholder: 'Hoogovencement CEM III/A 42,5 N LA' }),
      ),
      div({ class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '11.2px' } },
        selectField('category', 'Categorie', reference.materialCategories.map((c) => ({ value: c.code, label: c.label })), { required: true }),
        selectField('siteId', 'Productielocatie', sites.map((s) => ({ value: s.id, label: s.name })), { placeholder: '— geen —' }),
      ),
      div({ class: 'card-kicker mt-2' }, 'Bewijsstuk'),
      banner('plain', {
        icon: 'info',
        body: 'Het type bepaalt of het eindresultaat als BEPD bruikbaar is. Een eigen opgave rekent wel door, maar maakt elk dossier dat erop steunt ongeldig.',
      }),
      selectField('evidenceType', 'Type declaratie', Object.values(reference.evidenceTypes).map((t) => ({ value: t.code, label: t.label })), {
        required: true,
        value: 'BEPD',
        placeholder: false,
      }),
      div({ class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '11.2px' } },
        textField('evidenceNumber', 'Registratienummer', { placeholder: 'BEPD-2026-CEM-0001', hint: 'Verplicht voor een BEPD of internationale EPD.' }),
        textField('evidenceProgramme', 'Programma / databank', { placeholder: 'BEPD (federale databank)' }),
      ),
      div({ class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '11.2px' } },
        textField('evidenceIssuer', 'Verificatie-instelling', {}),
        textField('validUntil', 'Geldig tot', { type: 'date' }),
      ),
      div({ class: 'card-kicker mt-2' }, 'Milieuparameters per ton'),
      ...modules.map((m) =>
        textField(`gwp_${m}`, `${m} — GWP-totaal (kg CO₂e / ton)`, {
          type: 'number',
          step: '0.0001',
          required: m === 'A1',
          hint: { A1: 'Winning van de grondstof zelf.', A2: 'Transport naar uw eigen productiesite.', A3: 'Verwerking op uw site.' }[m],
        }),
      ),
      checkField('includesInboundTransport', 'Levering franco: het transport naar de klant zit al in deze cijfers', {
        hint: 'Aanvinken voorkomt dat de afnemer het transport een tweede keer aanrekent.',
      }),
    ],
    submitLabel: 'Registreren',
    submitIcon: 'plus',
    onSubmit: async (values, close) => {
      await api.post('/materials', {
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
          modules.filter((m) => values[`gwp_${m}`] !== null && values[`gwp_${m}`] !== '').map((m) => [m, { GWP_TOTAL: values[`gwp_${m}`] }]),
        ),
      });
      close();
      toast('Grondstof geregistreerd.', 'ok');
      await onDone();
    },
  });
}
