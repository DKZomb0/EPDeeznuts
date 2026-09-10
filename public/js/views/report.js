/**
 * The transparency report, rendered as a printable document.
 *
 * "Op een knop duwen en het rolt eruit" - and what rolls out has to satisfy
 * somebody who is paid to be sceptical. Hence: sources under every factor, the
 * justification text next to every overridden parameter, and an explicit note
 * about whether these numbers are the verified snapshot or a fresh calculation.
 */
import { tags } from '../lib/dom.js';
import { badge, verdictBadge, evidenceBadge, dataTable, kv, note, traceView, ref } from '../lib/ui.js';
import { smart, date, dateTime, pct } from '../lib/format.js';

const { div, span, strong, h2, p, a, small, section } = tags;

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
        div({ class: 'mt-1' }, verdictBadge(report.validity.verdict), ' ', badge(report.meta.scope, 'info'), ' ', report.subject.recipe.benor ? badge('BENOR', 'ok') : null),
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

    /* --- what this document is ---------------------------------- */
    note(report.meta.basis === 'SNAPSHOT' ? 'info' : 'warn', strong({}, report.meta.basis === 'SNAPSHOT' ? 'Vastgelegde momentopname. ' : 'Actuele berekening, nog niet vastgelegd. '), report.meta.basisNote),

    report.meta.drift?.material
      ? note(
          'warn',
          strong({}, 'Let op: '),
          `een herberekening op de masterdata van vandaag geeft ${smart(report.meta.drift.live)} ${unit} in plaats van de geverifieerde ${smart(report.meta.drift.snapshot)} ${unit} (${pct(report.meta.drift.deltaPct, 2)}). Dat verschil komt van bijgewerkte factoren, niet van een receptuurwijziging.`,
        )
      : null,

    /* --- headline ------------------------------------------------ */
    h2({}, 'Resultaat'),
    div(
      { class: 'flex wrap', style: { gap: '28px', alignItems: 'flex-end', marginBottom: '14px' } },
      div(
        {},
        div({ class: 'stat__label' }, 'Global warming potential, totaal'),
        div({ class: 'stat__value' }, smart(report.calculation.leadIndicator.total), span({ class: 'stat__unit' }, unit)),
        div({ class: 'stat__note' }, `per ${report.meta.functionalUnit}`),
      ),
      div(
        {},
        div({ class: 'stat__label' }, 'Per module'),
        div(
          { class: 'flex wrap', style: { gap: '14px' } },
          report.calculation.modules.map((module) =>
            div({}, span({ class: 'trace__code' }, module.code), span({ class: 'mono' }, `${smart(module.subtotal)}`)),
          ),
        ),
      ),
    ),

    /* --- declaration --------------------------------------------- */
    report.declaration
      ? [
          h2({}, 'Declaratie'),
          kv([
            ['Status', report.declaration.statusLabel],
            ['Certificaatnummer', report.declaration.certificateNo ? span({ class: 'mono' }, report.declaration.certificateNo) : '—'],
            ['Verificatie-instelling', report.declaration.verifier?.name ?? '—'],
            ['Ingediend op', date(report.declaration.submittedAt)],
            ['Geverifieerd op', date(report.declaration.verifiedAt)],
            ['Geldig tot', date(report.declaration.validUntil)],
            report.declaration.inheritedFrom
              ? ['Geërfde verificatie', `Ja — afwijking ${pct(report.declaration.inheritedDeviationPct, 2)} t.o.v. het vorige dossier`]
              : null,
            report.declaration.decisionNote ? ['Nota verificateur', report.declaration.decisionNote] : null,
          ]),
        ]
      : null,

    /* --- inputs --------------------------------------------------- */
    h2({}, 'Ingaande grondstoffen'),
    dataTable(
      [
        { label: 'Grondstof', render: (r) => div({}, strong({}, r.name), span({ class: 'sub' }, `${r.supplier} · ${r.code ?? ''}`)) },
        { label: 'Dosering', align: 'right', render: (r) => `${smart(r.quantityKg)} kg` },
        { label: 'Aanvoer', align: 'right', render: (r) => (r.inboundIncluded ? span({ class: 'muted small' }, 'franco') : r.transportKm ? `${smart(r.transportKm)} km` : '—') },
        { label: 'Transportprofiel', render: (r) => span({ class: 'small muted' }, r.transportProfile ?? '—') },
        { label: 'Bewijsstuk', render: (r) => (r.evidence ? div({}, evidenceBadge(r.evidence.type), span({ class: 'sub mono' }, r.evidence.number ?? '')) : badge('ontbreekt', 'bad')) },
        { label: 'Geldig tot', render: (r) => (r.evidence?.validUntil ? date(r.evidence.validUntil) : '—') },
        { label: `Bijdrage (${unit})`, align: 'right', render: (r) => smart(r.leadContribution) },
      ],
      report.inputs,
      { compact: true },
    ),

    /* --- parameters ------------------------------------------------ */
    h2({}, 'Procesparameters'),
    dataTable(
      [
        { label: 'Parameter', render: (r) => div({}, strong({}, r.label), span({ class: 'sub mono' }, r.code)) },
        { label: 'Module', render: (r) => badge(r.module ?? '—', 'info') },
        { label: 'Waarde', align: 'right', render: (r) => `${smart(r.value)} ${r.unit}` },
        { label: 'Herkomst', render: (r) => (r.overridden ? badge('Eigen meting', 'warn') : badge('Sectorwaarde', 'muted')) },
        { label: 'Verantwoording', render: (r) => span({ class: 'small' }, r.justification ?? (r.overridden ? '— ontbreekt —' : '')) },
      ],
      report.parameters,
      { compact: true },
    ),

    /* --- the calculation itself ------------------------------------ */
    h2({}, 'Berekening, term per term'),
    div({ style: { border: '1px solid var(--line)', borderRadius: '8px', overflow: 'hidden' } }, traceView(report.calculation, unit)),

    /* --- all indicators -------------------------------------------- */
    h2({}, 'Milieu-indicatoren'),
    dataTable(
      [
        { label: 'Indicator', render: (r) => div({}, strong({}, r.short), span({ class: 'sub' }, r.label)) },
        { label: 'Eenheid', render: (r) => span({ class: 'small muted' }, r.unit) },
        ...report.results.modules.map((m) => ({ label: m, align: 'right', render: (r) => smart(r.byModule[m]) })),
        { label: 'Totaal', align: 'right', render: (r) => strong({}, smart(r.total)) },
      ],
      report.results.indicators,
      { compact: true },
    ),

    /* --- provenance ------------------------------------------------ */
    h2({}, 'Gebruikte masterdata'),
    p({ class: 'small muted' }, 'Alle factoren zijn gedateerd. Een berekening verwijst altijd naar de versie die gold op haar referentiedatum, niet naar de nieuwste.'),
    report.masterData.transportProfiles.length
      ? dataTable(
          [
            { label: 'Transportprofiel', render: (r) => div({}, strong({}, r.name), span({ class: 'sub mono' }, r.code)) },
            { label: 'Factor', align: 'right', render: (r) => `${smart(r.leadValue)} ${r.leadUnit}` },
            { label: 'Leegrit', render: (r) => (r.emptyReturn ? 'inbegrepen' : 'niet inbegrepen') },
            { label: 'Geldig vanaf', render: (r) => date(r.validFrom) },
            { label: 'Bron', render: (r) => span({ class: 'small muted' }, r.source) },
          ],
          report.masterData.transportProfiles,
          { compact: true },
        )
      : null,
    report.masterData.energyFactors.length
      ? dataTable(
          [
            { label: 'Energiefactor', render: (r) => div({}, strong({}, r.name), span({ class: 'sub mono' }, r.code)) },
            { label: 'Factor', align: 'right', render: (r) => `${smart(r.leadValue)} ${r.leadUnit}` },
            { label: 'Geldig vanaf', render: (r) => date(r.validFrom) },
            { label: 'Bron', render: (r) => span({ class: 'small muted' }, r.source) },
          ],
          report.masterData.energyFactors,
          { compact: true },
        )
      : null,
    report.masterData.categoryRules.length
      ? dataTable(
          [
            { label: 'Categorie', render: (r) => strong({}, r.category) },
            { label: 'Verplichte modules', render: (r) => span({ class: 'mono' }, r.required_modules) },
            { label: 'Grondslag', render: (r) => span({ class: 'small muted' }, r.source) },
          ],
          report.masterData.categoryRules,
          { compact: true },
        )
      : null,

    /* --- validity --------------------------------------------------- */
    h2({}, 'Geldigheid'),
    note(
      report.validity.verdict === 'VALID' ? 'ok' : report.validity.verdict === 'INVALID' ? 'bad' : 'warn',
      strong({}, `${report.validity.verdictLabel}. `),
      report.validity.verdictDescription,
    ),
    p({ class: 'small' }, report.validity.rule),
    report.validity.reasons.length
      ? dataTable(
          [
            { label: 'Bevinding', render: (r) => span({ class: 'small' }, r.message) },
            { label: 'Ernst', render: (r) => verdictBadge(r.verdict) },
            { label: 'Code', render: (r) => span({ class: 'mono tiny' }, r.code) },
          ],
          report.validity.reasons,
          { compact: true },
        )
      : p({ class: 'small muted' }, 'Geen bevindingen.'),

    /* --- change control ---------------------------------------------- */
    report.changeControl
      ? [
          h2({}, 'Wijzigingscontrole'),
          p({ class: 'small' }, report.changeControl.summary),
          dataTable(
            [
              { label: 'Toets', render: (r) => span({ class: 'small' }, r.message) },
              { label: 'Resultaat', render: (r) => badge(r.passed ? 'voldaan' : 'niet voldaan', r.passed ? 'ok' : 'bad') },
            ],
            report.changeControl.checks ?? [],
            { compact: true },
          ),
        ]
      : null,

    /* --- audit -------------------------------------------------------- */
    h2({}, 'Audittrail'),
    dataTable(
      [
        { label: 'Wanneer', render: (r) => dateTime(r.ts) },
        { label: 'Wie', render: (r) => r.actor_label },
        { label: 'Wat', render: (r) => span({ class: 'small' }, r.summary) },
      ],
      report.audit,
      { compact: true, emptyText: 'Geen registraties.' },
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
