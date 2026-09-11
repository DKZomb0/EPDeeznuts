/**
 * Eén dossier: de vastgelegde berekening, het oordeel, en — voor het
 * controlebureau — de beslissing zelf.
 *
 * Het ontwerp zet de verificateur een diff voor: wat is er veranderd sinds de
 * vorige verificatie, met de onderbouwing ernaast. Dat is wat hem tijd kost of
 * bespaart, niet de volledige receptuur opnieuw lezen.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  panel, tablePanel, banner, kv, tag, verdictTag, statusTag, evidenceTag, pageHead, toast, modal,
  formModal, figure, barLines, traceView, checklist, btn, textField, textAreaField, logList,
  ref, smart, date, dateTime, pct, icon,
} from '../lib/ui.js';

const { div, span, strong, p, small, sub } = tags;

export async function render(outlet, { params, setTitle, navigate, refresh }) {
  const host = div({ class: 'stack' });
  mount(outlet, host);

  const load = async () => {
    const { declaration, audit } = await api.get(`/declarations/${params.id}`);
    draw(declaration, audit);
  };

  const draw = (declaration, audit) => {
    const result = declaration.result;
    const unit = result?.lead?.unit ?? 'kg CO₂ eq.';
    setTitle(`Dossier ${declaration.certificate_no ?? declaration.recipe_code}`);

    const isVerifier = can('verification:decide');
    const canDecide = isVerifier && ['SUBMITTED', 'UNDER_VERIFICATION'].includes(declaration.status);
    const gate = declaration.gates?.[0];

    mount(
      host,
      pageHead({
        crumb: [
          { label: isVerifier ? 'Verificatiedossiers' : 'Declaraties', onClick: () => navigate(isVerifier ? '/verification' : '/declarations') },
          { label: declaration.certificate_no ?? `${declaration.recipe_code} v${declaration.version_no}` },
        ],
        title: isVerifier ? `Dossier ${declaration.certificate_no ?? shortRef(declaration.id)}` : `${declaration.recipe_code} · v${declaration.version_no}`,
        lede: `${declaration.producer_name} · receptuur ${declaration.recipe_code} · ingediend ${dateTime(declaration.submitted_at)}`,
        actions: [
          btn('Rekenblad', { variant: 'secondary', icon: 'calculator', href: `#/versions/${declaration.recipe_version_id}` }),
          btn('Transparantierapport', { variant: 'secondary', icon: 'fileText', onClick: () => openReport(declaration.id) }),
          declaration.status === 'SUBMITTED' && isVerifier ? btn('In behandeling nemen', { variant: 'secondary', icon: 'clock', onClick: () => take(declaration.id, load) }) : null,
          canDecide ? btn('No-go', { variant: 'danger', onClick: () => decide(declaration, false, load, refresh) }) : null,
          canDecide ? btn('Go — BEPD vrijgeven', { variant: 'primary', icon: 'sealCheck', onClick: () => decide(declaration, true, load, refresh) }) : null,
          declaration.status === 'VERIFIED' && isVerifier ? btn('Publiceren', { variant: 'primary', icon: 'upload', onClick: () => publish(declaration.id, load) }) : null,
        ].filter(Boolean),
      }),

      decisionBanner(declaration, isVerifier),

      div(
        { class: 'grid grid--wide' },
        div(
          { class: 'flex-col', style: { gap: '16.8px', minWidth: 0 } },
          gate ? diffPanel(gate, declaration, result) : null,

          result
            ? panel({
                title: 'Ingaande grondstoffen',
                sub: 'Het controlebureau toetst deze nummers tegen de nationale databank.',
                variant: 'flush',
                body: tablePanel(
                  [
                    { label: 'Grondstof', render: (c) => div({}, div({ class: 'strong' }, c.name), div({ class: 'sub' }, c.supplier)) },
                    { label: 'Dosering', align: 'right', render: (c) => `${smart(c.quantityKg)} kg/m³` },
                    { label: 'Aanvoer', align: 'right', muted: true, render: (c) => (c.transportKm ? `${smart(c.transportKm)} km` : '—') },
                    { label: 'Bron', render: (c) => evidenceTag(c.evidence?.type) },
                    { label: 'Nummer', muted: true, render: (c) => span({ class: 'mono tiny' }, c.evidence?.number ?? '—') },
                    { label: 'Oordeel', render: (c) => verdictTag(c.evidence?.verdict) },
                    { label: 'Bijdrage', align: 'right', render: (c) => smart(c.contribution?.GWP_TOTAL) },
                  ],
                  result.components ?? [],
                ),
              })
            : null,

          result?.parameters?.length
            ? panel({
                title: 'Procesparameters',
                sub: 'Elke overschrijving hoort getoetst te worden aan het bijgevoegde bewijs.',
                variant: 'flush',
                body: tablePanel(
                  [
                    { label: 'Parameter', render: (p) => strong({}, p.label) },
                    { label: 'Waarde', align: 'right', render: (p) => `${smart(p.value)} ${p.unit}` },
                    { label: 'Herkomst', render: (p) => tag(p.overridden ? 'Eigen meting' : 'Sectorwaarde', p.overridden ? 'tag-outline' : 'tag-quiet') },
                    { label: 'Verantwoording', wrap: true, muted: true, render: (p) => span({ class: 'small' }, p.justification ?? '—') },
                  ],
                  result.parameters,
                ),
              })
            : null,

          result
            ? panel({
                title: 'Berekening, term per term',
                variant: 'flush',
                body: div(
                  { style: { padding: '0 0 5.6px' } },
                  traceView(
                    (ref().modules ?? [])
                      .filter((m) => result.modules.includes(m.code))
                      .map((m) => ({ ...m, lines: result.trace.filter((l) => l.module === m.code), subtotal: result.byModule[m.code]?.GWP_TOTAL ?? 0 })),
                    unit,
                  ),
                ),
              })
            : null,
        ),

        div(
          { class: 'flex-col', style: { gap: '16.8px', minWidth: 0 } },
          result
            ? panel({
                kicker: `Resultaat ${declaration.scope}`,
                body: div(
                  {},
                  figure(smart(result.totals.GWP_TOTAL), unit),
                  div({ class: 'mt-2' }, barLines(result.modules.map((m) => ({ label: m, value: result.byModule[m]?.GWP_TOTAL ?? 0 })), { unit })),
                ),
              })
            : null,

          panel({
            kicker: 'Rekenregel — herleidbaar',
            body: div(
              {},
              div(
                { class: 'formula-block mt-1' },
                'A1 = Σ (mᵢ / 1000) × GWP_BEPD,ᵢ',
                div({}, 'A2 = Σ (mᵢ / 1000) × dᵢ × f_transport'),
                div({}, 'A3 = E_menger × f_elektriciteit + brandstof'),
              ),
              p({ class: 'tiny muted mt-1' }, 'EN 15804+A2 tabel 4 · EN 16757 §7.2. Elke waarde is doorklikbaar tot de BEPD-fiche en de gebruiker die ze invoerde.'),
            ),
          }),

          panel({
            kicker: 'Dossier',
            body: kv([
              ['Producent', declaration.producer_name],
              ['Receptuur', `${declaration.recipe_code} v${declaration.version_no}`],
              ['Sterkteklasse', declaration.strength_class ?? '—'],
              ['Bereik', tag(declaration.scope, 'tag-quiet')],
              ['Status', statusTag(declaration.status)],
              ['Oordeel', verdictTag(declaration.verdict)],
              ['Certificaat', declaration.certificate_no ? span({ class: 'mono' }, declaration.certificate_no) : '—'],
              ['Controlebureau', declaration.verifier_name ?? '—'],
              ['Geverifieerd', declaration.verified_at ? dateTime(declaration.verified_at) : '—'],
              ['Geldig tot', declaration.valid_until ? date(declaration.valid_until) : '—'],
              declaration.decision_note ? ['Nota', declaration.decision_note] : null,
            ]),
          }),

          panel({ kicker: 'Audittrail', body: logList(audit, { limit: 14 }) }),
        ),
      ),
    );
  };

  await load();
}

/* ------------------------------------------------------------------ */

function decisionBanner(declaration, isVerifier) {
  if (declaration.status === 'AUTO_ACCEPTED') {
    return banner('accent', {
      icon: 'lightning',
      title: 'Automatisch aanvaard binnen de bandbreedte',
      body: `Deze versie week ${pct(declaration.bypass_deviation, 2)} af van het vorige dossier en bleef daarmee binnen de afgesproken marge. De bestaande verificatie blijft gelden; er kwam geen externe controle aan te pas.`,
    });
  }

  if (declaration.status === 'VERIFIED' || declaration.status === 'PUBLISHED') {
    return banner('accent', {
      icon: 'sealCheck',
      title: `Go — BEPD ${declaration.scope} vrijgegeven`,
      body: `${dateTime(declaration.verified_at)} door ${declaration.verifier_name ?? 'het controlebureau'}. ${declaration.decision_note ?? ''}`,
    });
  }

  if (declaration.status === 'REJECTED') {
    return banner('neutral', { icon: 'xCircle', title: 'No-go — dossier terug naar de producent', body: declaration.decision_note ?? '' });
  }

  if (declaration.verdict === 'INVALID') {
    return banner('neutral', {
      icon: 'prohibit',
      title: 'Resultaat ongeldig',
      body: 'Minstens één grondstof mist een geldig bewijsstuk. Dit kan het controlebureau niet opheffen: het gat zit stroomopwaarts.',
    });
  }

  if (declaration.verdict === 'VALID_WITH_WARNINGS') {
    return banner('warn', {
      icon: 'warning',
      title: 'Geldig, met voorbehoud',
      body: 'Eén input steunt op een internationale EPD in plaats van een Belgische BEPD. Toegelaten, maar dit dossier gaat altijd langs het controlebureau en telt niet mee in de sectorgemiddelden.',
    });
  }

  return banner(isVerifier ? 'warn' : 'plain', {
    icon: 'hourglass',
    title: isVerifier ? 'Beslissing vereist' : 'In behandeling',
    body: isVerifier
      ? 'Go betekent dat deze receptuur geleverd mag worden met de berekende milieuwaarden; er volgt geen audit achteraf.'
      : 'Het controlebureau bekijkt uw dossier.',
  });
}

/**
 * Wat is er veranderd sinds de vorige verificatie. Dit is de tabel waar het
 * controlebureau zijn tijd aan besteedt.
 */
function diffPanel(gate, declaration, result) {
  const reasons = gate.reasons ?? [];
  return panel({
    title: 'Gewijzigd t.o.v. de vorige verificatie',
    sub: gate.deviation_pct !== null ? `Totale afwijking ${pct(gate.deviation_pct, 2)} · bandbreedte ±${gate.threshold_pct}%` : gate.note,
    body: div({ class: 'flex-col' }, checklist(reasons.map((r) => ({ passed: r.passed, message: r.message })))),
  });
}

function shortRef(id) {
  return String(id).split('_')[1]?.slice(0, 6) ?? id;
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

function decide(declaration, approve, reload, refresh) {
  formModal({
    title: approve ? 'Go — BEPD vrijgeven' : 'No-go',
    hint: approve
      ? 'U bevestigt dat de ingegeven gegevens gecontroleerd zijn en dat de rekenregels correct toegepast werden.'
      : 'De producent krijgt uw motivering te zien en kan een nieuwe versie indienen.',
    fields: [
      approve && declaration.verdict === 'VALID_WITH_WARNINGS'
        ? banner('warn', {
            icon: 'warning',
            body: 'Dit dossier steunt op minstens één internationale EPD. Vrijgeven mag, maar het dossier houdt zijn vlag en telt niet mee in de sectorgemiddelden.',
          })
        : null,
      approve ? textField('certificateNo', 'Certificaatnummer', { hint: 'Leeg laten om automatisch te nummeren.' }) : null,
      textAreaField('note', approve ? 'Nota bij de vrijgave' : 'Motivering van de no-go', {
        required: !approve,
        placeholder: approve
          ? 'bv. "Steekproef op leveringsbonnen en energiemeting uitgevoerd. Rekenregels conform EN 15804+A2."'
          : 'bv. "Verantwoordingsnota bij de afwijkende mengerwaarde ontbreekt."',
      }),
    ],
    submitLabel: approve ? 'Go' : 'No-go',
    submitIcon: approve ? 'sealCheck' : 'xCircle',
    onSubmit: async (values, close) => {
      await api.post(`/declarations/${declaration.id}/decide`, { decision: approve ? 'APPROVE' : 'REJECT', ...values });
      close();
      toast(approve ? 'Dossier vrijgegeven.' : 'Dossier afgekeurd.', 'ok');
      await reload();
      await refresh?.();
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
    actions: (close) => [btn('Afdrukken', { variant: 'secondary', icon: 'printer', onClick: () => window.print() }), btn('Sluiten', { variant: 'primary', onClick: close })],
  });
}
