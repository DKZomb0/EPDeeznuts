/**
 * De werklijst van het controlebureau.
 *
 * Bewust in drieën: wat op een beslissing wacht, wat automatisch doorliep, en
 * wat afgehandeld is. Die tweede lijst is het fundament onder de bandbreedte —
 * het bureau moet kunnen nakijken wat het níet gezien heeft.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { panel, kpiStrip, tablePanel, banner, tag, verdictTag, statusTag, pageHead, tabs, btn, ref, pct, date } from '../lib/ui.js';
import { relative } from '../lib/format.js';

const { div, span, strong } = tags;

export async function render(outlet, { setTitle, navigate }) {
  setTitle('Verificatiedossiers');

  const [{ declarations }, dashboard] = await Promise.all([api.get('/declarations'), api.get('/dashboard').catch(() => ({}))]);

  const open = declarations.filter((d) => ['SUBMITTED', 'UNDER_VERIFICATION'].includes(d.status));
  const inherited = declarations.filter((d) => d.status === 'AUTO_ACCEPTED');
  const done = declarations.filter((d) => ['VERIFIED', 'PUBLISHED', 'REJECTED'].includes(d.status));

  const tolerance = Number((ref().settings ?? {}).bypass_tolerance_pct ?? 3);
  const total = open.length + inherited.length;

  let active = 'open';
  const host = div();

  const draw = () => {
    mount(
      host,
      tabs(
        [
          { key: 'open', label: `Te behandelen (${open.length})` },
          { key: 'inherited', label: `Automatisch aanvaard (${inherited.length})` },
          { key: 'overrides', label: 'Afwijkingen van sectorwaarden' },
          { key: 'done', label: `Afgehandeld (${done.length})` },
        ],
        active,
        (key) => {
          active = key;
          draw();
        },
      ),

      active === 'open'
        ? tablePanel(
            [
              { label: 'Producent', render: (d) => div({}, div({ class: 'strong' }, d.producer_name), div({ class: 'sub' }, `${d.recipe_code} v${d.version_no}`)) },
              { label: 'Receptuur', muted: true, render: (d) => d.recipe_name },
              { label: 'Klasse', muted: true, render: (d) => d.strength_class ?? '—' },
              { label: 'Bereik', render: (d) => tag(d.scope, 'tag-quiet') },
              { label: 'Oordeel', render: (d) => verdictTag(d.verdict) },
              { label: 'Status', render: (d) => statusTag(d.status) },
              { label: 'Ingediend', muted: true, render: (d) => relative(d.submitted_at) },
              { label: '', align: 'right', render: (d) => btn('Behandelen', { variant: 'secondary', small: true, icon: 'arrowRight', href: `#/declarations/${d.id}` }) },
            ],
            open,
            { onRow: (d) => navigate(`/declarations/${d.id}`), emptyTitle: 'Wachtrij leeg', emptyText: 'Er wacht momenteel geen dossier op verificatie.' },
          )
        : null,

      active === 'inherited'
        ? div(
            { class: 'stack--tight', style: { display: 'flex', flexDirection: 'column' } },
            banner('plain', {
              icon: 'info',
              title: 'Waarom deze lijst bestaat',
              body: `Kleine receptuurwijzigingen komen niet bij u terecht. Om dat verdedigbaar te houden moet u wél kunnen nakijken welke wijzigingen langs de automatische bandbreedte van ±${tolerance}% gingen, en met welke afwijking.`,
            }),
            tablePanel(
              [
                { label: 'Producent', render: (d) => div({}, div({ class: 'strong' }, d.producer_name), div({ class: 'sub' }, `${d.recipe_code} v${d.version_no}`)) },
                { label: 'Afwijking', align: 'right', render: (d) => span({ class: 'tnum' }, pct(d.bypass_deviation, 2)) },
                { label: 'Certificaat', muted: true, render: (d) => span({ class: 'mono tiny' }, d.certificate_no ?? '—') },
                { label: 'Oordeel', render: (d) => verdictTag(d.verdict) },
                { label: 'Wanneer', muted: true, render: (d) => relative(d.created_at) },
                { label: '', align: 'right', render: (d) => btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/declarations/${d.id}` }) },
              ],
              inherited,
              { onRow: (d) => navigate(`/declarations/${d.id}`), emptyTitle: 'Nog niets automatisch aanvaard' },
            ),
          )
        : null,

      active === 'overrides'
        ? div(
            { class: 'stack--tight', style: { display: 'flex', flexDirection: 'column' } },
            banner('plain', {
              icon: 'eye',
              title: 'Uw eigenlijke controlelijst',
              body: 'Elke plaats waar een producent een generieke sectorwaarde door een eigen meting verving. Een afwijking zonder verantwoordingsnota is het eerste wat u opvraagt.',
            }),
            tablePanel(
              [
                { label: 'Producent', muted: true, render: (r) => r.producer_name },
                { label: 'Receptuur', render: (r) => strong({}, `${r.recipe_code} v${r.version_no}`) },
                { label: 'Parameter', muted: true, render: (r) => span({ class: 'mono small' }, r.code) },
                { label: 'Waarde', align: 'right', render: (r) => `${r.value} ${r.unit}` },
                {
                  label: 'Verantwoording',
                  wrap: true,
                  render: (r) => (r.justification ? span({ class: 'small dim' }, r.justification) : tag('ontbreekt', 'tag-neutral')),
                },
              ],
              dashboard.overrides ?? [],
              { emptyTitle: 'Geen afwijkingen', emptyText: 'Alle centrales gebruiken de generieke sectorwaarden.' },
            ),
            (dashboard.manualOverrides ?? []).length
              ? tablePanel(
                  [
                    { label: 'Wanneer', muted: true, render: (r) => date(r.created_at) },
                    { label: 'Beslissing', render: (r) => statusTag(r.decision, { NO_GO: 'Niet vrij te geven', MANUAL_OVERRIDE: 'Manuele uitzondering' }) },
                    { label: 'Project', muted: true, render: (r) => r.project_name ?? '—' },
                    { label: 'Bon', muted: true, render: (r) => span({ class: 'mono tiny' }, r.delivery_note ?? '—') },
                    { label: 'Toelichting', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.note ?? '—') },
                  ],
                  dashboard.manualOverrides,
                  { emptyTitle: 'Geen uitzonderingen' },
                )
              : null,
          )
        : null,

      active === 'done'
        ? tablePanel(
            [
              { label: 'Producent', render: (d) => div({}, div({ class: 'strong' }, d.producer_name), div({ class: 'sub' }, `${d.recipe_code} v${d.version_no}`)) },
              { label: 'Status', render: (d) => statusTag(d.status) },
              { label: 'Oordeel', render: (d) => verdictTag(d.verdict) },
              { label: 'Certificaat', muted: true, render: (d) => span({ class: 'mono tiny' }, d.certificate_no ?? '—') },
              { label: 'Geldig tot', muted: true, render: (d) => (d.valid_until ? date(d.valid_until) : '—') },
              { label: '', align: 'right', render: (d) => btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/declarations/${d.id}` }) },
            ],
            done,
            { onRow: (d) => navigate(`/declarations/${d.id}`), emptyTitle: 'Nog niets afgehandeld' },
          )
        : null,
    );
  };

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        title: 'Verificatiedossiers',
        lede: 'U controleert de gegevens en de toepassing van de rekenregels. Het platform rekent; het oordeel blijft van u.',
      }),
      kpiStrip([
        { label: 'Wachtend', value: String(open.filter((d) => d.status === 'SUBMITTED').length), note: 'nog niet opgenomen' },
        { label: 'In behandeling', value: String(open.filter((d) => d.status === 'UNDER_VERIFICATION').length), note: 'bij ons' },
        { label: 'Automatisch aanvaard', value: String(inherited.length), note: `binnen ±${tolerance}%`, tone: 'ok' },
        {
          label: 'Menselijke tijd',
          value: total ? `${Math.round((inherited.length / total) * 100)}%` : '—',
          note: 'bespaard door de bandbreedte',
          tone: 'ok',
        },
      ]),
      host,
    ),
  );

  draw();
}
