/**
 * Een receptuur en haar versietijdlijn.
 *
 * Hier is de wijzigingscontrole in één oogopslag zichtbaar: welke versies door
 * een verificateur gingen, welke er een erfden, en welke er nog wacht.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import { panel, tablePanel, kv, tag, statusTag, verdictTag, pageHead, btn, logList, ref, smart, date, pct } from '../lib/ui.js';

const { div, span, strong } = tags;

const VERSION_STATUS = { ACTIVE: 'In productie', DRAFT: 'Ontwerp', SUPERSEDED: 'Vervangen', ARCHIVED: 'Gearchiveerd' };

export async function render(outlet, { params, setTitle, navigate }) {
  const data = await api.get(`/recipes/${params.id}`);
  const recipe = data.recipe;
  setTitle(recipe.code);

  const isOwner = recipe.org_id === state.user.orgId;
  const active = data.versions.find((v) => v.status === 'ACTIVE') ?? data.versions[0];

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        crumb: [{ label: 'Recepturen', onClick: () => navigate('/recipes') }, { label: recipe.code }],
        title: recipe.name,
        lede: `${recipe.producer_name}${recipe.site_name ? ` · ${recipe.site_name}` : ''} · ${recipe.strength_class ?? ''} ${recipe.exposure_classes ?? ''}`,
        actions: [
          active ? btn('Rekenblad openen', { variant: 'primary', icon: 'calculator', href: `#/versions/${active.id}` }) : null,
        ].filter(Boolean),
      }),

      div(
        { class: 'grid grid--wide' },
        div(
          { class: 'flex-col', style: { gap: '16.8px', minWidth: 0 } },
          panel({
            title: 'Versies',
            sub: 'Een versie die binnen de afgesproken bandbreedte blijft, erft de verificatie van de vorige. Grotere wijzigingen gaan opnieuw naar het controlebureau.',
            variant: 'flush',
            body: tablePanel(
              [
                { label: 'Versie', render: (v) => strong({}, `v${v.version_no}`) },
                { label: 'Status', render: (v) => tag(VERSION_STATUS[v.status] ?? v.status, v.status === 'ACTIVE' ? 'tag-accent' : v.status === 'DRAFT' ? 'tag-outline' : 'tag-quiet') },
                { label: 'Geldig', muted: true, render: (v) => `${date(v.effective_from)} → ${v.effective_to ? date(v.effective_to) : 'nu'}` },
                {
                  label: 'Declaratie',
                  render: (v) =>
                    v.declaration
                      ? div(
                          {},
                          statusTag(v.declaration.status),
                          v.declaration.bypass_of
                            ? div({ class: 'sub' }, `geërfd · ${pct(v.declaration.bypass_deviation, 2)}`)
                            : v.declaration.certificate_no
                              ? div({ class: 'sub mono' }, v.declaration.certificate_no)
                              : null,
                        )
                      : tag('Niet ingediend', 'tag-quiet'),
                },
                { label: 'Oordeel', render: (v) => (v.declaration ? verdictTag(v.declaration.verdict) : span({ class: 'muted' }, '—')) },
                { label: 'Wijziging', wrap: true, muted: true, render: (v) => span({ class: 'small' }, v.change_reason ?? '—') },
                { label: '', align: 'right', render: (v) => btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/versions/${v.id}` }) },
              ],
              data.versions,
              { onRow: (v) => navigate(`/versions/${v.id}`) },
            ),
          }),
          panel({ kicker: 'Registraties', body: logList(data.history, { limit: 20 }) }),
        ),
        panel({
          kicker: 'Kenmerken',
          body: kv([
            ['Producent', recipe.producer_name],
            ['Centrale', recipe.site_name ?? '—'],
            ['Sterkteklasse', recipe.strength_class ?? '—'],
            ['Omgevingsklassen', recipe.exposure_classes ?? '—'],
            ['Consistentie', recipe.consistency ?? '—'],
            ['Dmax', recipe.dmax ? `${recipe.dmax} mm` : '—'],
            ['Densiteit', `${smart(recipe.density)} kg/m³`],
            ['BENOR', recipe.benor ? tag('Gecertificeerd', 'tag-accent') : span({ class: 'muted' }, 'nee')],
            ['Versies', String(data.versions.length)],
          ]),
        }),
      ),
    ),
  );
}
