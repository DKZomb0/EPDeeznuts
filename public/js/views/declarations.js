/**
 * Declaration list.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state } from '../app.js';
import { card, dataTable, badge, verdictBadge, statusBadge, pageHead, note, ref } from '../lib/ui.js';
import { date, pct, relative } from '../lib/format.js';

const { div, span, strong, a, select, option } = tags;

export async function render(outlet, { setTitle, navigate }) {
  setTitle('Declaraties', state.user.orgName);

  const host = div();
  let statusFilter = '';

  const load = async () => {
    const { declarations } = await api.get(`/declarations${qs({ status: statusFilter })}`);
    mount(host, table(declarations, navigate));
  };

  mount(
    outlet,
    pageHead(
      'Declaraties',
      'Elke ingediende receptuurversie, met haar oordeel en haar weg door de verificatie. Een dossier dat de wijzigingsmarge respecteerde, erfde de verificatie van zijn voorganger.',
    ),
    div(
      { class: 'toolbar' },
      select(
        {
          onChange: (e) => {
            statusFilter = e.target.value;
            load();
          },
        },
        option({ value: '' }, 'Alle statussen'),
        Object.entries(ref().declarationStatusLabels ?? {}).map(([code, label]) => option({ value: code }, label)),
      ),
    ),
    host,
  );

  await load();
}

function table(declarations, navigate) {
  return card(
    `${declarations.length} dossier${declarations.length === 1 ? '' : 's'}`,
    dataTable(
      [
        { label: 'Receptuur', render: (d) => div({}, strong({}, d.recipe_code), span({ class: 'sub' }, d.recipe_name)) },
        { label: 'Producent', render: (d) => d.producer_name },
        { label: 'Versie', render: (d) => `v${d.version_no}` },
        { label: 'Bereik', render: (d) => badge(d.scope, 'info') },
        { label: 'Status', render: (d) => statusBadge(d.status) },
        { label: 'Oordeel', render: (d) => verdictBadge(d.verdict) },
        {
          label: 'Certificaat',
          render: (d) =>
            d.certificate_no
              ? div({}, span({ class: 'mono tiny' }, d.certificate_no), d.bypass_of ? span({ class: 'sub' }, `geërfd · ${pct(d.bypass_deviation, 2)}`) : null)
              : span({ class: 'muted' }, '—'),
        },
        { label: 'Geldig tot', render: (d) => (d.valid_until ? date(d.valid_until) : '—') },
        { label: 'Ingediend', render: (d) => relative(d.submitted_at ?? d.created_at) },
      ],
      declarations,
      { onRow: (d) => navigate(`/declarations/${d.id}`), emptyText: 'Nog geen declaraties ingediend.' },
    ),
    { flush: true },
  );
}
