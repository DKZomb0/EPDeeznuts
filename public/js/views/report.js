/**
 * Het transparantierapport, als afdrukbaar document.
 *
 * "Op een knop duwen en het rolt eruit" — en wat eruit rolt moet iemand
 * overtuigen die betaald wordt om sceptisch te zijn. Dus: bronnen onder elke
 * factor, de verantwoording naast elke overschreven parameter, en met zoveel
 * woorden of dit de geverifieerde momentopname is of een verse berekening.
 */
import { tags } from '../lib/dom.js';
import { tag, verdictTag, evidenceTag, dataTable, kv, banner, traceView, ref, smart, date, dateTime, pct } from '../lib/ui.js';

const { div, span, strong, h2, p, a, small } = tags;

export function renderReport(report) {
  const unit = report.calculation.leadIndicator.unit;

  return div(
    { class: 'report' },

    div(
      { class: 'report__head' },
      div(
        {},
        div({ class: 'report__title' }, `Milieuprofiel ${report.subject.recipe.code}`),
        div({ class: 'muted' }, report.subject.recipe.name),
        div({ class: 'flex gap-sm mt-1 wrap' }, verdictTag(report.validity.verdict), tag(report.meta.scope, 'tag-quiet'), report.subject.recipe.benor ? tag('BENOR', 'tag-accent') : null),
      ),
      div(
        { class: 'report__meta' },
        div({}, strong({}, report.subject.producer.name)),
        div({}, report.subject.site?.name ?? ''),
        div({}, `Versie v${report.subject.version.number} · geldig vanaf ${date(report.subject.version.effectiveFrom)}`),
        div({}, `Opgesteld op ${dateTime(report.meta.generatedAt)}`),
        div({}, `${report.meta.standard} · rekenmotor v${report.meta.engineVersion}`),
      ),
    ),

    banner(report.meta.basis === 'SNAPSHOT' ? 'plain' : 'warn', {
      icon: report.meta.basis === 'SNAPSHOT' ? 'info' : 'warning',
      title: report.meta.basis === 'SNAPSHOT' ? 'Vastgelegde momentopname' : 'Actuele berekening, nog niet vastgelegd',
      body: report.meta.basisNote,
    }),

    report.meta.drift?.material
      ? banner('warn', {
          icon: 'warning',
          title: 'Herberekening wijkt af van de geverifieerde momentopname',
          body: `Op de masterdata van vandaag geeft dezelfde receptuur ${smart(report.meta.drift.live)} ${unit} in plaats van de geverifieerde ${smart(report.meta.drift.snapshot)} ${unit} (${pct(report.meta.drift.deltaPct, 2)}). Dat verschil komt van bijgewerkte factoren, niet van een receptuurwijziging.`,
        })
      : null,

    /* --- kopcijfer --------------------------------------------------- */
    h2({}, 'Resultaat'),
    div(
      { class: 'flex wrap', style: { gap: '28px', alignItems: 'flex-end' } },
      div(
        {},
        div({ class: 'panel__kicker' }, 'Global warming potential, totaal'),
        div({ class: 'figure' }, span({ class: 'figure__value' }, smart(report.calculation.leadIndicator.total)), span({ class: 'figure__unit' }, unit)),
        div({ class: 'kpi__note' }, `per ${report.meta.functionalUnit}`),
      ),
      div(
        {},
        div({ class: 'panel__kicker mb-1' }, 'Per fase'),
        div(
          { class: 'flex wrap', style: { gap: '14px' } },
          report.calculation.modules.map((module) => div({ class: 'flex gap-sm' }, span({ class: 'trace__code' }, module.code), span({ class: 'mono' }, smart(module.subtotal)))),
        ),
      ),
    ),

    /* --- declaratie -------------------------------------------------- */
    report.declaration
      ? [
          h2({}, 'Declaratie'),
          kv([
            ['Status', report.declaration.statusLabel],
            ['Certificaatnummer', report.declaration.certificateNo ? span({ class: 'mono' }, report.declaration.certificateNo) : '—'],
            ['Controlebureau', report.declaration.verifier?.name ?? '—'],
            ['Ingediend op', date(report.declaration.submittedAt)],
            ['Geverifieerd op', date(report.declaration.verifiedAt)],
            ['Geldig tot', date(report.declaration.validUntil)],
            report.declaration.inheritedFrom ? ['Geërfde verificatie', `Ja — afwijking ${pct(report.declaration.inheritedDeviationPct, 2)} t.o.v. het vorige dossier`] : null,
            report.declaration.decisionNote ? ['Nota controlebureau', report.declaration.decisionNote] : null,
          ]),
        ]
      : null,

    /* --- inputs ------------------------------------------------------ */
    h2({}, 'Ingaande grondstoffen'),
    dataTable(
      [
        { label: 'Grondstof', render: (r) => div({}, div({ class: 'strong' }, r.name), div({ class: 'sub' }, `${r.supplier} · ${r.code ?? ''}`)) },
        { label: 'Dosering', align: 'right', render: (r) => `${smart(r.quantityKg)} kg` },
        { label: 'Aanvoer', align: 'right', muted: true, render: (r) => (r.inboundIncluded ? 'franco' : r.transportKm ? `${smart(r.transportKm)} km` : '—') },
        { label: 'Transportprofiel', muted: true, wrap: true, render: (r) => r.transportProfile ?? '—' },
        { label: 'Bron', render: (r) => (r.evidence ? div({}, evidenceTag(r.evidence.type), r.evidence.number ? div({ class: 'sub mono' }, r.evidence.number) : null) : tag('ontbreekt', 'tag-neutral')) },
        { label: 'Geldig tot', muted: true, render: (r) => (r.evidence?.validUntil ? date(r.evidence.validUntil) : '—') },
        { label: `Bijdrage (${unit})`, align: 'right', render: (r) => smart(r.leadContribution) },
      ],
      report.inputs,
    ),

    /* --- parameters --------------------------------------------------- */
    h2({}, 'Procesparameters'),
    dataTable(
      [
        { label: 'Parameter', render: (r) => div({}, div({ class: 'strong' }, r.label), div({ class: 'sub mono' }, r.code)) },
        { label: 'Fase', render: (r) => tag(r.module ?? '—', 'tag-accent') },
        { label: 'Waarde', align: 'right', render: (r) => `${smart(r.value)} ${r.unit}` },
        { label: 'Herkomst', render: (r) => tag(r.overridden ? 'Eigen meting' : 'Sectorwaarde', r.overridden ? 'tag-outline' : 'tag-quiet') },
        { label: 'Verantwoording', wrap: true, render: (r) => span({ class: 'small' }, r.justification ?? (r.overridden ? '— ontbreekt —' : '')) },
      ],
      report.parameters,
    ),

    /* --- de berekening ------------------------------------------------ */
    h2({}, 'Berekening, term per term'),
    div({ style: { border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' } }, traceView(report.calculation.modules, unit)),

    /* --- indicatoren --------------------------------------------------- */
    h2({}, 'Milieu-indicatoren'),
    dataTable(
      [
        { label: 'Indicator', render: (r) => div({}, div({ class: 'strong' }, r.short), div({ class: 'sub' }, r.label)) },
        { label: 'Eenheid', muted: true, render: (r) => r.unit },
        ...report.results.modules.map((m) => ({ label: m, align: 'right', render: (r) => smart(r.byModule[m]) })),
        { label: 'Totaal', align: 'right', render: (r) => strong({ class: 'tnum' }, smart(r.total)) },
      ],
      report.results.indicators,
    ),

    /* --- herkomst masterdata -------------------------------------------- */
    h2({}, 'Gebruikte masterdata'),
    p({ class: 'small dim' }, 'Alle factoren zijn gedateerd. Een berekening verwijst altijd naar de versie die gold op haar referentiedatum, niet naar de nieuwste.'),
    report.masterData.transportProfiles.length
      ? dataTable(
          [
            { label: 'Transportprofiel', render: (r) => div({}, div({ class: 'strong' }, r.name), div({ class: 'sub mono' }, r.code)) },
            { label: 'Factor', align: 'right', render: (r) => `${smart(r.leadValue)} ${r.leadUnit}` },
            { label: 'Leegrit', muted: true, render: (r) => (r.emptyReturn ? 'inbegrepen' : 'niet inbegrepen') },
            { label: 'Geldig vanaf', muted: true, render: (r) => date(r.validFrom) },
            { label: 'Bron', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.source) },
          ],
          report.masterData.transportProfiles,
        )
      : null,
    report.masterData.energyFactors.length
      ? dataTable(
          [
            { label: 'Energiefactor', render: (r) => div({}, div({ class: 'strong' }, r.name), div({ class: 'sub mono' }, r.code)) },
            { label: 'Factor', align: 'right', render: (r) => `${smart(r.leadValue)} ${r.leadUnit}` },
            { label: 'Geldig vanaf', muted: true, render: (r) => date(r.validFrom) },
            { label: 'Bron', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.source) },
          ],
          report.masterData.energyFactors,
        )
      : null,
    report.masterData.categoryRules.length
      ? dataTable(
          [
            { label: 'Categorie', render: (r) => strong({}, r.category) },
            { label: 'Verplichte fasen', render: (r) => span({ class: 'mono' }, r.required_modules) },
            { label: 'Grondslag', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.source) },
          ],
          report.masterData.categoryRules,
        )
      : null,

    /* --- geldigheid ------------------------------------------------------ */
    h2({}, 'Geldigheid'),
    banner(report.validity.verdict === 'VALID' ? 'accent' : report.validity.verdict === 'INVALID' ? 'neutral' : 'warn', {
      icon: report.validity.verdict === 'VALID' ? 'checkCircle' : report.validity.verdict === 'INVALID' ? 'prohibit' : 'warning',
      title: report.validity.verdictLabel,
      body: report.validity.verdictDescription,
    }),
    p({ class: 'small' }, report.validity.rule),
    report.validity.reasons.length
      ? dataTable(
          [
            { label: 'Bevinding', wrap: true, render: (r) => span({ class: 'small' }, r.message) },
            { label: 'Ernst', render: (r) => verdictTag(r.verdict) },
            { label: 'Code', muted: true, render: (r) => span({ class: 'mono tiny' }, r.code) },
          ],
          report.validity.reasons,
        )
      : p({ class: 'small muted' }, 'Geen bevindingen.'),

    /* --- wijzigingscontrole ------------------------------------------------ */
    report.changeControl
      ? [
          h2({}, 'Wijzigingscontrole'),
          p({ class: 'small' }, report.changeControl.summary),
          dataTable(
            [
              { label: 'Toets', wrap: true, render: (r) => span({ class: 'small' }, r.message) },
              { label: 'Resultaat', render: (r) => tag(r.passed ? 'voldaan' : 'niet voldaan', r.passed ? 'tag-accent' : 'tag-neutral') },
            ],
            report.changeControl.checks ?? [],
          ),
        ]
      : null,

    /* --- audittrail ---------------------------------------------------------- */
    h2({}, 'Audittrail'),
    dataTable(
      [
        { label: 'Wanneer', muted: true, render: (r) => dateTime(r.ts) },
        { label: 'Wie', render: (r) => r.actor_label },
        { label: 'Wat', wrap: true, render: (r) => span({ class: 'small' }, r.summary) },
      ],
      report.audit,
      { emptyTitle: 'Geen registraties' },
    ),

    div(
      { class: 'report__signature' },
      div({}, div({ class: 'strong' }, 'Opgesteld door'), div({}, report.subject.producer.name), div({ class: 'tiny' }, report.subject.producer.vat ?? '')),
      div(
        {},
        div({ class: 'strong' }, 'Geverifieerd door'),
        div({}, report.declaration?.verifier?.name ?? 'nog niet geverifieerd'),
        div({ class: 'tiny' }, report.declaration?.verifiedAt ? date(report.declaration.verifiedAt) : ''),
      ),
      div(
        {},
        div({ class: 'strong' }, 'Documentkenmerk'),
        div({ class: 'mono tiny' }, report.subject.version.id),
        div({ class: 'tiny' }, `referentiedatum ${date(report.meta.referenceDate)}`),
      ),
    ),
  );
}
