/**
 * A recipe version: composition, parameters, the calculation and its verdict.
 *
 * This is the screen the whole platform is judged on. It has to answer three
 * questions without anyone having to ask: what does this concrete score, is
 * that number usable, and where does every part of it come from.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount, formData } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  card, dataTable, kv, stat, badge, verdictBadge, statusBadge, evidenceBadge, note, pageHead,
  toast, modal, formModal, moduleBar, traceView, gatePanel, tabs, textField, textAreaField,
  selectField, checkField, ref, empty,
} from '../lib/ui.js';
import { smart, date, pct } from '../lib/format.js';

const { div, span, strong, a, button, form, p, small, input, label } = tags;

export async function render(outlet, { params, setTitle, navigate }) {
  let scope = 'A1-A3';
  let activeTab = 'trace';

  const host = div();

  const load = async () => {
    mount(host, div({ class: 'empty' }, 'Bezig met rekenen…'));
    const data = await api.get(`/recipe-versions/${params.id}${qs({ scope })}`);
    const gate = await api.get(`/recipe-versions/${params.id}/change-check`).then((r) => r.gate).catch(() => null);
    draw(data, gate);
  };

  const draw = (data, gate) => {
    const { recipe, version, components, parameters, result, declaration } = data;
    const isOwner = recipe.org_id === state.user.orgId;
    const unit = result.lead.unit;

    setTitle(`${recipe.code} v${version.version_no}`, recipe.name);

    mount(
      host,
      pageHead(
        `${recipe.code} · v${version.version_no}`,
        `${recipe.name} — geldig vanaf ${date(version.effective_from)}${version.effective_to ? ` tot ${date(version.effective_to)}` : ''}.`,
        [
          a({ href: `#/recipes/${recipe.id}`, class: 'btn btn--ghost' }, '← Alle versies'),
          button({ class: 'btn', onClick: () => openReport(params.id, scope) }, 'Transparantierapport'),
          isOwner && version.status === 'DRAFT' && can('recipes:write')
            ? button({ class: 'btn', onClick: () => activate(version.id, load) }, 'In productie nemen')
            : null,
          isOwner && !declaration && can('declarations:submit')
            ? button({ class: 'btn btn--accent', onClick: () => submit(version.id, navigate) }, 'Indienen als declaratie')
            : null,
        ].filter(Boolean),
      ),

      verdictBanner(result),

      div(
        { class: 'grid grid--4 mb-2' },
        stat({
          label: 'GWP-totaal',
          value: smart(result.totals.GWP_TOTAL),
          unit,
          note: `per ${result.functionalUnit}`,
          tone: result.verdict === 'VALID' ? 'ok' : result.verdict === 'INVALID' ? 'bad' : 'warn',
        }),
        stat({ label: 'Oordeel', value: ref().verdicts?.[result.verdict]?.label ?? result.verdict, note: 'volgens de ketenregel' }),
        stat({ label: 'Status versie', value: statusLabel(version.status), note: declaration ? `declaratie: ${ref().declarationStatusLabels?.[declaration.status] ?? declaration.status}` : 'nog niet ingediend' }),
        stat({ label: 'Grondstoffen', value: String(components.length), note: `${smart(components.reduce((s, c) => s + c.quantity_kg, 0))} kg/m³` }),
      ),

      div(
        { class: 'grid grid--side' },
        div(
          {},
          card(
            'Verdeling over de levenscyclusmodules',
            div(
              {},
              moduleBar(result.lead.byModule, result.modules, unit),
              div(
                { class: 'toolbar mt-2', style: { marginBottom: 0 } },
                label({ class: 'small muted' }, 'Bereik:'),
                ...['A1-A3', 'A1-A5'].map((option) =>
                  button(
                    {
                      class: `btn btn--small ${scope === option ? 'btn--primary' : ''}`,
                      onClick: async () => {
                        scope = option;
                        await load();
                      },
                    },
                    option,
                  ),
                ),
                scope === 'A1-A5'
                  ? small({ class: 'muted' }, 'A4 en A5 horen bij een concrete levering; hier tonen we ze met sectorwaarden.')
                  : null,
              ),
            ),
          ),

          tabs(
            [
              { key: 'trace', label: 'Berekening' },
              { key: 'composition', label: 'Samenstelling' },
              { key: 'parameters', label: 'Procesparameters' },
              { key: 'indicators', label: 'Alle indicatoren' },
            ],
            activeTab,
            (key) => {
              activeTab = key;
              draw(data, gate);
            },
          ),

          activeTab === 'trace'
            ? card(
                'Elke term, met formule en bron',
                traceView(
                  {
                    modules: (ref().modules ?? [])
                      .filter((m) => result.modules.includes(m.code))
                      .map((m) => ({ ...m, lines: result.trace.filter((l) => l.module === m.code), subtotal: result.byModule[m.code]?.GWP_TOTAL ?? 0 })),
                  },
                  unit,
                ),
                {
                  flush: true,
                  hint: 'De volledige verklaring van het getal hierboven: hoeveelheid, factor, herkomst van die factor en het bewijsstuk erachter.',
                },
              )
            : null,

          activeTab === 'composition' ? compositionCard(components, result) : null,
          activeTab === 'parameters' ? parametersCard(parameters, data.parameterDefs) : null,
          activeTab === 'indicators' ? indicatorCard(result) : null,
        ),

        div(
          {},
          gate ? gateCard(gate) : null,
          version.change_reason
            ? card('Reden van deze versie', p({ class: 'small' }, version.change_reason))
            : null,
          card(
            'Herkomst van de cijfers',
            div(
              {},
              p({ class: 'small muted' }, 'Deze berekening gebruikt de masterdata die gold op de referentiedatum, niet noodzakelijk de nieuwste.'),
              kv([
                ['Referentiedatum', date(result.referenceDate)],
                ['Rekenmotor', span({ class: 'mono' }, `v${result.engineVersion}`)],
                ['Norm', 'EN 15804+A2'],
                ['Functionele eenheid', result.functionalUnit],
              ]),
              p({ class: 'mt-2' }, a({ href: '#/reference' }, 'Rekenregels en factoren bekijken →')),
            ),
          ),
        ),
      ),
    );
  };

  mount(outlet, host);
  await load();
}

/* ------------------------------------------------------------------ */

function verdictBanner(result) {
  const blocking = result.reasons.filter((r) => r.verdict === 'INVALID');
  const warnings = result.reasons.filter((r) => r.verdict !== 'INVALID' && r.verdict !== 'VALID');

  if (result.verdict === 'VALID') {
    return note('ok', strong({}, 'Volledig gedekt. '), 'Elke grondstof in deze samenstelling steunt op een geldige BEPD. Dit resultaat kan als productdeclaratie gepubliceerd worden.');
  }

  return div(
    {},
    note(
      result.verdict === 'INVALID' ? 'bad' : 'warn',
      strong({}, `${ref().verdicts?.[result.verdict]?.label ?? result.verdict}. `),
      ref().verdicts?.[result.verdict]?.description ?? '',
    ),
    (blocking.length ? blocking : warnings).length
      ? card(
          'Waarom',
          div({}, [...blocking, ...warnings].map((r) => note(r.verdict === 'INVALID' ? 'bad' : 'warn', r.message))),
          { flush: false },
        )
      : null,
  );
}

function compositionCard(components, result) {
  const summaries = Object.fromEntries((result.components ?? []).map((c) => [c.componentId, c]));

  return card(
    'Samenstelling per m³',
    dataTable(
      [
        { label: 'Grondstof', render: (c) => div({}, strong({}, c.material_name), span({ class: 'sub' }, `${c.supplier_name} · ${c.material_code}`)) },
        { label: 'Categorie', render: (c) => span({ class: 'small muted' }, categoryLabel(c.category)) },
        { label: 'Dosering', align: 'right', render: (c) => `${smart(c.quantity_kg)} kg` },
        {
          label: 'Aanvoer',
          align: 'right',
          render: (c) => (c.transport_km ? div({}, `${smart(c.transport_km)} km`, span({ class: 'sub' }, summaries[c.id]?.transportProfile ?? '')) : span({ class: 'muted' }, '—')),
        },
        { label: 'Bewijsstuk', render: (c) => evidenceBadge(summaries[c.id]?.evidence?.type) },
        {
          label: 'Nummer',
          render: (c) => span({ class: 'mono tiny' }, summaries[c.id]?.evidence?.number ?? '—'),
        },
        {
          label: 'Bijdrage',
          align: 'right',
          render: (c) => div({}, strong({}, smart(summaries[c.id]?.contribution?.GWP_TOTAL ?? 0)), span({ class: 'sub' }, share(summaries[c.id], result))),
        },
      ],
      components,
      { compact: true },
    ),
    { flush: true, hint: 'De bijdrage bevat de volledige wieg-tot-poort van de leverancier plus de aanvoer naar deze centrale.' },
  );
}

function share(summary, result) {
  const total = result.totals.GWP_TOTAL || 1;
  const value = summary?.contribution?.GWP_TOTAL ?? 0;
  return `${((value / total) * 100).toFixed(1).replace('.', ',')} %`;
}

function parametersCard(parameters, defs) {
  const byCode = Object.fromEntries(parameters.map((p) => [p.code, p]));
  const rows = (defs ?? []).map((def) => ({ def, param: byCode[def.code] }));

  return card(
    'Procesparameters van de centrale',
    div(
      {},
      note(
        'info',
        'Elke parameter valt standaard terug op de generieke sectorwaarde. Wie een eigen gemeten waarde invult, moet die kunnen aantonen — dit is precies wat de externe verificateur controleert.',
      ),
      dataTable(
        [
          { label: 'Parameter', render: (r) => div({}, strong({}, r.def.label), span({ class: 'sub mono' }, r.def.code)) },
          { label: 'Module', render: (r) => badge(r.def.module, 'info') },
          { label: 'Waarde', align: 'right', render: (r) => (r.param ? `${smart(r.param.value)} ${r.param.unit}` : span({ class: 'muted' }, 'niet ingevuld')) },
          { label: 'Herkomst', render: (r) => (r.param?.overridden ? badge('Eigen meting', 'warn') : badge('Sectorwaarde', 'muted')) },
          { label: 'Verantwoording', render: (r) => span({ class: 'small muted' }, r.param?.justification ?? (r.param?.overridden ? '— ontbreekt —' : '')) },
        ],
        rows,
        { compact: true },
      ),
    ),
    { flush: false },
  );
}

function indicatorCard(result) {
  const indicators = ref().indicators ?? [];
  const rows = indicators.map((indicator) => ({
    indicator,
    total: result.totals[indicator.code] ?? 0,
    modules: Object.fromEntries(result.modules.map((m) => [m, result.byModule[m]?.[indicator.code] ?? 0])),
  }));

  return card(
    'Alle milieu-indicatoren',
    dataTable(
      [
        { label: 'Indicator', render: (r) => div({}, strong({}, r.indicator.short), span({ class: 'sub' }, r.indicator.label)) },
        { label: 'Eenheid', render: (r) => span({ class: 'small muted' }, r.indicator.unit) },
        ...result.modules.map((m) => ({ label: m, align: 'right', render: (r) => smart(r.modules[m]) })),
        { label: 'Totaal', align: 'right', render: (r) => strong({}, smart(r.total)) },
      ],
      rows,
      { compact: true },
    ),
    { flush: true, hint: 'De volledige kernset van EN 15804+A2, per m³.' },
  );
}

function gateCard(gate) {
  const auto = gate.decision === 'AUTO_ACCEPT';
  return card(
    'Wijzigingscontrole',
    gatePanel({
      decision: auto ? 'GO' : 'GO_WITH_WARNING',
      title: auto ? 'Geen nieuwe verificatie nodig' : 'Externe verificatie vereist',
      subtitle:
        gate.previousValue !== null
          ? `${smart(gate.previousValue)} → ${smart(gate.newValue)} kg CO₂ eq./m³ (${pct(gate.deviationPct, 2)})`
          : 'Er is nog geen eerdere declaratie om mee te vergelijken.',
      checks: gate.checks,
    }),
    {
      flush: true,
      hint: `Marges: ${gate.thresholds.tolerancePct} % per wijziging, ${gate.thresholds.cumulativePct} % opgeteld, max. ${gate.thresholds.maxConsecutive} opeenvolgende.`,
    },
  );
}

/* ------------------------------------------------------------------ */

async function activate(versionId, reload) {
  try {
    await api.post(`/recipe-versions/${versionId}/activate`, {});
    toast('Versie in productie genomen.', 'ok');
    await reload();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function submit(versionId, navigate) {
  const { organisations } = await api.get('/organisations');
  const verifiers = organisations.filter((o) => o.type === 'VERIFIER');

  formModal({
    title: 'Indienen als declaratie',
    hint: 'Het systeem controleert eerst of deze wijziging binnen de afgesproken marge blijft. Zo ja, dan erft ze de bestaande verificatie en hoeft er niets extern gecontroleerd te worden.',
    fields: [
      selectField('scope', 'Bereik', [
        { value: 'A1-A3', label: 'A1–A3 — tot aan de poort van de centrale' },
        { value: 'A1-A5', label: 'A1–A5 — inclusief werf (enkel zinvol per project)' },
      ], { value: 'A1-A3', required: true, placeholder: false }),
      selectField('verifierOrgId', 'Verificatie-instelling', verifiers.map((v) => ({ value: v.id, label: v.name })), {
        placeholder: '— eerste beschikbare —',
      }),
      note('muted', 'De berekening wordt bij indiening vastgelegd. Wat de verificateur ondertekent, kan daarna niet meer stilzwijgend veranderen doordat masterdata bijgewerkt wordt.'),
    ],
    submitLabel: 'Indienen',
    onSubmit: async (values, close) => {
      const response = await api.post('/declarations', { recipeVersionId: versionId, ...values });
      close();
      toast(
        response.gate.decision === 'AUTO_ACCEPT'
          ? `Automatisch aanvaard binnen de marge (${pct(response.gate.deviationPct, 2)}).`
          : 'Ingediend voor externe verificatie.',
        'ok',
      );
      navigate(`/declarations/${response.declaration.id}`);
    },
  });
}

async function openReport(versionId, scope) {
  const { report } = await api.get(`/recipe-versions/${versionId}/report${qs({ scope })}`);
  const { renderReport } = await import('./report.js');
  modal({
    title: 'Transparantierapport',
    hint: 'Alles wat een verificateur of de overheid moet kunnen nalezen, in één document.',
    wide: true,
    body: renderReport(report),
    actions: (close) => [
      button({ class: 'btn', onClick: () => window.print() }, 'Afdrukken'),
      button({ class: 'btn btn--primary', onClick: close }, 'Sluiten'),
    ],
  });
}

function statusLabel(status) {
  return { ACTIVE: 'In productie', DRAFT: 'Ontwerp', SUPERSEDED: 'Vervangen', ARCHIVED: 'Gearchiveerd' }[status] ?? status;
}

function categoryLabel(code) {
  return ref().materialCategories?.find((c) => c.code === code)?.label ?? code;
}
