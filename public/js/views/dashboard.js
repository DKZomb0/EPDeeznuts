/**
 * De startpagina, per organisatietype samengesteld — elke partij opent dit
 * platform om een andere reden.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  panel, card, kpiStrip, tablePanel, banner, tag, verdictTag, statusTag, pageHead, toast,
  rangeBar, btn, logList, empty, ref, smart, date, pct, GATE_LABELS,
} from '../lib/ui.js';
import { relative } from '../lib/format.js';

const { div, span, strong, p, small } = tags;

const LEDE = {
  SUPPLIER: 'Beheer uw grondstoffen en hun milieudeclaraties, en beslis wie ze mag inkijken.',
  PRODUCER: 'Stel recepturen samen, reken hun milieuprofiel door en volg de status van uw declaraties.',
  CONTRACTOR: 'Volg uw projecten en leveringen, en vul de werfgebonden modules A4 en A5 in.',
  VERIFIER: 'Behandel ingediende dossiers en controleer waar producenten van de sectorwaarden afweken.',
  FEDERATION: 'Volg de dekking in de sector en stel de generieke waarden samen die naar TOTEM gaan.',
  REGULATOR: 'Toezicht op dekking, geldigheid en de traceerbaarheid van de rekenregels.',
};

export async function render(outlet, { setTitle, navigate, refresh }) {
  const data = await api.get('/dashboard');
  setTitle('Overzicht');

  const section = {
    SUPPLIER: supplier,
    PRODUCER: producer,
    CONTRACTOR: contractor,
    VERIFIER: verifier,
    FEDERATION: sector,
    REGULATOR: sector,
  }[state.user.orgType];

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({ title: `Goeiedag, ${state.user.name.split(' ')[0]}`, lede: LEDE[state.user.orgType] }),
      data.stats?.length ? kpiStrip(data.stats.map((s) => ({ label: s.label, value: String(s.value), tone: s.tone === 'warn' ? 'warn' : s.tone === 'ok' ? 'ok' : undefined }))) : null,
      section ? section(data, navigate, refresh) : null,
      data.notifications?.length ? panel({ kicker: 'Meldingen', body: logList(data.notifications.map((n) => ({ ts: n.created_at, actor_label: n.title, summary: n.body ?? '' }))) }) : null,
    ),
  );
}

/* ------------------------------------------------------------------ */

function supplier(data, navigate, refresh) {
  const decide = async (requestId, decision) => {
    try {
      await api.post(`/access/${requestId}/decide`, { decision });
      toast(decision === 'GRANT' ? 'Inzage toegekend.' : 'Aanvraag geweigerd.', 'ok');
      await refresh();
      navigate('/access');
    } catch (err) {
      toast(err.message, 'bad');
    }
  };

  return div(
    { class: 'stack' },
    data.pendingAccess.length
      ? panel({
          title: 'Openstaande toegangsaanvragen',
          sub: 'Een afnemer ziet uw catalogus, maar de cijfers pas na uw toestemming.',
          variant: 'flush',
          body: tablePanel(
            [
              { label: 'Afnemer', render: (r) => div({}, div({ class: 'strong' }, r.requester_name), div({ class: 'sub' }, r.requester_city ?? '')) },
              { label: 'Motivering', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.reason ?? '—') },
              { label: 'Gevraagd', muted: true, render: (r) => relative(r.created_at) },
              {
                label: '',
                align: 'right',
                render: (r) =>
                  div(
                    { class: 'btn-row', style: { justifyContent: 'flex-end' } },
                    btn('Toekennen', { variant: 'primary', small: true, icon: 'lockOpen', onClick: () => decide(r.id, 'GRANT') }),
                    btn('Weigeren', { variant: 'ghost', small: true, onClick: () => decide(r.id, 'DENY') }),
                  ),
              },
            ],
            data.pendingAccess,
          ),
        })
      : null,

    data.expiring.length
      ? panel({
          title: 'Bewijsstukken die vervallen',
          variant: 'flush',
          body: div(
            {},
            div({ style: { padding: '0 5.6px 11.2px' } },
              banner('warn', {
                icon: 'warning',
                body: 'Wanneer een BEPD vervalt, wordt élk dossier dat erop steunt automatisch ongeldig — ook de declaraties van uw klanten.',
              }),
            ),
            tablePanel(
              [
                { label: 'Nummer', render: (r) => span({ class: 'mono small' }, r.number ?? '—') },
                { label: 'Type', render: (r) => tag(r.type, r.type === 'BEPD' ? 'tag-accent' : 'tag-outline') },
                { label: 'Geldig tot', muted: true, render: (r) => date(r.valid_until) },
                { label: 'In gebruik door', align: 'right', muted: true, render: (r) => `${r.use_count} versie(s)` },
              ],
              data.expiring,
            ),
          ),
        })
      : null,

    panel({
      title: 'Recente wijzigingen aan uw gegevens',
      actions: [btn('Naar grondstoffen', { variant: 'secondary', small: true, icon: 'arrowRight', href: '#/materials' })],
      variant: 'flush',
      body: tablePanel(
        [
          { label: 'Grondstof', render: (r) => div({}, div({ class: 'strong' }, r.material_name), div({ class: 'sub' }, r.material_code)) },
          { label: 'Versie', muted: true, render: (r) => `v${r.version_no}` },
          { label: 'Geldig vanaf', muted: true, render: (r) => date(r.effective_from) },
          { label: 'Reden', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.change_reason ?? '—') },
        ],
        data.recentVersions,
        { emptyTitle: 'Nog geen wijzigingen', emptyText: 'Voeg een grondstof toe om te beginnen.' },
      ),
    }),
  );
}

/* ------------------------------------------------------------------ */

function producer(data, navigate) {
  return div(
    { class: 'stack' },
    data.blocked.length
      ? panel({
          title: 'Dossiers die niet publiceerbaar zijn',
          variant: 'flush',
          body: div(
            {},
            div({ style: { padding: '0 5.6px 11.2px' } },
              banner('neutral', {
                icon: 'prohibit',
                body: 'Deze dossiers rekenen wel door, maar minstens één grondstof mist een geldige BEPD. Zolang dat zo is, hebben de cijfers geen juridische waarde.',
              }),
            ),
            tablePanel(
              [
                { label: 'Receptuur', render: (r) => strong({}, r.recipe_code) },
                { label: 'Versie', muted: true, render: (r) => `v${r.version_no}` },
                { label: 'Status', render: (r) => statusTag(r.status) },
                { label: 'Oordeel', render: (r) => verdictTag(r.verdict) },
                { label: '', align: 'right', render: (r) => btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/declarations/${r.id}` }) },
              ],
              data.blocked,
            ),
          ),
        })
      : banner('accent', { icon: 'checkCircle', body: 'Alle ingediende dossiers zijn volledig BEPD-gedekt.' }),

    panel({
      title: 'Recepturen',
      actions: [btn('Alle recepturen', { variant: 'secondary', small: true, icon: 'arrowRight', href: '#/recipes' })],
      variant: 'flush',
      body: tablePanel(
        [
          { label: 'Code', render: (r) => strong({}, r.code) },
          { label: 'Benaming', muted: true, render: (r) => r.name },
          { label: 'Sterkteklasse', muted: true, render: (r) => r.strength_class ?? '—' },
          { label: 'Versies', align: 'right', muted: true, render: (r) => String(r.versions) },
        ],
        data.recipes,
        { onRow: (r) => navigate(`/recipes/${r.id}`), emptyTitle: 'Nog geen recepturen' },
      ),
    }),

    data.pendingAccess.length
      ? panel({
          title: 'Inzage aangevraagd, nog geen antwoord',
          sub: 'Zolang deze aanvraag openstaat, kunt u deze grondstof niet in een receptuur gebruiken.',
          variant: 'flush',
          body: tablePanel(
            [
              { label: 'Leverancier', render: (r) => strong({}, r.owner_name) },
              { label: 'Gevraagd', muted: true, render: (r) => relative(r.created_at) },
              { label: 'Motivering', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.reason ?? '—') },
            ],
            data.pendingAccess,
          ),
        })
      : null,

    panel({
      title: 'Recente leveringen',
      variant: 'flush',
      body: tablePanel(
        [
          { label: 'Bon', render: (r) => span({ class: 'mono small' }, r.delivery_note ?? '—') },
          { label: 'Receptuur', muted: true, render: (r) => r.recipe_code },
          { label: 'Project', muted: true, render: (r) => r.project_name },
          { label: 'Volume', align: 'right', render: (r) => `${smart(r.volume_m3)} m³` },
          { label: 'Datum', muted: true, render: (r) => date(r.delivered_at) },
        ],
        data.recentDeliveries,
        { emptyTitle: 'Nog geen leveringen' },
      ),
    }),
  );
}

/* ------------------------------------------------------------------ */

function contractor(data, navigate) {
  return div(
    { class: 'stack' },
    panel({
      title: 'Leveringen',
      sub: 'Modules A4 en A5 vult u per levering in.',
      variant: 'flush',
      body: tablePanel(
        [
          { label: 'Bon', render: (r) => span({ class: 'mono small' }, r.delivery_note ?? '—') },
          { label: 'Project', render: (r) => div({}, div({ class: 'strong' }, r.project_name), div({ class: 'sub' }, r.producer_name)) },
          { label: 'Receptuur', muted: true, render: (r) => div({}, r.recipe_code, div({ class: 'sub' }, r.strength_class ?? '')) },
          { label: 'Volume', align: 'right', render: (r) => `${smart(r.volume_m3)} m³` },
          { label: 'Datum', muted: true, render: (r) => date(r.delivered_at) },
          {
            label: 'Controle',
            render: (r) =>
              r.last_decision
                ? tag(GATE_LABELS[r.last_decision] ?? r.last_decision, r.last_decision === 'GO' ? 'tag-accent' : r.last_decision === 'NO_GO' ? 'tag-neutral' : 'tag-outline')
                : tag('Niet gecontroleerd', 'tag-quiet'),
          },
          { label: '', align: 'right', render: (r) => btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/deliveries/${r.id}` }) },
        ],
        data.deliveries,
        { onRow: (r) => navigate(`/deliveries/${r.id}`), emptyTitle: 'Nog geen leveringen', emptyText: 'Registreer een levering op een project.' },
      ),
    }),

    panel({
      title: 'Projecten',
      actions: [btn('Alle projecten', { variant: 'secondary', small: true, icon: 'arrowRight', href: '#/projects' })],
      variant: 'flush',
      body: tablePanel(
        [
          { label: 'Project', render: (r) => div({}, div({ class: 'strong' }, r.name), div({ class: 'sub' }, r.city ?? '')) },
          { label: 'Referentie', muted: true, render: (r) => span({ class: 'mono small' }, r.reference ?? '—') },
          { label: 'Leveringen', align: 'right', muted: true, render: (r) => String(r.delivery_count) },
        ],
        data.projects,
        { onRow: (r) => navigate(`/projects/${r.id}`) },
      ),
    }),
  );
}

/* ------------------------------------------------------------------ */

function verifier(data, navigate) {
  return div(
    { class: 'stack' },
    panel({
      title: 'Wachtrij',
      sub: 'Op volgorde van indiening.',
      variant: 'flush',
      body: tablePanel(
        [
          { label: 'Producent', render: (q) => div({}, div({ class: 'strong' }, q.producer_name), div({ class: 'sub' }, `${q.recipe_code} v${q.version_no}`)) },
          { label: 'Receptuur', muted: true, render: (q) => q.recipe_name },
          { label: 'Bereik', render: (q) => tag(q.scope, 'tag-quiet') },
          { label: 'Oordeel', render: (q) => verdictTag(q.verdict) },
          { label: 'Status', render: (q) => statusTag(q.status) },
          { label: 'Ingediend', muted: true, render: (q) => relative(q.submitted_at) },
          { label: '', align: 'right', render: (q) => btn('Behandelen', { variant: 'secondary', small: true, icon: 'arrowRight', href: `#/declarations/${q.id}` }) },
        ],
        data.queue,
        { onRow: (q) => navigate(`/declarations/${q.id}`), emptyTitle: 'Wachtrij leeg', emptyText: 'Er wacht momenteel geen dossier.' },
      ),
    }),

    panel({
      title: 'Afwijkingen van de sectorwaarden',
      sub: 'Dit is uw eigenlijke controlelijst: elke plaats waar een producent een generieke waarde door een eigen meting verving.',
      variant: 'flush',
      body: tablePanel(
        [
          { label: 'Producent', muted: true, render: (r) => r.producer_name },
          { label: 'Receptuur', render: (r) => `${r.recipe_code} v${r.version_no}` },
          { label: 'Parameter', muted: true, render: (r) => span({ class: 'mono small' }, r.code) },
          { label: 'Waarde', align: 'right', render: (r) => `${smart(r.value)} ${r.unit}` },
          { label: 'Verantwoording', wrap: true, render: (r) => (r.justification ? span({ class: 'small dim' }, r.justification) : tag('ontbreekt', 'tag-neutral')) },
        ],
        data.overrides,
        { emptyTitle: 'Geen afwijkingen' },
      ),
    }),

    data.manualOverrides.length
      ? panel({
          title: 'Uitzonderingen en weigeringen op leveringen',
          variant: 'flush',
          body: tablePanel(
            [
              { label: 'Wanneer', muted: true, render: (r) => date(r.created_at) },
              { label: 'Beslissing', render: (r) => tag(GATE_LABELS[r.decision] ?? r.decision, r.decision === 'NO_GO' ? 'tag-neutral' : 'tag-outline') },
              { label: 'Project', muted: true, render: (r) => r.project_name ?? '—' },
              { label: 'Bon', muted: true, render: (r) => span({ class: 'mono tiny' }, r.delivery_note ?? '—') },
              { label: 'Toelichting', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.note ?? '—') },
            ],
            data.manualOverrides,
          ),
        })
      : null,
  );
}

/* ------------------------------------------------------------------ */

function sector(data) {
  const scaleMax = Math.max(...(data.spread ?? []).map((s) => s.max), 1) * 1.08;

  return div(
    { class: 'stack' },
    panel({
      title: 'Spreiding per sterkteklasse',
      sub: 'Enkel volledig BEPD-gedekte, gepubliceerde declaraties tellen mee.',
      body: div(
        {},
        p(
          { class: 'small dim' },
          'De balk toont de volledige bandbreedte van de gepubliceerde declaraties; het streepje is het volumegewogen gemiddelde. ',
          strong({}, 'Precies daarom wordt de spreiding altijd mee gepubliceerd: '),
          'een ontwerpberekening op het gemiddelde kan er ver naast zitten.',
        ),
        data.spread?.length
          ? tablePanel(
              [
                { label: 'Klasse', render: (r) => strong({}, r.strengthClass) },
                { label: "BEPD's", align: 'right', muted: true, render: (r) => String(r.n) },
                { label: 'Min', align: 'right', muted: true, render: (r) => smart(r.min) },
                { label: 'Gemiddelde', align: 'right', render: (r) => strong({ class: 'tnum' }, smart(r.weightedMean)) },
                { label: 'Max', align: 'right', muted: true, render: (r) => smart(r.max) },
                { label: 'Spreiding', width: '24%', render: (r) => rangeBar({ min: r.min, max: r.max, mean: r.weightedMean, scaleMax }) },
                { label: 'Variatiecoëff.', align: 'right', muted: true, render: (r) => pct(r.cv, 0) },
              ],
              data.spread,
            )
          : empty('Nog geen gepubliceerde declaraties om te middelen'),
      ),
    }),

    div(
      { class: 'grid grid--halves' },
      panel({
        title: 'Dekking per organisatie',
        variant: 'flush',
        body: tablePanel(
          [
            { label: 'Organisatie', render: (r) => div({}, div({ class: 'strong' }, r.name), div({ class: 'sub' }, r.type === 'SUPPLIER' ? 'Leverancier' : 'Producent')) },
            { label: 'Grondstoffen', align: 'right', muted: true, render: (r) => String(r.materials) },
            { label: 'Gepubliceerd', align: 'right', muted: true, render: (r) => String(r.published) },
          ],
          data.coverage,
        ),
      }),
      panel({
        title: 'Vastgelegde sectorgemiddelden',
        actions: [btn('Samenstellen', { variant: 'secondary', small: true, icon: 'arrowRight', href: '#/sector' })],
        variant: 'flush',
        body: tablePanel(
          [
            { label: 'Benaming', render: (r) => strong({}, r.label) },
            { label: 'Klasse', muted: true, render: (r) => r.strength_class ?? 'alle' },
            { label: 'n', align: 'right', muted: true, render: (r) => String(r.sample_size) },
            { label: 'Opgesteld', muted: true, render: (r) => date(r.created_at) },
          ],
          data.aggregations,
          { emptyTitle: 'Nog geen gemiddelde vastgelegd' },
        ),
      }),
    ),

    data.settings
      ? panel({
          title: 'Actieve drempelwaarden',
          sub: 'Deze waarden bepalen wanneer een receptuurwijziging opnieuw langs een controlebureau moet.',
          actions: [btn('Aanpassen', { variant: 'secondary', small: true, icon: 'gear', href: '#/reference' })],
          body: kpiStrip([
            { label: 'Marge per wijziging', value: `±${data.settings.bypass_tolerance_pct ?? '—'}%` },
            { label: 'Opgetelde drift', value: `±${data.settings.bypass_cumulative_pct ?? '—'}%` },
            { label: 'Opeenvolgende bypasses', value: data.settings.bypass_max_consecutive ?? '—' },
            { label: 'Marge op levering', value: `±${data.settings.delivery_tolerance_pct ?? '—'}%` },
            { label: 'Geldigheid declaratie', value: `${data.settings.declaration_validity_months ?? '—'} mnd` },
          ]),
        })
      : null,
  );
}
