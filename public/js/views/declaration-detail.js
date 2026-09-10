/**
 * One declaration: the snapshot, its verdict, and — for a verifier — the
 * decision itself.
 *
 * A verifier lands here from the queue and has to be able to reach everything
 * without leaving: the frozen calculation, each input's declaration number, the
 * parameters a producer overrode and the reasoning it gave for doing so.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  card, dataTable, kv, stat, badge, verdictBadge, statusBadge, evidenceBadge, note, pageHead,
  toast, modal, formModal, moduleBar, traceView, gatePanel, timeline, textField, textAreaField, ref,
} from '../lib/ui.js';
import { smart, date, dateTime, pct } from '../lib/format.js';

const { div, span, strong, a, button, p, small } = tags;

export async function render(outlet, { params, setTitle, navigate }) {
  const host = div();
  mount(outlet, host);

  const load = async () => {
    const { declaration, audit } = await api.get(`/declarations/${params.id}`);
    draw(declaration, audit);
  };

  const draw = (declaration, audit) => {
    const result = declaration.result;
    const unit = result?.lead?.unit ?? 'kg CO₂ eq.';
    setTitle(`${declaration.recipe_code} v${declaration.version_no}`, declaration.producer_name);

    const isVerifier = can('verification:decide');
    const canDecide = isVerifier && ['SUBMITTED', 'UNDER_VERIFICATION'].includes(declaration.status);

    mount(
      host,
      pageHead(
        `${declaration.recipe_code} · v${declaration.version_no}`,
        `${declaration.recipe_name} — ingediend door ${declaration.producer_name}.`,
        [
          a({ href: `#/versions/${declaration.recipe_version_id}`, class: 'btn btn--ghost' }, 'Receptuurversie'),
          button({ class: 'btn', onClick: () => openReport(declaration.id) }, 'Transparantierapport'),
          declaration.status === 'SUBMITTED' && isVerifier
            ? button({ class: 'btn btn--primary', onClick: () => take(declaration.id, load) }, 'In behandeling nemen')
            : null,
          canDecide ? button({ class: 'btn btn--accent', onClick: () => decide(declaration, true, load) }, 'Goedkeuren') : null,
          canDecide ? button({ class: 'btn btn--danger', onClick: () => decide(declaration, false, load) }, 'Afkeuren') : null,
          declaration.status === 'VERIFIED' && isVerifier
            ? button({ class: 'btn btn--accent', onClick: () => publish(declaration.id, load) }, 'Publiceren')
            : null,
        ].filter(Boolean),
      ),

      declaration.status === 'AUTO_ACCEPTED'
        ? note(
            'ok',
            strong({}, 'Automatisch aanvaard. '),
            `Deze versie week ${pct(declaration.bypass_deviation, 2)} af van het vorige dossier en bleef daarmee binnen de afgesproken marge. De bestaande verificatie blijft gelden; er kwam geen externe controle aan te pas.`,
          )
        : null,

      declaration.verdict !== 'VALID'
        ? note(
            declaration.verdict === 'INVALID' ? 'bad' : 'warn',
            strong({}, `${ref().verdicts?.[declaration.verdict]?.label ?? declaration.verdict}. `),
            ref().verdicts?.[declaration.verdict]?.description ?? '',
            declaration.verdict === 'INVALID' ? ' Een verificateur kan dit niet goedkeuren: het ontbrekende bewijsstuk zit stroomopwaarts.' : '',
          )
        : null,

      div(
        { class: 'grid grid--4 mb-2' },
        stat({
          label: 'GWP-totaal',
          value: smart(result?.totals?.GWP_TOTAL),
          unit,
          note: result?.functionalUnit,
          tone: declaration.verdict === 'VALID' ? 'ok' : declaration.verdict === 'INVALID' ? 'bad' : 'warn',
        }),
        stat({ label: 'Status', value: ref().declarationStatusLabels?.[declaration.status] ?? declaration.status }),
        stat({ label: 'Certificaat', value: declaration.certificate_no ?? '—', note: declaration.valid_until ? `geldig tot ${date(declaration.valid_until)}` : '' }),
        stat({ label: 'Bereik', value: declaration.scope, note: 'volgens EN 15804+A2' }),
      ),

      div(
        { class: 'grid grid--side' },
        div(
          {},
          result
            ? card('Verdeling over de modules', moduleBar(result.lead.byModule, result.modules, unit), {
                hint: 'Zoals vastgelegd op het ogenblik van indiening.',
              })
            : null,

          result
            ? card(
                'Ingaande grondstoffen',
                dataTable(
                  [
                    { label: 'Grondstof', render: (c) => div({}, strong({}, c.name), span({ class: 'sub' }, c.supplier)) },
                    { label: 'Dosering', align: 'right', render: (c) => `${smart(c.quantityKg)} kg/m³` },
                    { label: 'Aanvoer', align: 'right', render: (c) => (c.transportKm ? `${smart(c.transportKm)} km` : '—') },
                    { label: 'Bewijsstuk', render: (c) => evidenceBadge(c.evidence?.type) },
                    { label: 'Nummer', render: (c) => span({ class: 'mono tiny' }, c.evidence?.number ?? '—') },
                    { label: 'Oordeel', render: (c) => verdictBadge(c.evidence?.verdict) },
                    { label: `Bijdrage`, align: 'right', render: (c) => smart(c.contribution?.GWP_TOTAL) },
                  ],
                  result.components ?? [],
                  { compact: true },
                ),
                { flush: true, hint: 'De verificateur controleert deze nummers tegen de nationale databank.' },
              )
            : null,

          result?.parameters?.length
            ? card(
                'Procesparameters',
                dataTable(
                  [
                    { label: 'Parameter', render: (p) => strong({}, p.label) },
                    { label: 'Waarde', align: 'right', render: (p) => `${smart(p.value)} ${p.unit}` },
                    { label: 'Herkomst', render: (p) => (p.overridden ? badge('Eigen meting', 'warn') : badge('Sectorwaarde', 'muted')) },
                    { label: 'Verantwoording', render: (p) => span({ class: 'small' }, p.justification ?? '') },
                  ],
                  result.parameters,
                  { compact: true },
                ),
                { flush: true, hint: 'Elke overschrijving hoort door de verificateur getoetst te worden aan het bijgevoegde bewijs.' },
              )
            : null,

          result
            ? card(
                'Berekening, term per term',
                traceView(
                  {
                    modules: (ref().modules ?? [])
                      .filter((m) => result.modules.includes(m.code))
                      .map((m) => ({ ...m, lines: result.trace.filter((l) => l.module === m.code), subtotal: result.byModule[m.code]?.GWP_TOTAL ?? 0 })),
                  },
                  unit,
                ),
                { flush: true },
              )
            : null,
        ),

        div(
          {},
          card(
            'Dossier',
            kv([
              ['Producent', declaration.producer_name],
              ['Receptuur', `${declaration.recipe_code} v${declaration.version_no}`],
              ['Sterkteklasse', declaration.strength_class ?? '—'],
              ['Ingediend', dateTime(declaration.submitted_at)],
              ['Verificateur', declaration.verifier_name ?? '—'],
              ['Geverifieerd', declaration.verified_at ? dateTime(declaration.verified_at) : '—'],
              declaration.decision_note ? ['Nota', declaration.decision_note] : null,
              ['Wijzigingsreden', declaration.change_reason ?? '—'],
            ]),
          ),

          declaration.gates?.length ? card('Wijzigingscontrole', gateHistory(declaration.gates), { flush: true }) : null,
          card('Audittrail', timeline(audit)),
        ),
      ),
    );
  };

  await load();
}

function gateHistory(gates) {
  const latest = gates[0];
  return div(
    {},
    gatePanel({
      decision: latest.decision,
      title: latest.decision === 'GO' ? 'Binnen de marge aanvaard' : 'Naar externe verificatie gestuurd',
      subtitle: latest.deviation_pct !== null ? `Afwijking ${pct(latest.deviation_pct, 2)} (drempel ± ${latest.threshold_pct} %)` : latest.note,
      checks: latest.reasons ?? [],
    }),
  );
}

/* ------------------------------------------------------------------ */

async function take(declarationId, reload) {
  try {
    await api.post(`/declarations/${declarationId}/take`, {});
    toast('Dossier in behandeling genomen.', 'ok');
    await reload();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function decide(declaration, approve, reload) {
  formModal({
    title: approve ? 'Dossier goedkeuren' : 'Dossier afkeuren',
    hint: approve
      ? 'U bevestigt dat de ingegeven gegevens gecontroleerd zijn en dat de rekenregels correct toegepast werden.'
      : 'De producent krijgt uw motivering te zien en kan een nieuwe versie indienen.',
    fields: [
      approve && declaration.verdict === 'VALID_WITH_WARNINGS'
        ? note(
            'warn',
            'Dit dossier steunt op minstens één internationale EPD in plaats van een BEPD. Goedkeuren mag, maar het dossier houdt zijn vlag en telt niet mee in de sectorgemiddelden.',
          )
        : null,
      approve ? textField('certificateNo', 'Certificaatnummer', { hint: 'Leeg laten om automatisch te nummeren.' }) : null,
      textAreaField('note', approve ? 'Nota bij de goedkeuring' : 'Motivering van de afkeuring', {
        required: !approve,
        placeholder: approve
          ? 'Bv. "Steekproef op leveringsbonnen en energiemeting uitgevoerd. Rekenregels conform EN 15804+A2."'
          : 'Bv. "Het meetrapport bij de overschreven elektriciteitswaarde ontbreekt."',
      }),
    ].filter(Boolean),
    submitLabel: approve ? 'Goedkeuren' : 'Afkeuren',
    onSubmit: async (values, close) => {
      await api.post(`/declarations/${declaration.id}/decide`, { decision: approve ? 'APPROVE' : 'REJECT', ...values });
      close();
      toast(approve ? 'Dossier goedgekeurd.' : 'Dossier afgekeurd.', 'ok');
      await reload();
    },
  });
}

async function publish(declarationId, reload) {
  try {
    await api.post(`/declarations/${declarationId}/publish`, {});
    toast('Gepubliceerd. Het dossier telt nu mee in de sectorgemiddelden.', 'ok');
    await reload();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function openReport(declarationId) {
  const { report } = await api.get(`/declarations/${declarationId}/report`);
  const { renderReport } = await import('./report.js');
  modal({
    title: 'Transparantierapport',
    hint: 'Het volledige dossier: inputs, parameters, elke rekenterm, de gebruikte masterdata en de audittrail.',
    wide: true,
    body: renderReport(report),
    actions: (close) => [
      button({ class: 'btn', onClick: () => window.print() }, 'Afdrukken'),
      button({ class: 'btn btn--primary', onClick: close }, 'Sluiten'),
    ],
  });
}
