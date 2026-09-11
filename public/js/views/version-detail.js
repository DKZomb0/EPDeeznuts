/**
 * Het rekenblad A1–A3.
 *
 * Dit is het scherm waar het platform op beoordeeld wordt. Het moet drie vragen
 * beantwoorden zonder dat iemand ze hoeft te stellen: wat scoort dit beton, is
 * dat getal bruikbaar, en waar komt elk stuk ervan vandaan.
 *
 * De doseringen zijn hier bewerkbaar en het resultaat rekent mee terwijl je
 * typt. Die voorbeeldberekening loopt door dezelfde motor als een ingediende
 * versie; opslaan gebeurt pas bij "nieuwe versie", met een verplichte reden.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  panel, card, banner, dataTable, tablePanel, kv, tag, verdictTag, statusTag, evidenceTag,
  pageHead, toast, modal, formModal, figure, barLines, traceView, checklist, seg, btn,
  textField, textAreaField, selectField, pickRow, logList, empty, ref, icon, smart, date, pct,
} from '../lib/ui.js';

const { div, span, strong, p, small, input, label } = tags;

export async function render(outlet, { params, setTitle, navigate }) {
  const data = await api.get(`/recipe-versions/${params.id}`);
  const { recipe, version, components, parameters, declaration } = data;
  const isOwner = recipe.org_id === state.user.orgId;
  const editable = isOwner && can('recipes:write');

  setTitle(`Rekenblad ${recipe.code}`);

  /* ---------------- bewerkbare staat ---------------- */

  const draft = {
    components: components.map((c) => ({
      key: c.id,
      materialId: c.material_id,
      name: c.material_name,
      supplier: c.supplier_name,
      category: c.category,
      quantityKg: c.quantity_kg,
      transportKm: c.transport_km,
      transportProfileId: c.transport_profile_id,
    })),
    parameters: parameters.map((p) => ({
      code: p.code,
      value: p.value,
      unit: p.unit,
      overridden: !!p.overridden,
      justification: p.justification ?? '',
    })),
    scope: 'A1-A3',
  };

  const baseline = JSON.stringify(snapshot(draft));
  const isDirty = () => JSON.stringify(snapshot(draft)) !== baseline;

  /* ---------------- catalogus voor de bronkeuze ---------------- */

  const { materials } = await api.get('/materials');
  const byCategory = (category) => materials.filter((m) => m.category === category);

  /* ---------------- levende delen van het scherm ---------------- */

  const lineCells = new Map(); // key -> { a1, a2, tagHost }
  const resultHost = div();
  const validityHost = div();
  const bandHost = div();
  const traceHost = div();
  const actionHost = div({ class: 'pagehead__actions' });
  const dirtyHost = div();

  let latest = null;
  let timer = null;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(recalc, 350);
  };

  async function recalc() {
    try {
      const { result } = await api.post('/calculate', {
        recipeId: recipe.id,
        scope: draft.scope,
        components: draft.components.map((c) => ({
          materialId: c.materialId,
          quantityKg: Number(c.quantityKg) || 0,
          transportKm: Number(c.transportKm) || 0,
          transportProfileId: c.transportProfileId,
        })),
        parameters: draft.parameters,
      });
      latest = result;
      paint(result);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function paint(result) {
    const unit = result.lead.unit;

    // De client rekent zelf niets uit: de per-module bijdrage komt uit de motor,
    // zodat wat op het scherm staat exact is wat in het dossier belandt.
    for (const [key, cells] of lineCells) {
      const component = draft.components.find((c) => c.key === key);
      const summary = result.components?.find((s) => s.materialId === component.materialId);
      mount(cells.a1, smart(summary?.byModule?.A1?.GWP_TOTAL ?? 0));
      mount(cells.a2, smart(summary?.byModule?.A2?.GWP_TOTAL ?? 0));
      mount(cells.tagHost, evidenceTag(summary?.evidence?.type ?? null));
    }

    mount(
      resultHost,
      panel({
        kicker: `Resultaat ${result.scope}`,
        body: div(
          {},
          figure(smart(result.totals.GWP_TOTAL), unit),
          div(
            { class: 'mt-2' },
            barLines(
              result.modules.map((m) => ({ label: MODULE_LABELS[m] ?? m, value: result.byModule[m]?.GWP_TOTAL ?? 0 })),
              { unit },
            ),
          ),
          div(
            { class: 'flex mt-3', style: { justifyContent: 'space-between' } },
            seg(
              [
                { key: 'A1-A3', label: 'A1–A3' },
                { key: 'A1-A5', label: 'A1–A5' },
              ],
              draft.scope,
              (key) => {
                draft.scope = key;
                recalc();
              },
            ),
            small({ class: 'muted' }, `per ${result.functionalUnit}`),
          ),
        ),
      }),
    );

    mount(validityHost, validityBanner(result));
    mount(bandHost, bandPanel(result, declaration));
    mount(
      traceHost,
      panel({
        title: 'Berekening, term per term',
        sub: 'Hoeveelheid, factor, herkomst van die factor en het bewijsstuk erachter — dit is wat de administratie transparant noemt.',
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
      }),
    );

    paintActions(result);
  }

  function paintActions(result) {
    const dirty = isDirty();

    mount(
      dirtyHost,
      dirty
        ? banner('warn', {
            icon: 'info',
            title: 'Niet-bewaarde wijzigingen',
            body: 'Het resultaat hiernaast is een voorbeeldberekening. Bewaar de wijziging als nieuwe versie om ze te laten gelden — met een reden, want die leest de verificateur.',
          })
        : null,
    );

    const submit = submitState(result, declaration);

    mount(
      actionHost,
      btn('Transparantierapport', { variant: 'secondary', icon: 'fileText', onClick: () => openReport(params.id, draft.scope) }),
      editable && dirty
        ? btn('Bewaren als nieuwe versie', { variant: 'primary', icon: 'check', onClick: () => saveVersion(recipe, draft, navigate) })
        : null,
      editable && !dirty && version.status === 'DRAFT'
        ? btn('In productie nemen', { variant: 'secondary', icon: 'lightning', onClick: () => activate(version.id) })
        : null,
      editable && !dirty && !declaration
        ? btn(submit.label, { variant: 'primary', icon: submit.icon, disabled: submit.disabled, onClick: () => openSubmit(version.id, navigate) })
        : null,
    );
  }

  /* ---------------- statisch geraamte ---------------- */

  const compositionRows = draft.components.map((component) => {
    const a1 = span({ class: 'tnum' }, '—');
    const a2 = span({ class: 'tnum' }, '—');
    const tagHost = span({});
    const nameHost = div({});
    const paintName = () =>
      mount(nameHost, div({ class: 'strong' }, component.name), div({ class: 'sub' }, component.supplier));
    paintName();
    lineCells.set(component.key, { a1, a2, tagHost, paintName });

    const kgInput = input({
      class: 'input input-inline',
      type: 'number',
      step: '0.1',
      min: '0',
      value: component.quantityKg,
      disabled: !editable,
    });
    kgInput.addEventListener('input', () => {
      component.quantityKg = kgInput.value;
      schedule();
    });

    const kmInput = input({
      class: 'input input-inline',
      type: 'number',
      step: '1',
      min: '0',
      value: component.transportKm,
      disabled: !editable,
    });
    kmInput.addEventListener('input', () => {
      component.transportKm = kmInput.value;
      schedule();
    });

    return { component, kgInput, kmInput, a1, a2, tagHost, nameHost };
  });

  const compositionTable = tablePanel(
    [
      { label: 'Grondstof', render: (r) => r.nameHost },
      { label: 'kg / m³', align: 'right', width: '92px', render: (r) => r.kgInput },
      { label: 'Afstand km', align: 'right', width: '92px', render: (r) => r.kmInput },
      { label: 'A1', align: 'right', render: (r) => r.a1 },
      { label: 'A2', align: 'right', render: (r) => r.a2 },
      { label: 'Bron', render: (r) => r.tagHost },
    ],
    compositionRows,
  );

  /* Bronkeuze voor het bindmiddel — de demonstratie van de ketenregel. */
  const cementComponent = draft.components.find((c) => c.category === 'CEMENT');
  const sourcePanel = cementComponent
    ? panel({
        title: 'Cement — bron',
        sub: 'Enkel leveranciers waarvoor u inzage kreeg. De gekozen bron bepaalt of het eindresultaat geldig is.',
        body: div(
          { class: 'flex-col', style: { gap: '5.6px' } },
          byCategory('CEMENT').map((material) =>
            pickRow({
              name: 'cementbron',
              value: material.id,
              active: material.id === cementComponent.materialId,
              title: material.name,
              meta: [material.supplier_name, material.evidence?.number, material.site_name].filter(Boolean).join(' · '),
              right: material.restricted ? 'geen inzage' : `${smart(gwpOf(material))} kg/t`,
              tagEl: evidenceTag(material.evidence_type),
              onPick: () => {
                if (material.restricted) {
                  toast('U hebt nog geen inzage in de gegevens van deze leverancier.', 'bad');
                  recalc();
                  return;
                }
                cementComponent.materialId = material.id;
                cementComponent.name = material.name;
                cementComponent.supplier = material.supplier_name;
                lineCells.get(cementComponent.key)?.paintName();
                recalc();
              },
            }),
          ),
        ),
      })
    : null;

  /* A3 — sectorwaarde of eigen meting. */
  const energyPanel = buildEnergyPanel(draft, editable, recalc);

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        crumb: [{ label: 'Recepturen', onClick: () => navigate(`/recipes/${recipe.id}`) }, { label: `${recipe.code} · v${version.version_no}` }],
        title: 'Rekenblad A1 – A3',
        lede: `${recipe.strength_class ?? ''} · omgevingsklasse ${recipe.exposure_classes ?? '—'} · per m³ · geldig vanaf ${date(version.effective_from)}${version.effective_to ? ` tot ${date(version.effective_to)}` : ''}`,
        actions: actionHost,
      }),
      dirtyHost,
      div(
        { class: 'grid grid--wide' },
        div({ class: 'stack--tight', style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, compositionTable, sourcePanel, energyPanel),
        div({ class: 'stack--tight', style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, resultHost, validityHost, bandHost, changeLogPanel(version, declaration)),
      ),
      traceHost,
    ),
  );

  await recalc();
}

/* ------------------------------------------------------------------ */
/* Onderdelen                                                          */
/* ------------------------------------------------------------------ */

const MODULE_LABELS = {
  A1: 'A1 grondstoffen',
  A2: 'A2 aanvoer',
  A3: 'A3 productie',
  A4: 'A4 naar de werf',
  A5: 'A5 op de werf',
};

function validityBanner(result) {
  const meta = ref().verdicts?.[result.verdict];
  const blocking = result.reasons.filter((r) => r.verdict === 'INVALID');
  const flags = result.reasons.filter((r) => r.verdict === 'VALID_WITH_WARNINGS' || r.verdict === 'INDICATIVE');

  if (result.verdict === 'VALID') {
    return banner('accent', {
      icon: 'checkCircle',
      title: 'Alle inputs geverifieerd',
      body: `${result.components?.length ?? 0} van ${result.components?.length ?? 0} grondstoffen dragen een geldige BEPD. Het rekenblad kan als BEPD A1–A3 vrijgegeven worden.`,
    });
  }

  const tone = result.verdict === 'INVALID' ? 'neutral' : 'warn';
  const first = (blocking[0] ?? flags[0])?.message ?? meta?.description ?? '';

  return banner(tone, {
    icon: result.verdict === 'INVALID' ? 'prohibit' : 'warning',
    title: meta?.label ?? result.verdict,
    body: div(
      {},
      p({ style: { margin: 0 } }, first),
      (blocking.length + flags.length > 1)
        ? p({ class: 'tiny', style: { margin: '5.6px 0 0', opacity: 0.85 } }, `${blocking.length + flags.length} bevindingen in totaal — zie het transparantierapport.`)
        : null,
    ),
  });
}

function bandPanel(result, declaration) {
  const settings = ref().settings ?? {};
  const tolerance = Number(settings.bypass_tolerance_pct ?? 3);

  let declared = null;
  try {
    declared = declaration?.result_json ? JSON.parse(declaration.result_json).totals?.GWP_TOTAL ?? null : null;
  } catch {
    declared = null;
  }

  if (declared === null) {
    return panel({
      kicker: 'Bandbreedte',
      body: div(
        {},
        div({ class: 'panel__title' }, 'Nog geen geverifieerd ijkpunt'),
        p({ class: 'small dim', style: { margin: '2.8px 0 0' } }, `De eerste versie van een receptuur gaat altijd door de externe verificatie. Daarna loopt een afwijking tot ±${tolerance}% automatisch door.`),
      ),
    });
  }

  const delta = ((result.totals.GWP_TOTAL - declared) / declared) * 100;
  const within = Math.abs(delta) <= tolerance;

  return panel({
    kicker: 'Bandbreedte',
    body: div(
      {},
      div({ class: 'panel__title' }, `${pct(delta, 1)} — ${within ? 'binnen bandbreedte' : 'buiten bandbreedte'}`),
      p(
        { class: 'small dim', style: { margin: '2.8px 0 0' } },
        `Laatst geverifieerd ${smart(declared)} kg CO₂e/m³${declaration.certificate_no ? ` — dossier ${declaration.certificate_no}` : ''}. `,
        `Afwijking tot ±${tolerance}% loopt automatisch door; daarboven gaat het dossier naar het controlebureau.`,
      ),
    ),
  });
}

function changeLogPanel(version, declaration) {
  const entries = [];
  if (version.change_reason) entries.push({ ts: version.created_at, actor_label: 'Wijziging', summary: version.change_reason });
  if (declaration?.submitted_at) {
    entries.push({
      ts: declaration.submitted_at,
      actor_label: 'Ingediend',
      summary: declaration.certificate_no ? `Dossier ${declaration.certificate_no}` : `Bereik ${declaration.scope} — nog geen certificaatnummer toegekend`,
    });
  }
  if (declaration?.verified_at) entries.push({ ts: declaration.verified_at, actor_label: 'Geverifieerd', summary: declaration.decision_note ?? 'Goedgekeurd door het controlebureau.' });

  return panel({
    kicker: 'Wijzigingslog',
    body: entries.length ? logList(entries) : div({ class: 'muted small' }, 'Geen registraties op deze versie.'),
  });
}

/**
 * A3 — de sectorwaarde of een eigen meting. De verantwoordingsnota is verplicht
 * zodra men afwijkt; dat is precies wat de verificateur naderhand toetst.
 */
function buildEnergyPanel(draft, editable, recalc) {
  const def = (ref().parameterDefs ?? []).find((p) => p.code === 'PLANT_ELECTRICITY');
  const param = draft.parameters.find((p) => p.code === 'PLANT_ELECTRICITY');
  if (!param) return null;

  const sectorDefault = Number((ref().processDefaults ?? []).find((p) => p.code === 'PLANT_ELECTRICITY')?.value ?? 2.5);
  const host = div({ class: 'flex-col' });

  const draw = () => {
    const valueInput = input({
      class: 'input',
      type: 'number',
      step: '0.1',
      min: '0',
      value: param.value,
      disabled: !editable || !param.overridden,
      style: { fontVariantNumeric: 'tabular-nums' },
    });
    valueInput.addEventListener('input', () => {
      param.value = valueInput.value;
      recalc();
    });

    const noteInput = input({
      class: 'input',
      type: 'text',
      value: param.justification ?? '',
      placeholder: 'bv. meetrapport EnergieAudit 2026-114, ijking menger 3',
      disabled: !editable,
    });
    noteInput.addEventListener('input', () => {
      param.justification = noteInput.value;
    });

    mount(
      host,
      div(
        { class: 'flex wrap', style: { alignItems: 'flex-end' } },
        div(
          { class: 'grow' },
          div({ class: 'panel__kicker' }, 'A3 — verwerking op eigen site'),
          div({ class: 'panel__title' }, def?.label ?? 'Elektriciteit menginstallatie'),
        ),
        editable
          ? seg(
              [
                { key: 'sector', label: 'Sectorwaarde' },
                { key: 'eigen', label: 'Eigen waarde' },
              ],
              param.overridden ? 'eigen' : 'sector',
              (key) => {
                param.overridden = key === 'eigen';
                if (!param.overridden) {
                  param.value = sectorDefault;
                  param.justification = '';
                }
                draw();
                recalc();
              },
            )
          : tag(param.overridden ? 'Eigen waarde' : 'Sectorwaarde', param.overridden ? 'tag-outline' : 'tag-quiet'),
      ),
      div(
        { class: 'flex wrap', style: { alignItems: 'flex-end', gap: '16.8px' } },
        div({ class: 'field', style: { width: '150px', flex: 'none' } }, label({}, def?.unit ?? 'kWh / m³'), valueInput),
        div(
          { class: 'small dim', style: { maxWidth: '48ch', paddingBottom: '6px' } },
          param.overridden
            ? `U wijkt af van de sectorwaarde (${smart(sectorDefault)} ${def?.unit ?? ''}). Een eigen waarde mag, maar wordt bij elke verificatie opgevraagd en getoetst aan uw meetrapport.`
            : `Sectorwaarde ${smart(sectorDefault)} ${def?.unit ?? ''}, vastgesteld op basis van de aangesloten centrales. Volstaat voor wie niet elke menger wil meten.`,
        ),
      ),
      param.overridden
        ? div(
            { class: 'field' },
            label({}, 'Verantwoordingsnota — verplicht bij afwijking van de sectorwaarde'),
            noteInput,
            div({ class: 'flex field__hint' }, icon('paperclip', { size: 13 }), span({}, 'Gaat mee naar het verificatiedossier.')),
          )
        : null,
    );
  };

  draw();
  return panel({ body: host });
}

/* ------------------------------------------------------------------ */
/* Acties                                                              */
/* ------------------------------------------------------------------ */

function submitState(result, declaration) {
  const settings = ref().settings ?? {};
  if (declaration) return { label: 'Reeds ingediend', icon: 'check', disabled: true };
  if (result.verdict === 'INVALID') return { label: 'Vrijgeven niet mogelijk', icon: 'prohibit', disabled: true };
  if (result.verdict === 'VALID_WITH_WARNINGS' || result.verdict === 'INDICATIVE') {
    return { label: 'Verificatie aanvragen', icon: 'send', disabled: false };
  }
  return { label: 'Indienen', icon: 'send', disabled: false, tolerance: settings.bypass_tolerance_pct };
}

function snapshot(draft) {
  return {
    components: draft.components.map((c) => [c.materialId, Number(c.quantityKg) || 0, Number(c.transportKm) || 0, c.transportProfileId ?? null]),
    parameters: draft.parameters.map((p) => [p.code, Number(p.value) || 0, !!p.overridden, p.justification ?? '']),
  };
}

function saveVersion(recipe, draft, navigate) {
  formModal({
    title: 'Bewaren als nieuwe versie',
    hint: 'De lopende versie blijft gelden voor alles wat al geleverd is. Het systeem toont meteen of deze wijziging een externe verificatie nodig heeft.',
    fields: [
      textAreaField('changeReason', 'Reden voor de wijziging', {
        required: true,
        placeholder: 'bv. "Cementdosering met 8 kg verlaagd na optimalisatie van de korrelopbouw."',
        hint: 'Verplicht. Dit is wat de verificateur leest en wat in de audittrail komt.',
      }),
      textField('effectiveFrom', 'Geldig vanaf', { type: 'date', hint: 'Leeg = vanaf vandaag.' }),
      checkboxField('activate', 'Meteen in productie nemen'),
    ],
    submitLabel: 'Versie aanmaken',
    submitIcon: 'check',
    onSubmit: async (values, close) => {
      const { version, gate } = await api.post(`/recipes/${recipe.id}/versions`, {
        changeReason: values.changeReason,
        effectiveFrom: values.effectiveFrom || null,
        activate: !!values.activate,
        components: draft.components.map((c) => ({
          materialId: c.materialId,
          quantityKg: Number(c.quantityKg) || 0,
          transportKm: Number(c.transportKm) || 0,
          transportProfileId: c.transportProfileId,
        })),
        parameters: draft.parameters,
      });
      close();
      showGateOutcome(gate, version, navigate);
    },
  });
}

function checkboxField(name, labelText) {
  return div(
    { class: 'field' },
    label({ class: 'flex', style: { cursor: 'pointer', fontSize: '13px' } }, input({ type: 'checkbox', name }), span({}, labelText)),
  );
}

/**
 * Meteen na het aanmaken zeggen of er een verificateur aan te pas komt. Dat is
 * een planningsfeit voor de producent, geen verrassing achteraf.
 */
function showGateOutcome(gate, version, navigate) {
  if (!gate) return navigate(`/versions/${version.id}`);
  const auto = gate.decision === 'AUTO_ACCEPT';

  modal({
    title: auto ? 'Binnen de bandbreedte' : 'Externe verificatie nodig',
    hint: gate.deviationPct !== null ? `Wijziging t.o.v. de vorige declaratie: ${pct(gate.deviationPct, 2)}` : undefined,
    body: div(
      { class: 'flex-col' },
      banner(auto ? 'accent' : 'warn', { icon: auto ? 'lightning' : 'send', body: gate.summary }),
      panel({ body: checklist(gate.checks ?? []) }),
      p({ class: 'small muted' }, 'De versie staat klaar. Ze wordt pas actief wanneer u ze in productie neemt.'),
    ),
    actions: (close) => [
      btn('Versie openen', {
        variant: 'primary',
        onClick: () => {
          close();
          navigate(`/versions/${version.id}`);
        },
      }),
    ],
  });
}

async function activate(versionId) {
  try {
    await api.post(`/recipe-versions/${versionId}/activate`, {});
    toast('Versie in productie genomen.', 'ok');
    location.reload();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

async function openSubmit(versionId, navigate) {
  const { organisations } = await api.get('/organisations');
  const verifiers = organisations.filter((o) => o.type === 'VERIFIER');

  formModal({
    title: 'Indienen als declaratie',
    hint: 'Het systeem controleert eerst of deze wijziging binnen de afgesproken bandbreedte blijft. Zo ja, dan erft ze de bestaande verificatie.',
    fields: [
      selectField('scope', 'Bereik', [
        { value: 'A1-A3', label: 'A1–A3 — tot aan de poort van de centrale' },
        { value: 'A1-A5', label: 'A1–A5 — inclusief werf (enkel zinvol per project)' },
      ], { value: 'A1-A3', required: true, placeholder: false }),
      selectField('verifierOrgId', 'Controlebureau', verifiers.map((v) => ({ value: v.id, label: v.name })), { placeholder: '— eerste beschikbare —' }),
      banner('plain', {
        icon: 'info',
        body: 'De berekening wordt bij indiening vastgelegd. Wat het controlebureau ondertekent, kan daarna niet meer stilzwijgend veranderen doordat masterdata bijgewerkt wordt.',
      }),
    ],
    submitLabel: 'Indienen',
    submitIcon: 'send',
    onSubmit: async (values, close) => {
      const response = await api.post('/declarations', { recipeVersionId: versionId, ...values });
      close();
      toast(
        response.gate.decision === 'AUTO_ACCEPT'
          ? `Automatisch aanvaard binnen de bandbreedte (${pct(response.gate.deviationPct, 2)}).`
          : 'Ingediend bij het controlebureau.',
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
    actions: (close) => [btn('Afdrukken', { variant: 'secondary', icon: 'printer', onClick: () => window.print() }), btn('Sluiten', { variant: 'primary', onClick: close })],
  });
}

function gwpOf(material) {
  if (!material.values) return 0;
  return ['A1', 'A2', 'A3'].reduce((sum, m) => sum + (material.values[m]?.GWP_TOTAL ?? 0), 0);
}
