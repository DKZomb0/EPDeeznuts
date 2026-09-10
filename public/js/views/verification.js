/**
 * The verifier's working list.
 *
 * Split in two on purpose: dossiers waiting for a decision, and the dossiers
 * that never came past because the change stayed inside the agreed margin. The
 * second list is what the verifier's own oversight rests on - it has to be able
 * to see what it did *not* see.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { card, dataTable, badge, verdictBadge, statusBadge, note, pageHead, tabs } from '../lib/ui.js';
import { date, relative, pct } from '../lib/format.js';

const { div, span, strong, a } = tags;

export async function render(outlet, { setTitle, navigate }) {
  setTitle('Verificatiedossiers', '');
  const { declarations } = await api.get('/declarations');

  const open = declarations.filter((d) => ['SUBMITTED', 'UNDER_VERIFICATION'].includes(d.status));
  const inherited = declarations.filter((d) => d.status === 'AUTO_ACCEPTED');
  const done = declarations.filter((d) => ['VERIFIED', 'PUBLISHED', 'REJECTED'].includes(d.status));

  let active = 'open';
  const host = div();

  const draw = () => {
    mount(
      host,
      tabs(
        [
          { key: 'open', label: `Te behandelen (${open.length})` },
          { key: 'inherited', label: `Automatisch aanvaard (${inherited.length})` },
          { key: 'done', label: `Afgehandeld (${done.length})` },
        ],
        active,
        (key) => {
          active = key;
          draw();
        },
      ),
      active === 'open'
        ? card('Wachtrij', queueTable(open, navigate), { flush: true, hint: 'Op volgorde van indiening.' })
        : null,
      active === 'inherited'
        ? card(
            'Wijzigingen die de verificatie erfden',
            div(
              {},
              note(
                'info',
                strong({}, 'Waarom deze lijst bestaat: '),
                'kleine receptuurwijzigingen komen niet bij u terecht. Om dat verdedigbaar te houden, moet u wél kunnen nakijken welke wijzigingen langs de automatische poort gingen en met welke afwijking.',
              ),
              dataTable(
                [
                  { label: 'Receptuur', render: (d) => div({}, strong({}, d.recipe_code), span({ class: 'sub' }, d.producer_name)) },
                  { label: 'Versie', render: (d) => `v${d.version_no}` },
                  { label: 'Afwijking', align: 'right', render: (d) => pct(d.bypass_deviation, 2) },
                  { label: 'Certificaat', render: (d) => span({ class: 'mono tiny' }, d.certificate_no ?? '—') },
                  { label: 'Oordeel', render: (d) => verdictBadge(d.verdict) },
                  { label: 'Wanneer', render: (d) => relative(d.created_at) },
                ],
                inherited,
                { compact: true, onRow: (d) => navigate(`/declarations/${d.id}`), emptyText: 'Nog geen enkele wijziging ging automatisch door.' },
              ),
            ),
          )
        : null,
      active === 'done'
        ? card(
            'Afgehandeld',
            dataTable(
              [
                { label: 'Receptuur', render: (d) => div({}, strong({}, d.recipe_code), span({ class: 'sub' }, d.producer_name)) },
                { label: 'Versie', render: (d) => `v${d.version_no}` },
                { label: 'Status', render: (d) => statusBadge(d.status) },
                { label: 'Oordeel', render: (d) => verdictBadge(d.verdict) },
                { label: 'Certificaat', render: (d) => span({ class: 'mono tiny' }, d.certificate_no ?? '—') },
                { label: 'Geldig tot', render: (d) => (d.valid_until ? date(d.valid_until) : '—') },
              ],
              done,
              { compact: true, onRow: (d) => navigate(`/declarations/${d.id}`) },
            ),
            { flush: true },
          )
        : null,
    );
  };

  mount(
    outlet,
    pageHead(
      'Verificatiedossiers',
      'U controleert de gegevens en de toepassing van de rekenregels. Het platform rekent; het oordeel blijft van u.',
    ),
    host,
  );
  draw();
}

function queueTable(rows, navigate) {
  return dataTable(
    [
      { label: 'Receptuur', render: (d) => div({}, strong({}, d.recipe_code), span({ class: 'sub' }, d.recipe_name)) },
      { label: 'Producent', render: (d) => d.producer_name },
      { label: 'Versie', render: (d) => `v${d.version_no}` },
      { label: 'Bereik', render: (d) => badge(d.scope, 'info') },
      { label: 'Oordeel', render: (d) => verdictBadge(d.verdict) },
      { label: 'Status', render: (d) => statusBadge(d.status) },
      { label: 'Ingediend', render: (d) => relative(d.submitted_at) },
      { label: '', align: 'right', render: (d) => a({ href: `#/declarations/${d.id}`, class: 'btn btn--small' }, 'Behandelen') },
    ],
    rows,
    { onRow: (d) => navigate(`/declarations/${d.id}`), emptyTitle: 'Wachtrij leeg', emptyText: 'Er wacht momenteel geen dossier op verificatie.' },
  );
}
