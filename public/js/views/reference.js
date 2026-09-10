/**
 * The rule book: factors, category rules and the change-control thresholds.
 *
 * The administration's condition was that the calculation rules are open and
 * checkable. So they are a normal screen in the application, readable by every
 * party, rather than something buried in a configuration file.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { can } from '../app.js';
import { card, dataTable, badge, note, pageHead, tabs, stat, toast, formModal, textField, selectField, ref } from '../lib/ui.js';
import { smart, date } from '../lib/format.js';

const { div, span, strong, p, button, small } = tags;

export async function render(outlet, { setTitle }) {
  setTitle('Rekenregels en masterdata', '');
  let active = 'thresholds';
  const host = div();

  const draw = () => {
    const reference = ref();
    mount(
      host,
      tabs(
        [
          { key: 'thresholds', label: 'Drempelwaarden' },
          { key: 'transport', label: 'Transportprofielen' },
          { key: 'energy', label: 'Energie en hulpstromen' },
          { key: 'process', label: 'Generieke procesparameters' },
          { key: 'rules', label: 'Verplichte modules' },
          { key: 'indicators', label: 'Indicatorenset' },
        ],
        active,
        (key) => {
          active = key;
          draw();
        },
      ),
      active === 'thresholds' ? thresholds(reference) : null,
      active === 'transport' ? transport(reference) : null,
      active === 'energy' ? energy(reference) : null,
      active === 'process' ? process(reference) : null,
      active === 'rules' ? rules(reference) : null,
      active === 'indicators' ? indicators(reference) : null,
    );
  };

  mount(
    outlet,
    pageHead(
      'Rekenregels en masterdata',
      'Alles waarmee gerekend wordt, staat hier open: elke factor met haar bron en haar ingangsdatum, en de marges die bepalen wanneer een wijziging opnieuw langs een verificateur moet.',
    ),
    note(
      'info',
      strong({}, 'Waarom dit een gewoon scherm is. '),
      'De federale administratie aanvaardt deze werkwijze op voorwaarde dat de gehanteerde rekenregels sluitend en transparant zijn. Dan horen ze zichtbaar te zijn voor élke partij, niet enkel voor wie de databank beheert.',
    ),
    host,
  );

  draw();
}

/* ------------------------------------------------------------------ */

function thresholds(reference) {
  const settings = reference.settings ?? {};

  return div(
    {},
    card(
      'Wanneer moet een wijziging opnieuw geverifieerd worden?',
      div(
        {},
        p(
          { class: 'small' },
          'Een betoncentrale past haar recepturen voortdurend aan. Elke aanpassing langs een externe verificatie sturen is onbetaalbaar; geen enkele controleren is onverdedigbaar. Daarom drie grendels tegelijk:',
        ),
        div(
          { class: 'grid grid--3 mt-2' },
          stat({ label: 'Marge per wijziging', value: settings.bypass_tolerance_pct ?? '—', unit: '%', note: 'GWP-verschil t.o.v. de vorige declaratie' }),
          stat({ label: 'Opgetelde drift', value: settings.bypass_cumulative_pct ?? '—', unit: '%', note: 'sinds de laatste volledige verificatie' }),
          stat({ label: 'Opeenvolgende bypasses', value: settings.bypass_max_consecutive ?? '—', unit: 'x', note: 'daarna altijd een volledige controle' }),
          stat({ label: 'Marge op levering', value: settings.delivery_tolerance_pct ?? '—', unit: '%', note: 'geleverd t.o.v. gedeclareerd' }),
          stat({ label: 'Geldigheid declaratie', value: settings.declaration_validity_months ?? '—', unit: 'maanden' }),
          stat({ label: 'Nieuwe grondstof', value: settings.bypass_allow_new_material === '1' ? 'toegelaten' : 'altijd controleren', note: 'gewijzigde samenstelling' }),
        ),
        note(
          'warn',
          strong({}, 'De opgetelde drift is geen detail. '),
          'Zonder die grendel zijn twintig opeenvolgende wijzigingen van 2,5 % samen een wijziging van 50 % die nooit een verificateur zag. De marge per stap alleen sluit dat niet af.',
        ),
      ),
      {
        actions: can('settings:write') ? [button({ class: 'btn btn--small btn--accent', onClick: () => editSettings(settings) }, 'Aanpassen')] : null,
        hint: 'Deze waarden worden op Vlaams niveau nog besproken. Ze staan hier bewust als instelling, niet als vaste code.',
      },
    ),
  );
}

function transport(reference) {
  return card(
    'Transportprofielen',
    dataTable(
      [
        { label: 'Profiel', render: (r) => div({}, strong({}, r.name), span({ class: 'sub mono' }, r.code)) },
        { label: 'Modus', render: (r) => badge(modeLabel(r.mode), 'info') },
        { label: 'Laadvermogen', align: 'right', render: (r) => (r.payload_t ? `${smart(r.payload_t)} t` : '—') },
        { label: 'Leegrit', render: (r) => (r.empty_return ? 'inbegrepen' : 'niet inbegrepen') },
        { label: 'Geldig vanaf', render: (r) => date(r.valid_from) },
        { label: 'Bron', render: (r) => span({ class: 'small muted' }, r.source) },
      ],
      reference.transportProfiles ?? [],
      { compact: true },
    ),
    {
      flush: true,
      hint: 'Een centrale aan het water haalt haar granulaten per schip: over honderd kilometer nog altijd een fractie van de uitstoot van wegtransport. Precies daarom kan A2 niet generiek zijn.',
    },
  );
}

function energy(reference) {
  return card(
    'Energie- en hulpstroomfactoren',
    dataTable(
      [
        { label: 'Factor', render: (r) => div({}, strong({}, r.name), span({ class: 'sub mono' }, r.code)) },
        { label: 'Eenheid', render: (r) => span({ class: 'mono small' }, r.unit) },
        { label: 'Geldig vanaf', render: (r) => date(r.valid_from) },
        { label: 'Bron', render: (r) => span({ class: 'small muted' }, r.source) },
        { label: 'Nota', render: (r) => span({ class: 'small muted' }, r.note ?? '') },
      ],
      reference.energyFactors ?? [],
      { compact: true },
    ),
    { flush: true },
  );
}

function process(reference) {
  return card(
    'Generieke procesparameters',
    div(
      {},
      note(
        'info',
        'Dit zijn de waarden waar een centrale op terugvalt als ze haar eigen verbruik niet meet. Wie wél meet, mag overschrijven — met een verantwoording die de verificateur toetst.',
      ),
      dataTable(
        [
          { label: 'Parameter', render: (r) => div({}, strong({}, defLabel(r.code, reference)), span({ class: 'sub mono' }, r.code)) },
          { label: 'Module', render: (r) => badge(moduleOf(r.code, reference), 'info') },
          { label: 'Sectorwaarde', align: 'right', render: (r) => `${smart(r.value)} ${r.unit}` },
          { label: 'Bron', render: (r) => span({ class: 'small muted' }, r.source) },
          { label: 'Nota', render: (r) => span({ class: 'small muted' }, r.note ?? '') },
        ],
        reference.processDefaults ?? [],
        { compact: true },
      ),
    ),
  );
}

function rules(reference) {
  return card(
    'Verplichte modules per grondstofcategorie',
    div(
      {},
      note(
        'muted',
        strong({}, 'Waarom cement stopt bij A3. '),
        'Het transport van cement naar de betoncentrale is de A2 van die centrale. Een cementfabriek A4 en A5 laten certificeren zou een aparte declaratie per bestemming betekenen — voor elke levering opnieuw.',
      ),
      dataTable(
        [
          { label: 'Categorie', render: (r) => strong({}, categoryLabel(r.category, reference)) },
          { label: 'Verplicht', render: (r) => div({ class: 'flex wrap' }, r.required_modules.split(',').map((m) => badge(m.trim(), 'info'))) },
          { label: 'Optioneel', render: (r) => (r.optional_modules ? div({ class: 'flex wrap' }, r.optional_modules.split(',').map((m) => badge(m.trim(), 'muted'))) : span({ class: 'muted' }, '—')) },
          { label: 'Grondslag', render: (r) => span({ class: 'small muted' }, r.source) },
          { label: 'Nota', render: (r) => span({ class: 'small muted' }, r.note ?? '') },
        ],
        reference.categoryRules ?? [],
        { compact: true },
      ),
    ),
  );
}

function indicators(reference) {
  return card(
    'Milieu-indicatoren (EN 15804+A2)',
    dataTable(
      [
        { label: 'Code', render: (r) => span({ class: 'mono small' }, r.code) },
        { label: 'Korte naam', render: (r) => strong({}, r.short) },
        { label: 'Volledige naam', render: (r) => r.label },
        { label: 'Eenheid', render: (r) => span({ class: 'small muted' }, r.unit) },
        { label: 'Groep', render: (r) => badge(r.group === 'IMPACT' ? 'Effect' : 'Hulpbron', 'muted') },
      ],
      reference.indicators ?? [],
      { compact: true },
    ),
    {
      flush: true,
      hint: 'Elke declaratie rapporteert de volledige set. GWP-totaal wordt overal vooropgezet omdat het de indicator is waarop de wijzigingscontrole toetst.',
    },
  );
}

/* ------------------------------------------------------------------ */

function editSettings(settings) {
  formModal({
    title: 'Drempelwaarden aanpassen',
    hint: 'Elke wijziging komt met naam en tijdstip in de audittrail. Deze waarden bepalen mee welke dossiers een externe verificatie krijgen.',
    fields: [
      textField('bypass_tolerance_pct', 'Marge per wijziging (%)', { type: 'number', step: '0.1', value: settings.bypass_tolerance_pct }),
      textField('bypass_cumulative_pct', 'Opgetelde drift (%)', { type: 'number', step: '0.1', value: settings.bypass_cumulative_pct }),
      textField('bypass_max_consecutive', 'Max. opeenvolgende bypasses', { type: 'number', step: '1', value: settings.bypass_max_consecutive }),
      textField('delivery_tolerance_pct', 'Marge op levering (%)', { type: 'number', step: '0.1', value: settings.delivery_tolerance_pct }),
      textField('declaration_validity_months', 'Geldigheid declaratie (maanden)', { type: 'number', step: '1', value: settings.declaration_validity_months }),
      selectField('bypass_allow_new_material', 'Nieuwe grondstof in de samenstelling', [
        { value: '0', label: 'Altijd naar de verificateur' },
        { value: '1', label: 'Toegelaten binnen de marge' },
      ], { value: settings.bypass_allow_new_material ?? '0', placeholder: false }),
    ],
    submitLabel: 'Opslaan',
    onSubmit: async (values, close) => {
      await api.patch('/settings', Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])));
      close();
      toast('Drempelwaarden aangepast.', 'ok');
      location.reload();
    },
  });
}

function modeLabel(mode) {
  return { ROAD: 'Weg', INLAND_SHIP: 'Binnenvaart', RAIL: 'Spoor', MIXER: 'Mixer' }[mode] ?? mode;
}

function defLabel(code, reference) {
  return (reference.parameterDefs ?? []).find((d) => d.code === code)?.label ?? code;
}

function moduleOf(code, reference) {
  return (reference.parameterDefs ?? []).find((d) => d.code === code)?.module ?? '—';
}

function categoryLabel(code, reference) {
  return (reference.materialCategories ?? []).find((c) => c.code === code)?.label ?? code;
}
