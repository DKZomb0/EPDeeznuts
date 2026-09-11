/**
 * Generieke waarden → TOTEM.
 *
 * Het scherm zet de spreiding vooraan in plaats van het gemiddelde. Dat is het
 * hele argument richting de administratie: één generiek getal per klasse
 * verbergt een bandbreedte die breed genoeg is om een ontwerpberekening
 * betekenisloos te maken, dus reist de spreiding mee met het getal.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { can } from '../app.js';
import {
  panel, card, kpiStrip, tablePanel, banner, tag, pageHead, toast, modal, formModal,
  rangeBar, btn, textField, selectField, ref, smart, pct, date, empty,
} from '../lib/ui.js';

const { div, span, strong, p, pre, select, option, small } = tags;

export async function render(outlet, { setTitle }) {
  setTitle('Generieke waarden');

  let strengthClass = '';
  let method = 'VOLUME_WEIGHTED';
  const host = div({ class: 'stack' });

  const load = async () => {
    mount(host, div({ class: 'empty' }, 'Bezig met berekenen…'));
    const [{ aggregation }, { aggregations }] = await Promise.all([
      api.get(`/aggregation/preview${qs({ strengthClass, method })}`),
      api.get('/aggregations'),
    ]);
    draw(aggregation, aggregations);
  };

  const draw = (aggregation, saved) => {
    const unit = aggregation.lead.unit;
    const scaleMax = aggregation.lead.max * 1.08 || 1;

    mount(
      host,
      aggregation.sampleSize === 0
        ? panel({ body: empty('Nog geen gepubliceerde declaraties in deze selectie', 'Enkel volledig BEPD-gedekte, gepubliceerde dossiers tellen mee.') })
        : div(
            { class: 'stack' },
            kpiStrip([
              { label: 'Gewogen gemiddelde', value: smart(aggregation.lead.weightedMean), note: `${unit} · gewogen op geleverd volume` },
              { label: 'Bandbreedte', value: `${smart(aggregation.lead.min)} – ${smart(aggregation.lead.max)}`, note: `spreiding ${pct(aggregation.lead.spreadPct, 0)} t.o.v. het gemiddelde` },
              { label: 'Variatiecoëfficiënt', value: pct(aggregation.lead.cv, 1), note: 'standaardafwijking / gemiddelde' },
              { label: "BEPD's", value: String(aggregation.sampleSize), note: `${smart(aggregation.totalWeight)} m³ gewicht` },
            ]),

            banner('warn', {
              icon: 'warning',
              title: 'Het gemiddelde alleen is misleidend',
              body: `De opgenomen declaraties lopen van ${smart(aggregation.lead.min)} tot ${smart(aggregation.lead.max)} ${unit} voor dezelfde toepassing. Een ontwerpberekening op het gemiddelde kan er daardoor ver naast zitten — vandaar dat de spreiding altijd meegepubliceerd wordt.`,
            }),

            panel({
              title: 'Opgenomen declaraties',
              sub: 'Producenten worden gepseudonimiseerd: de federatie publiceert een sectorwaarde, geen rangschikking van haar eigen leden.',
              variant: 'flush',
              body: tablePanel(
                [
                  { label: 'Bron', render: (s) => div({}, div({ class: 'strong' }, s.producerRef), div({ class: 'sub' }, s.recipeCode)) },
                  { label: 'Klasse', muted: true, render: (s) => s.strengthClass ?? '—' },
                  { label: 'Omgevingsklasse', muted: true, render: (s) => s.exposureClasses ?? '—' },
                  { label: 'Gewicht', align: 'right', muted: true, render: (s) => (s.hasDeliveries ? `${smart(s.weight)} m³` : 'geen leveringen') },
                  { label: 'Spreiding', width: '24%', render: (s) => rangeBar({ min: 0, max: s.lead, mean: s.lead, scaleMax }) },
                  { label: `GWP (${unit})`, align: 'right', render: (s) => strong({ class: 'tnum' }, smart(s.lead)) },
                ],
                aggregation.samples,
              ),
            }),

            panel({
              title: 'Alle indicatoren',
              variant: 'flush',
              body: tablePanel(
                [
                  { label: 'Indicator', render: (r) => div({}, div({ class: 'strong' }, r.short), div({ class: 'sub' }, r.label)) },
                  { label: 'Eenheid', muted: true, render: (r) => r.unit },
                  { label: 'Gewogen gemiddelde', align: 'right', render: (r) => smart(r.stats.weightedMean) },
                  { label: 'Min', align: 'right', muted: true, render: (r) => smart(r.stats.min) },
                  { label: 'Mediaan', align: 'right', muted: true, render: (r) => smart(r.stats.median) },
                  { label: 'Max', align: 'right', muted: true, render: (r) => smart(r.stats.max) },
                  // Niet "σ": tabelkoppen staan in kapitalen, wat een kleine
                  // sigma in een somteken zou veranderen.
                  { label: 'Std.afw.', align: 'right', muted: true, render: (r) => smart(r.stats.stdev) },
                ],
                (ref().indicators ?? []).map((indicator) => ({ ...indicator, stats: aggregation.indicators[indicator.code] })),
              ),
            }),
          ),

      panel({
        title: 'Vastgelegde gemiddelden',
        sub: 'Een vastgelegd gemiddelde bevriest de berekening zodat ze later citeerbaar en herleidbaar blijft.',
        variant: 'flush',
        body: tablePanel(
          [
            { label: 'Benaming', render: (r) => strong({}, r.label) },
            { label: 'Klasse', muted: true, render: (r) => r.strength_class ?? 'alle' },
            { label: 'Methode', render: (r) => tag(r.method === 'SIMPLE' ? 'Ongewogen' : 'Volumegewogen', 'tag-quiet') },
            { label: "BEPD's", align: 'right', muted: true, render: (r) => String(r.sample_size) },
            { label: 'Opgesteld', muted: true, render: (r) => date(r.created_at) },
            { label: '', align: 'right', render: (r) => btn('TOTEM-export', { variant: 'ghost', small: true, icon: 'upload', onClick: () => showTotem(r.id) }) },
          ],
          saved,
          { emptyTitle: 'Nog geen gemiddelde vastgelegd', emptyText: 'Leg de huidige berekening vast om ernaar te kunnen verwijzen.' },
        ),
      }),

      div(
        { class: 'grid grid--cards' },
        card({
          kicker: 'Spreiding is het argument',
          title: '150 – 600 kg CO₂e/m³',
          body: 'Eén generiek getal voor "beton" verbergt een factor vier. Zolang de spreiding zichtbaar blijft, blijft de berekening van het materiaalpeil verdedigbaar.',
        }),
        card({
          kicker: 'Twee getallen, één project',
          title: 'Ontwerp vs. as-built',
          body: 'De ontwerpwaarde komt uit deze tabel, de as-built waarde uit de effectieve leveringen. Het platform bewaart beide, met de datum waarop ze golden.',
        }),
        card({
          kicker: 'Koppeling',
          title: 'API in plaats van invoerkracht',
          body: 'Centrales koppelen hun ERP — drie pakketten dekken de markt. Niemand typt vijfduizend recepturen over.',
        }),
      ),
    );
  };

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        title: 'Generieke waarden → TOTEM',
        lede:
          "Geverifieerde BEPD's worden samengevoegd per sterkte- en omgevingsklasse. De architect rekent in ontwerpfase met deze waarde; de spreiding blijft zichtbaar.",
        actions: can('aggregation:write') ? [btn('Publiceren naar TOTEM', { variant: 'primary', icon: 'upload', onClick: () => save(strengthClass, method) })] : null,
      }),
      div(
        { class: 'toolbar' },
        select(
          {
            onChange: (e) => {
              strengthClass = e.target.value;
              load();
            },
          },
          option({ value: '' }, 'Alle sterkteklassen'),
          (ref().strengthClasses ?? []).map((c) => option({ value: c.code }, c.code)),
        ),
        select(
          {
            onChange: (e) => {
              method = e.target.value;
              load();
            },
          },
          option({ value: 'VOLUME_WEIGHTED' }, 'Gewogen op geleverd volume'),
          option({ value: 'SIMPLE' }, 'Ongewogen gemiddelde'),
        ),
      ),
      host,
    ),
  );

  await load();
}

function save(strengthClass, method) {
  formModal({
    title: 'Sectorgemiddelde vastleggen',
    hint: 'De huidige berekening wordt bevroren en krijgt een eigen kenmerk, zodat ernaar verwezen kan worden.',
    fields: [
      textField('label', 'Benaming', { required: true, placeholder: `Sectorgemiddelde ${strengthClass || 'alle klassen'} ${new Date().getFullYear()}` }),
      banner('plain', { icon: 'info', body: `Selectie: ${strengthClass || 'alle sterkteklassen'} · ${method === 'SIMPLE' ? 'ongewogen' : 'volumegewogen'}.` }),
    ],
    submitLabel: 'Vastleggen',
    submitIcon: 'check',
    onSubmit: async (values, close) => {
      await api.post('/aggregations', { ...values, strengthClass: strengthClass || null, method });
      close();
      toast('Sectorgemiddelde vastgelegd.', 'ok');
      location.reload();
    },
  });
}

async function showTotem(aggregationId) {
  const { payload } = await api.get(`/aggregations/${aggregationId}/totem`);
  modal({
    title: 'Export naar TOTEM',
    hint: 'De uitwisselvorm met OVAM ligt nog niet vast, dus de payload beschrijft zichzelf: eenheden, bereik en grondslag reizen mee met de cijfers.',
    wide: true,
    body: div(
      { class: 'flex-col' },
      banner('plain', {
        icon: 'info',
        body: 'Deze structuur bevat naast de waarde ook min, max, standaardafwijking en steekproefgrootte per indicator — een gemiddelde zonder spreiding vertrekt hier niet.',
      }),
      pre({ class: 'formula-block', style: { maxHeight: '46vh', overflow: 'auto' } }, JSON.stringify(payload, null, 2)),
    ),
    actions: (close) => [
      btn('Kopiëren', {
        variant: 'secondary',
        icon: 'clipboard',
        onClick: async () => {
          await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
          toast('Gekopieerd naar het klembord.', 'ok');
        },
      }),
      btn('Sluiten', { variant: 'primary', onClick: close }),
    ],
  });
}
