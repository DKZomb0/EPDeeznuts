/**
 * The landing page, assembled per organisation type.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state } from '../app.js';
import { card, stat, dataTable, badge, verdictBadge, statusBadge, note, empty, pageHead, spreadChart, timeline, toast } from '../lib/ui.js';
import { smart, date, relative, pct, GATE_LABELS } from '../lib/format.js';

const { div, a, p, span, strong, button, small } = tags;

const INTROS = {
  SUPPLIER: 'Beheer uw grondstoffen en hun milieudeclaraties, en beslis wie ze mag inkijken.',
  PRODUCER: 'Stel recepturen samen, bereken hun milieuprofiel en volg de status van uw declaraties.',
  CONTRACTOR: 'Volg uw projecten en leveringen, en vul de werfgebonden modules A4 en A5 in.',
  VERIFIER: 'Behandel ingediende dossiers en controleer waar producenten van de sectorwaarden afweken.',
  FEDERATION: 'Volg de dekking in de sector en stel de generieke waarden samen die naar TOTEM gaan.',
  REGULATOR: 'Toezicht op dekking, geldigheid en de traceerbaarheid van de rekenregels.',
};

export async function render(outlet, { setTitle, navigate }) {
  const data = await api.get('/dashboard');
  setTitle('Overzicht', state.user.orgName);

  const sections = {
    SUPPLIER: supplier,
    PRODUCER: producer,
    CONTRACTOR: contractor,
    VERIFIER: verifier,
    FEDERATION: sector,
    REGULATOR: sector,
  }[state.user.orgType];

  mount(
    outlet,
    pageHead(`Goeiedag, ${state.user.name.split(' ')[0]}`, INTROS[state.user.orgType]),
    data.stats?.length ? div({ class: 'grid grid--4 mb-2' }, data.stats.map((s) => stat({ label: s.label, value: s.value, tone: s.tone }))) : null,
    sections ? sections(data, navigate) : null,
  );
}

/* ------------------------------------------------------------------ */

function supplier(data, navigate) {
  return div(
    { class: 'grid grid--side' },
    div(
      {},
      data.pendingAccess.length
        ? card(
            'Openstaande toegangsaanvragen',
            dataTable(
              [
                { label: 'Afnemer', render: (r) => div({}, strong({}, r.requester_name), span({ class: 'sub' }, r.requester_city ?? '')) },
                { label: 'Motivering', render: (r) => span({ class: 'small' }, r.reason ?? '—') },
                { label: 'Gevraagd', render: (r) => relative(r.created_at) },
                {
                  label: '',
                  align: 'right',
                  render: (r) =>
                    div(
                      { class: 'btn-row' },
                      button({ class: 'btn btn--small btn--accent', onClick: () => decide(r.id, 'GRANT') }, 'Toestaan'),
                      button({ class: 'btn btn--small btn--danger', onClick: () => decide(r.id, 'DENY') }, 'Weigeren'),
                    ),
                },
              ],
              data.pendingAccess,
              { compact: true },
            ),
            { hint: 'Een afnemer ziet uw catalogus, maar de cijfers pas na uw toestemming.', flush: true },
          )
        : null,

      data.expiring.length
        ? card(
            'Bewijsstukken die vervallen',
            div(
              {},
              note(
                'warn',
                strong({}, 'Let op. '),
                'Wanneer een BEPD vervalt, wordt élk dossier dat erop steunt automatisch ongeldig — ook de declaraties van uw klanten.',
              ),
              dataTable(
                [
                  { label: 'Nummer', render: (r) => span({ class: 'mono small' }, r.number ?? '—') },
                  { label: 'Type', render: (r) => badge(r.type, r.type === 'BEPD' ? 'ok' : 'warn') },
                  { label: 'Geldig tot', render: (r) => date(r.valid_until) },
                  { label: 'In gebruik door', align: 'right', render: (r) => `${r.use_count} versie(s)` },
                ],
                data.expiring,
                { compact: true },
              ),
            ),
          )
        : null,

      card(
        'Recente wijzigingen aan uw gegevens',
        dataTable(
          [
            { label: 'Grondstof', render: (r) => div({}, strong({}, r.material_name), span({ class: 'sub' }, r.material_code)) },
            { label: 'Versie', render: (r) => `v${r.version_no}` },
            { label: 'Geldig vanaf', render: (r) => date(r.effective_from) },
            { label: 'Reden', render: (r) => span({ class: 'small muted' }, r.change_reason ?? '—') },
          ],
          data.recentVersions,
          { compact: true, emptyText: 'Voeg een grondstof toe om te beginnen.' },
        ),
        { flush: true, actions: [a({ href: '#/materials', class: 'btn btn--small' }, 'Naar grondstoffen')] },
      ),
    ),
    div({}, notificationsCard(data)),
  );

  async function decide(requestId, decision) {
    try {
      await api.post(`/access/${requestId}/decide`, { decision });
      toast(decision === 'GRANT' ? 'Toegang toegekend.' : 'Toegang geweigerd.', 'ok');
      navigate('/');
      location.reload();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }
}

/* ------------------------------------------------------------------ */

function producer(data, navigate) {
  return div(
    { class: 'grid grid--side' },
    div(
      {},
      data.blocked.length
        ? card(
            'Dossiers die niet publiceerbaar zijn',
            div(
              {},
              note('warn', 'Deze dossiers rekenen wel door, maar minstens één grondstof mist een geldige BEPD. Zolang dat zo is, hebben de cijfers geen juridische waarde.'),
              dataTable(
                [
                  { label: 'Receptuur', render: (r) => strong({}, r.recipe_code) },
                  { label: 'Versie', render: (r) => `v${r.version_no}` },
                  { label: 'Status', render: (r) => statusBadge(r.status) },
                  { label: 'Oordeel', render: (r) => verdictBadge(r.verdict) },
                  { label: '', align: 'right', render: (r) => a({ href: `#/declarations/${r.id}`, class: 'btn btn--small' }, 'Openen') },
                ],
                data.blocked,
                { compact: true },
              ),
            ),
          )
        : note('ok', 'Alle ingediende dossiers zijn volledig BEPD-gedekt.'),

      card(
        'Recepturen',
        dataTable(
          [
            { label: 'Code', render: (r) => strong({}, r.code) },
            { label: 'Benaming', render: (r) => r.name },
            { label: 'Sterkteklasse', render: (r) => r.strength_class ?? '—' },
            { label: 'Versies', align: 'right', render: (r) => String(r.versions) },
          ],
          data.recipes,
          { compact: true, onRow: (r) => navigate(`/recipes/${r.id}`), emptyText: 'Maak een receptuur aan om te starten.' },
        ),
        { flush: true, actions: [a({ href: '#/recipes', class: 'btn btn--small' }, 'Alle recepturen')] },
      ),

      data.pendingAccess.length
        ? card(
            'Toegang aangevraagd, nog geen antwoord',
            dataTable(
              [
                { label: 'Leverancier', render: (r) => strong({}, r.owner_name) },
                { label: 'Gevraagd', render: (r) => relative(r.created_at) },
                { label: 'Motivering', render: (r) => span({ class: 'small muted' }, r.reason ?? '—') },
              ],
              data.pendingAccess,
              { compact: true },
            ),
            { flush: true, hint: 'Zolang deze aanvraag openstaat, kunt u deze grondstof niet in een receptuur gebruiken.' },
          )
        : null,

      card(
        'Recente leveringen',
        dataTable(
          [
            { label: 'Bon', render: (r) => span({ class: 'mono small' }, r.delivery_note ?? '—') },
            { label: 'Receptuur', render: (r) => r.recipe_code },
            { label: 'Project', render: (r) => r.project_name },
            { label: 'Volume', align: 'right', render: (r) => `${smart(r.volume_m3)} m³` },
            { label: 'Datum', render: (r) => date(r.delivered_at) },
          ],
          data.recentDeliveries,
          { compact: true },
        ),
        { flush: true },
      ),
    ),
    div({}, notificationsCard(data)),
  );
}

/* ------------------------------------------------------------------ */

function contractor(data, navigate) {
  return div(
    { class: 'grid grid--side' },
    div(
      {},
      card(
        'Leveringen',
        dataTable(
          [
            { label: 'Bon', render: (r) => span({ class: 'mono small' }, r.delivery_note ?? '—') },
            { label: 'Project', render: (r) => div({}, strong({}, r.project_name), span({ class: 'sub' }, r.producer_name)) },
            { label: 'Receptuur', render: (r) => div({}, r.recipe_code, span({ class: 'sub' }, r.strength_class ?? '')) },
            { label: 'Volume', align: 'right', render: (r) => `${smart(r.volume_m3)} m³` },
            { label: 'Datum', render: (r) => date(r.delivered_at) },
            {
              label: 'Controle',
              render: (r) => (r.last_decision ? badge(GATE_LABELS[r.last_decision] ?? r.last_decision, r.last_decision === 'GO' ? 'ok' : r.last_decision === 'NO_GO' ? 'bad' : 'warn') : badge('Niet gecontroleerd', 'muted')),
            },
          ],
          data.deliveries,
          { compact: true, onRow: (r) => navigate(`/deliveries/${r.id}`), emptyText: 'Registreer een levering op een project.' },
        ),
        { flush: true, hint: 'Modules A4 en A5 vult u per levering in.' },
      ),
      card(
        'Projecten',
        dataTable(
          [
            { label: 'Project', render: (r) => div({}, strong({}, r.name), span({ class: 'sub' }, r.city ?? '')) },
            { label: 'Referentie', render: (r) => span({ class: 'mono small' }, r.reference ?? '—') },
            { label: 'Leveringen', align: 'right', render: (r) => String(r.delivery_count) },
          ],
          data.projects,
          { compact: true, onRow: (r) => navigate(`/projects/${r.id}`) },
        ),
        { flush: true, actions: [a({ href: '#/projects', class: 'btn btn--small' }, 'Alle projecten')] },
      ),
    ),
    div({}, notificationsCard(data)),
  );
}

/* ------------------------------------------------------------------ */

function verifier(data, navigate) {
  return div(
    { class: 'grid grid--side' },
    div(
      {},
      card(
        'Wachtrij',
        dataTable(
          [
            { label: 'Receptuur', render: (r) => div({}, strong({}, r.recipe_code), span({ class: 'sub' }, r.recipe_name)) },
            { label: 'Producent', render: (r) => r.producer_name },
            { label: 'Versie', render: (r) => `v${r.version_no}` },
            { label: 'Scope', render: (r) => r.scope },
            { label: 'Oordeel', render: (r) => verdictBadge(r.verdict) },
            { label: 'Status', render: (r) => statusBadge(r.status) },
            { label: 'Ingediend', render: (r) => relative(r.submitted_at) },
          ],
          data.queue,
          { compact: true, onRow: (r) => navigate(`/declarations/${r.id}`), emptyText: 'Er wacht momenteel geen dossier.' },
        ),
        { flush: true },
      ),
      card(
        'Afwijkingen van de sectorwaarden',
        div(
          {},
          note('info', 'Dit is uw eigenlijke controlelijst: elke plaats waar een producent een generieke sectorwaarde door een eigen meting verving.'),
          dataTable(
            [
              { label: 'Producent', render: (r) => r.producer_name },
              { label: 'Receptuur', render: (r) => `${r.recipe_code} v${r.version_no}` },
              { label: 'Parameter', render: (r) => span({ class: 'mono small' }, r.code) },
              { label: 'Waarde', align: 'right', render: (r) => `${smart(r.value)} ${r.unit}` },
              { label: 'Verantwoording', render: (r) => span({ class: 'small muted' }, r.justification ?? '— ontbreekt —') },
            ],
            data.overrides,
            { compact: true },
          ),
        ),
      ),
      data.manualOverrides.length
        ? card(
            'Uitzonderingen en weigeringen op leveringen',
            dataTable(
              [
                { label: 'Wanneer', render: (r) => date(r.created_at) },
                { label: 'Beslissing', render: (r) => badge(GATE_LABELS[r.decision] ?? r.decision, r.decision === 'NO_GO' ? 'bad' : 'warn') },
                { label: 'Project', render: (r) => r.project_name ?? '—' },
                { label: 'Bon', render: (r) => span({ class: 'mono small' }, r.delivery_note ?? '—') },
                { label: 'Toelichting', render: (r) => span({ class: 'small muted' }, r.note ?? '—') },
              ],
              data.manualOverrides,
              { compact: true },
            ),
            { flush: true },
          )
        : null,
    ),
    div(
      {},
      card(
        'Recent beoordeeld',
        dataTable(
          [
            { label: 'Receptuur', render: (r) => r.recipe_code },
            { label: 'Certificaat', render: (r) => span({ class: 'mono tiny' }, r.certificate_no ?? '—') },
            { label: 'Status', render: (r) => statusBadge(r.status) },
          ],
          data.recent,
          { compact: true },
        ),
        { flush: true },
      ),
      notificationsCard(data),
    ),
  );
}

/* ------------------------------------------------------------------ */

function sector(data) {
  const spreadRows = data.spread.map((row) => ({ ...row, label: row.strengthClass }));

  return div(
    {},
    card(
      'Spreiding per sterkteklasse',
      div(
        {},
        p(
          { class: 'muted small mb-2' },
          'De balk toont de volledige bandbreedte van de gepubliceerde declaraties; het streepje is het volumegewogen gemiddelde. ',
          strong({}, 'Precies daarom wordt de spreiding altijd mee gepubliceerd: '),
          'een ontwerpberekening op het gemiddelde kan er ver naast zitten.',
        ),
        spreadChart(spreadRows, { unit: 'kg CO₂ eq./m³' }),
        spreadRows.length
          ? dataTable(
              [
                { label: 'Klasse', render: (r) => strong({}, r.strengthClass) },
                { label: 'n', align: 'right', render: (r) => String(r.n) },
                { label: 'Gewogen gemiddelde', align: 'right', render: (r) => smart(r.weightedMean) },
                { label: 'Min', align: 'right', render: (r) => smart(r.min) },
                { label: 'Max', align: 'right', render: (r) => smart(r.max) },
                { label: 'Variatiecoëfficiënt', align: 'right', render: (r) => pct(r.cv, 0) },
                { label: 'Spreiding t.o.v. gemiddelde', align: 'right', render: (r) => pct(r.spreadPct, 0) },
              ],
              spreadRows,
              { compact: true },
            )
          : null,
      ),
      { hint: 'Enkel volledig BEPD-gedekte, gepubliceerde declaraties tellen mee.' },
    ),

    div(
      { class: 'grid grid--2' },
      card(
        'Dekking per organisatie',
        dataTable(
          [
            { label: 'Organisatie', render: (r) => div({}, strong({}, r.name), span({ class: 'sub' }, r.type === 'SUPPLIER' ? 'Leverancier' : 'Producent')) },
            { label: 'Grondstoffen', align: 'right', render: (r) => String(r.materials) },
            { label: 'Gepubliceerd', align: 'right', render: (r) => String(r.published) },
          ],
          data.coverage,
          { compact: true },
        ),
        { flush: true },
      ),
      card(
        'Vastgelegde sectorgemiddelden',
        dataTable(
          [
            { label: 'Benaming', render: (r) => strong({}, r.label) },
            { label: 'Klasse', render: (r) => r.strength_class ?? 'alle' },
            { label: 'n', align: 'right', render: (r) => String(r.sample_size) },
            { label: 'Opgesteld', render: (r) => date(r.created_at) },
          ],
          data.aggregations,
          { compact: true, emptyText: 'Nog geen gemiddelde vastgelegd.' },
        ),
        { flush: true, actions: [a({ href: '#/sector', class: 'btn btn--small' }, 'Samenstellen')] },
      ),
    ),

    data.settings
      ? card(
          'Actieve drempelwaarden',
          div(
            { class: 'grid grid--3' },
            thresholdStat('Wijzigingsmarge per stap', data.settings.bypass_tolerance_pct, '%'),
            thresholdStat('Opgetelde drift', data.settings.bypass_cumulative_pct, '%'),
            thresholdStat('Opeenvolgende bypasses', data.settings.bypass_max_consecutive, 'x'),
            thresholdStat('Marge op levering', data.settings.delivery_tolerance_pct, '%'),
            thresholdStat('Geldigheid declaratie', data.settings.declaration_validity_months, 'maanden'),
          ),
          { hint: 'Deze waarden bepalen wanneer een receptuurwijziging opnieuw langs een verificateur moet.', actions: [a({ href: '#/reference', class: 'btn btn--small' }, 'Aanpassen')] },
        )
      : null,
  );
}

function thresholdStat(label, value, unit) {
  return stat({ label, value: value ?? '—', unit });
}

/* ------------------------------------------------------------------ */

function notificationsCard(data) {
  return card(
    'Meldingen',
    data.notifications?.length
      ? timeline(data.notifications.map((n) => ({ ts: n.created_at, summary: n.title, actor_label: n.body ?? '' })))
      : empty('Geen recente meldingen'),
    { flush: false },
  );
}
