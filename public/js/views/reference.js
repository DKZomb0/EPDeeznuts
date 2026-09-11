/**
 * Het regelboek: factoren, categorieregels en de drempelwaarden.
 *
 * De voorwaarde van de administratie was dat de rekenregels open en toetsbaar
 * zijn. Dus zijn ze een gewoon scherm, leesbaar voor elke partij, in plaats van
 * iets dat in een configuratiebestand verstopt zit.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { can } from '../app.js';
import { panel, card, kpiStrip, tablePanel, banner, tag, pageHead, tabs, toast, formModal, textField, selectField, btn, ref, smart, date, empty } from '../lib/ui.js';

const { div, span, strong, p, small } = tags;

export async function render(outlet, { setTitle }) {
  setTitle('Rekenregels');
  let active = 'thresholds';
  const host = div();

  const draw = () => {
    const reference = ref();
    mount(
      host,
      tabs(
        [
          { key: 'thresholds', label: 'Bandbreedte' },
          { key: 'transport', label: 'Transportprofielen' },
          { key: 'energy', label: 'Energie en hulpstromen' },
          { key: 'process', label: 'Generieke procesparameters' },
          { key: 'rules', label: 'Verplichte fasen' },
          { key: 'indicators', label: 'Indicatorenset' },
        ],
        active,
        (key) => {
          active = key;
          draw();
        },
      ),
      { thresholds, transport, energy, process, rules, indicators }[active](reference),
    );
  };

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        title: 'Rekenregels en masterdata',
        lede:
          'Alles waarmee gerekend wordt staat hier open: elke factor met haar bron en haar ingangsdatum, en de marges die bepalen wanneer een wijziging opnieuw langs een controlebureau moet.',
      }),
      banner('plain', {
        icon: 'info',
        title: 'Waarom dit een gewoon scherm is',
        body:
          'De federale administratie aanvaardt deze werkwijze op voorwaarde dat de gehanteerde rekenregels sluitend en transparant zijn. Dan horen ze zichtbaar te zijn voor élke partij, niet enkel voor wie de databank beheert.',
      }),
      host,
    ),
  );

  draw();
}

/* ------------------------------------------------------------------ */

function thresholds(reference) {
  const settings = reference.settings ?? {};

  return div(
    { class: 'stack' },
    panel({
      title: 'Wanneer moet een wijziging opnieuw geverifieerd worden?',
      sub: 'Deze waarden worden op Vlaams niveau nog besproken. Ze staan hier bewust als instelling, niet als vaste code.',
      actions: can('settings:write') ? [btn('Aanpassen', { variant: 'secondary', small: true, icon: 'gear', onClick: () => editSettings(settings) })] : null,
      body: div(
        {},
        p(
          { class: 'small dim' },
          'Een betoncentrale past haar recepturen voortdurend aan. Elke aanpassing langs een externe verificatie sturen is onbetaalbaar; geen enkele controleren is onverdedigbaar. Daarom drie grendels tegelijk:',
        ),
        div(
          { class: 'mt-2' },
          kpiStrip([
            { label: 'Marge per wijziging', value: `±${settings.bypass_tolerance_pct ?? '—'}%`, note: 'GWP t.o.v. de vorige declaratie' },
            { label: 'Opgetelde drift', value: `±${settings.bypass_cumulative_pct ?? '—'}%`, note: 'sinds de laatste volledige verificatie' },
            { label: 'Opeenvolgende bypasses', value: settings.bypass_max_consecutive ?? '—', note: 'daarna altijd een volledige controle' },
            { label: 'Marge op levering', value: `±${settings.delivery_tolerance_pct ?? '—'}%`, note: 'geleverd t.o.v. gedeclareerd' },
            { label: 'Geldigheid declaratie', value: `${settings.declaration_validity_months ?? '—'}`, note: 'maanden' },
          ]),
        ),
        div(
          { class: 'mt-3' },
          banner('warn', {
            icon: 'warning',
            title: 'De opgetelde drift is geen detail',
            body:
              'Zonder die grendel zijn twintig opeenvolgende wijzigingen van 2,5 % samen een wijziging van 50 % die nooit een controlebureau zag. De marge per stap alleen sluit dat niet af.',
          }),
        ),
        div(
          { class: 'mt-2' },
          kvRow('Nieuwe grondstof in de samenstelling', settings.bypass_allow_new_material === '1' ? 'toegelaten binnen de marge' : 'gaat altijd naar het controlebureau'),
          kvRow('Dossier met een internationale EPD', 'komt nooit in aanmerking voor de bandbreedte'),
          kvRow('Dossier zonder volledige BEPD-dekking', 'kan niet vrijgegeven worden'),
        ),
      ),
    }),
  );
}

function kvRow(label, value) {
  return div({ class: 'flex-between', style: { padding: '7px 0', borderBottom: '1px solid var(--color-divider)', fontSize: '13px' } }, span({ class: 'dim' }, label), strong({}, value));
}

function transport(reference) {
  return panel({
    title: 'Transportprofielen',
    sub:
      'Een centrale aan het water haalt haar granulaten per schip: over honderd kilometer nog altijd een fractie van de uitstoot van wegtransport. Precies daarom kan A2 niet generiek zijn.',
    variant: 'flush',
    body: tablePanel(
      [
        { label: 'Profiel', render: (r) => div({}, div({ class: 'strong' }, r.name), div({ class: 'sub mono' }, r.code)) },
        { label: 'Modus', render: (r) => tag(modeLabel(r.mode), 'tag-quiet') },
        { label: 'Laadvermogen', align: 'right', muted: true, render: (r) => (r.payload_t ? `${smart(r.payload_t)} t` : '—') },
        { label: 'Leegrit', muted: true, render: (r) => (r.empty_return ? 'inbegrepen' : 'niet inbegrepen') },
        { label: 'Geldig vanaf', muted: true, render: (r) => date(r.valid_from) },
        { label: 'Bron', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.source) },
      ],
      reference.transportProfiles ?? [],
    ),
  });
}

function energy(reference) {
  return panel({
    title: 'Energie- en hulpstroomfactoren',
    variant: 'flush',
    body: tablePanel(
      [
        { label: 'Factor', render: (r) => div({}, div({ class: 'strong' }, r.name), div({ class: 'sub mono' }, r.code)) },
        { label: 'Eenheid', muted: true, render: (r) => span({ class: 'mono small' }, r.unit) },
        { label: 'Geldig vanaf', muted: true, render: (r) => date(r.valid_from) },
        { label: 'Bron', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.source) },
        { label: 'Nota', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.note ?? '') },
      ],
      reference.energyFactors ?? [],
    ),
  });
}

function process(reference) {
  return panel({
    title: 'Generieke procesparameters',
    sub:
      'Dit zijn de waarden waar een centrale op terugvalt als ze haar eigen verbruik niet meet. Wie wél meet mag overschrijven — met een verantwoording die het controlebureau toetst.',
    variant: 'flush',
    body: tablePanel(
      [
        { label: 'Parameter', render: (r) => div({}, div({ class: 'strong' }, defLabel(r.code, reference)), div({ class: 'sub mono' }, r.code)) },
        { label: 'Fase', render: (r) => tag(moduleOf(r.code, reference), 'tag-accent') },
        { label: 'Sectorwaarde', align: 'right', render: (r) => `${smart(r.value)} ${r.unit}` },
        { label: 'Bron', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.source) },
        { label: 'Nota', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.note ?? '') },
      ],
      reference.processDefaults ?? [],
    ),
  });
}

function rules(reference) {
  return panel({
    title: 'Verplichte fasen per grondstofcategorie',
    sub:
      'Waarom cement stopt bij A3: het transport van cement naar de betoncentrale is de A2 van die centrale. Een cementfabriek A4 en A5 laten certificeren zou een aparte declaratie per bestemming betekenen.',
    variant: 'flush',
    body: tablePanel(
      [
        { label: 'Categorie', render: (r) => strong({}, categoryLabel(r.category, reference)) },
        { label: 'Verplicht', render: (r) => div({ class: 'flex wrap gap-sm' }, r.required_modules.split(',').map((m) => tag(m.trim(), 'tag-accent'))) },
        { label: 'Optioneel', render: (r) => (r.optional_modules ? div({ class: 'flex wrap gap-sm' }, r.optional_modules.split(',').map((m) => tag(m.trim(), 'tag-quiet'))) : span({ class: 'muted' }, '—')) },
        { label: 'Grondslag', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.source) },
        { label: 'Nota', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.note ?? '') },
      ],
      reference.categoryRules ?? [],
    ),
  });
}

function indicators(reference) {
  return panel({
    title: 'Milieu-indicatoren (EN 15804+A2)',
    sub: 'Elke declaratie rapporteert de volledige set. GWP-totaal staat overal vooraan omdat de wijzigingscontrole daarop toetst.',
    variant: 'flush',
    body: tablePanel(
      [
        { label: 'Code', muted: true, render: (r) => span({ class: 'mono small' }, r.code) },
        { label: 'Korte naam', render: (r) => strong({}, r.short) },
        { label: 'Volledige naam', wrap: true, muted: true, render: (r) => r.label },
        { label: 'Eenheid', muted: true, render: (r) => r.unit },
        { label: 'Groep', render: (r) => tag(r.group === 'IMPACT' ? 'Effect' : 'Hulpbron', 'tag-quiet') },
      ],
      reference.indicators ?? [],
    ),
  });
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
      selectField(
        'bypass_allow_new_material',
        'Nieuwe grondstof in de samenstelling',
        [
          { value: '0', label: 'Altijd naar het controlebureau' },
          { value: '1', label: 'Toegelaten binnen de marge' },
        ],
        { value: settings.bypass_allow_new_material ?? '0', placeholder: false },
      ),
    ],
    submitLabel: 'Opslaan',
    submitIcon: 'check',
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
