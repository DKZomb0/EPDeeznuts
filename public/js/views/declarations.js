/**
 * Declaratielijst.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { tablePanel, tag, verdictTag, statusTag, pageHead, btn, ref, pct, date } from '../lib/ui.js';
import { relative } from '../lib/format.js';

const { div, span, strong, select, option } = tags;

export async function render(outlet, { setTitle, navigate }) {
  setTitle('Declaraties');

  const host = div();
  let statusFilter = '';

  const load = async () => {
    const { declarations } = await api.get(`/declarations${qs({ status: statusFilter })}`);
    mount(
      host,
      tablePanel(
        [
          { label: 'Receptuur', render: (d) => div({}, div({ class: 'strong' }, d.recipe_code), div({ class: 'sub' }, d.recipe_name)) },
          { label: 'Producent', muted: true, render: (d) => d.producer_name },
          { label: 'Versie', muted: true, render: (d) => `v${d.version_no}` },
          { label: 'Bereik', render: (d) => tag(d.scope, 'tag-quiet') },
          { label: 'Status', render: (d) => statusTag(d.status) },
          { label: 'Oordeel', render: (d) => verdictTag(d.verdict) },
          {
            label: 'Certificaat',
            render: (d) =>
              d.certificate_no
                ? div({}, span({ class: 'mono tiny' }, d.certificate_no), d.bypass_of ? div({ class: 'sub' }, `geërfd · ${pct(d.bypass_deviation, 2)}`) : null)
                : span({ class: 'muted' }, '—'),
          },
          { label: 'Geldig tot', muted: true, render: (d) => (d.valid_until ? date(d.valid_until) : '—') },
          { label: 'Ingediend', muted: true, render: (d) => relative(d.submitted_at ?? d.created_at) },
          { label: '', align: 'right', render: (d) => btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/declarations/${d.id}` }) },
        ],
        declarations,
        { onRow: (d) => navigate(`/declarations/${d.id}`), emptyTitle: 'Nog geen declaraties', emptyText: 'Dien een receptuurversie in vanuit het rekenblad.' },
      ),
    );
  };

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        title: 'Declaraties',
        lede:
          'Elke ingediende receptuurversie, met haar oordeel en haar weg door de verificatie. Een dossier dat binnen de bandbreedte bleef, erfde de verificatie van zijn voorganger.',
      }),
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
    ),
  );

  await load();
}
