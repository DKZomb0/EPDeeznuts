/**
 * Sector averages and the TOTEM export.
 *
 * The screen leads with the spread rather than the mean. That is the sector's
 * whole argument to the administration: a single generic figure per strength
 * class hides a range wide enough to make a design calculation meaningless, so
 * the dispersion travels with the number wherever it goes.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { can } from '../app.js';
import {
  card, dataTable, stat, badge, note, pageHead, spreadChart, toast, modal, formModal,
  textField, selectField, ref, empty,
} from '../lib/ui.js';
import { smart, date, pct } from '../lib/format.js';

const { div, span, strong, button, p, select, option, pre, small, a } = tags;

export async function render(outlet, { setTitle }) {
  setTitle('Sectorgemiddelden', '');

  let strengthClass = '';
  let method = 'VOLUME_WEIGHTED';
  const host = div();

  const load = async () => {
    mount(host, div({ class: 'empty' }, 'Bezig met berekenen…'));
    const { aggregation } = await api.get(`/aggregation/preview${qs({ strengthClass, method })}`);
    const { aggregations } = await api.get('/aggregations');
    draw(aggregation, aggregations);
  };

  const draw = (aggregation, saved) => {
    const unit = aggregation.lead.unit;

    mount(
      host,
      aggregation.sampleSize === 0
        ? card('Geen gegevens', empty('Nog geen gepubliceerde declaraties in deze selectie', 'Enkel volledig BEPD-gedekte, gepubliceerde dossiers tellen mee.'))
        : div(
            {},
            div(
              { class: 'grid grid--4 mb-2' },
              stat({ label: 'Gewogen gemiddelde', value: smart(aggregation.lead.weightedMean), unit, note: 'gewogen op geleverd volume' }),
              stat({ label: 'Bandbreedte', value: `${smart(aggregation.lead.min)} – ${smart(aggregation.lead.max)}`, unit, note: `spreiding ${pct(aggregation.lead.spreadPct, 0)} t.o.v. het gemiddelde`, tone: 'warn' }),
              stat({ label: 'Variatiecoëfficiënt', value: pct(aggregation.lead.cv, 1), note: 'standaardafwijking / gemiddelde' }),
              stat({ label: 'Aantal declaraties', value: String(aggregation.sampleSize), note: `${smart(aggregation.totalWeight)} m³ gewicht` }),
            ),

            note(
              'warn',
              strong({}, 'Het gemiddelde alleen is misleidend. '),
              `De opgenomen declaraties lopen van ${smart(aggregation.lead.min)} tot ${smart(aggregation.lead.max)} ${unit} voor dezelfde toepassing. `,
              'Een ontwerpberekening op het gemiddelde kan er daardoor ver naast zitten — vandaar dat de spreiding altijd meegepubliceerd wordt.',
            ),

            card(
              'Opgenomen declaraties',
              div(
                {},
                spreadChart(
                  [{ label: aggregation.filter.strengthClass ?? 'Alle klassen', min: aggregation.lead.min, max: aggregation.lead.max, mean: aggregation.lead.mean, weightedMean: aggregation.lead.weightedMean }],
                  { unit },
                ),
                dataTable(
                  [
                    { label: 'Bron', render: (s) => div({}, strong({}, s.producerRef), span({ class: 'sub' }, s.recipeCode)) },
                    { label: 'Klasse', render: (s) => s.strengthClass ?? '—' },
                    { label: 'Omgevingsklassen', render: (s) => span({ class: 'small muted' }, s.exposureClasses ?? '—') },
                    { label: 'Gewicht', align: 'right', render: (s) => (s.hasDeliveries ? `${smart(s.weight)} m³` : span({ class: 'muted small' }, 'geen leveringen')) },
                    { label: `GWP (${unit})`, align: 'right', render: (s) => strong({}, smart(s.lead)) },
                  ],
                  aggregation.samples,
                  { compact: true },
                ),
              ),
              {
                flush: false,
                hint: 'Producenten worden gepseudonimiseerd: de federatie publiceert een sectorwaarde, geen rangschikking van haar eigen leden.',
              },
            ),

            card(
              'Alle indicatoren',
              dataTable(
                [
                  { label: 'Indicator', render: (r) => div({}, strong({}, r.short), span({ class: 'sub' }, r.label)) },
                  { label: 'Eenheid', render: (r) => span({ class: 'small muted' }, r.unit) },
                  { label: 'Gewogen gemiddelde', align: 'right', render: (r) => smart(r.stats.weightedMean) },
                  { label: 'Min', align: 'right', render: (r) => smart(r.stats.min) },
                  { label: 'Mediaan', align: 'right', render: (r) => smart(r.stats.median) },
                  { label: 'Max', align: 'right', render: (r) => smart(r.stats.max) },
                  // Not "σ": the table headers are uppercased in CSS, which would
                  // turn a lowercase sigma into a summation sign.
                  { label: 'Std.afw.', align: 'right', render: (r) => smart(r.stats.stdev) },
                ],
                (ref().indicators ?? []).map((indicator) => ({ ...indicator, stats: aggregation.indicators[indicator.code] })),
                { compact: true },
              ),
              { flush: true },
            ),
          ),

      card(
        'Vastgelegde gemiddelden',
        dataTable(
          [
            { label: 'Benaming', render: (r) => strong({}, r.label) },
            { label: 'Klasse', render: (r) => r.strength_class ?? 'alle' },
            { label: 'Methode', render: (r) => badge(r.method === 'SIMPLE' ? 'Ongewogen' : 'Volumegewogen', 'info') },
            { label: 'n', align: 'right', render: (r) => String(r.sample_size) },
            { label: 'Opgesteld', render: (r) => date(r.created_at) },
            { label: '', align: 'right', render: (r) => button({ class: 'btn btn--small', onClick: () => showTotem(r.id) }, 'TOTEM-export') },
          ],
          saved,
          { compact: true, emptyText: 'Nog geen gemiddelde vastgelegd.' },
        ),
        { flush: true, hint: 'Een vastgelegd gemiddelde bevriest de berekening zodat ze later citeerbaar en herleidbaar blijft.' },
      ),
    );
  };

  mount(
    outlet,
    pageHead(
      'Sectorgemiddelden',
      'Generieke waarden voor de ontwerpfase. Een architect kent in het ontwerp nog niet welke centrale zal leveren; deze cijfers vullen dat gat — samen met hun bandbreedte.',
      can('aggregation:write') ? [button({ class: 'btn btn--accent', onClick: () => save(strengthClass, method) }, 'Gemiddelde vastleggen')] : null,
    ),
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
  );

  await load();
}

function save(strengthClass, method) {
  formModal({
    title: 'Sectorgemiddelde vastleggen',
    hint: 'De huidige berekening wordt bevroren en krijgt een eigen kenmerk, zodat ernaar verwezen kan worden.',
    fields: [
      textField('label', 'Benaming', { required: true, placeholder: `Sectorgemiddelde ${strengthClass || 'alle klassen'} ${new Date().getFullYear()}` }),
      note('muted', `Selectie: ${strengthClass || 'alle sterkteklassen'} · ${method === 'SIMPLE' ? 'ongewogen' : 'volumegewogen'}.`),
    ],
    submitLabel: 'Vastleggen',
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
      {},
      note('info', 'Deze structuur bevat naast de waarde ook min, max, standaardafwijking en steekproefgrootte per indicator — een gemiddelde zonder spreiding vertrekt hier niet.'),
      pre(
        { style: { background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '6px', padding: '14px', overflow: 'auto', maxHeight: '46vh', fontSize: '11.5px' } },
        JSON.stringify(payload, null, 2),
      ),
    ),
    actions: (close) => [
      button(
        {
          class: 'btn',
          onClick: async () => {
            await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
            toast('Gekopieerd naar het klembord.', 'ok');
          },
        },
        'Kopiëren',
      ),
      button({ class: 'btn btn--primary', onClick: close }, 'Sluiten'),
    ],
  });
}
