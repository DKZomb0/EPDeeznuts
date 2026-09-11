/**
 * A4 – A5 per levering.
 *
 * De centrale kent de werf niet. Transport ernaartoe en de verwerking erop vult
 * de verantwoordelijke partij zelf in, en de log houdt bij wie dat deed.
 *
 * De bewoording van de controle is met zorg gekozen: ze zegt of de levering
 * gedekt is door een geldige declaratie. Ze houdt geen vrachtwagen tegen — de
 * producent blijft verantwoordelijk voor het beton dat hij levert, net als
 * vandaag. Daarom bestaat de manuele uitzondering, en wordt ze geregistreerd in
 * plaats van geblokkeerd.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  panel, card, tablePanel, banner, kv, tag, verdictTag, pageHead, toast, modal, formModal,
  figure, barLines, checklist, checkRow, btn, textField, textAreaField, logList, empty,
  ref, smart, date, dateTime, pct, icon, GATE_LABELS,
} from '../lib/ui.js';

const { div, span, strong, p, small, input, label } = tags;

export async function render(outlet, { params, setTitle, navigate }) {
  const host = div({ class: 'stack' });
  mount(outlet, host);

  const load = async () => {
    const data = await api.get(`/deliveries/${params.id}`);
    draw(data);
  };

  const draw = (data) => {
    const { delivery, parameters, parameterDefs, responsibilities, result, gates, audit } = data;
    const unit = result.lead.unit;
    setTitle(`Levering ${delivery.delivery_note ?? ''}`);

    const a5Owner = responsibilities.find((r) => r.module === 'A5');
    const a4Owner = responsibilities.find((r) => r.module === 'A4');
    const canEditA5 = a5Owner?.org_id === state.user.orgId && can('siteparams:write');
    const lastGate = gates[0];

    const stageRows = [
      { label: 'A1–A3 — BEPD van de centrale', value: ['A1', 'A2', 'A3'].reduce((s, m) => s + (result.byModule[m]?.GWP_TOTAL ?? 0), 0), owner: delivery.recipe_code },
      { label: 'A4 — transport naar de werf', value: result.byModule.A4?.GWP_TOTAL ?? 0, owner: a4Owner?.org_name ?? '—' },
      { label: 'A5 — verwerking op de werf', value: result.byModule.A5?.GWP_TOTAL ?? 0, owner: a5Owner?.org_name ?? '—' },
    ];

    mount(
      host,
      pageHead({
        crumb: [{ label: 'Projecten', onClick: () => navigate('/projects') }, { label: delivery.project_name, onClick: () => navigate(`/projects/${delivery.project_id}`) }, { label: delivery.delivery_note ?? 'Levering' }],
        title: 'A4 – A5 per levering',
        lede: `Levering ${delivery.delivery_note ?? ''} · ${delivery.project_name} · ${smart(delivery.volume_m3)} m³ ${delivery.recipe_code} · ${dateTime(delivery.delivered_at)}`,
        actions: [
          btn('Controle uitvoeren', { variant: 'primary', icon: 'shieldCheck', onClick: () => runGate(delivery.id, load) }),
          canEditA5 ? btn('Werfparameters invullen', { variant: 'secondary', icon: 'clipboard', onClick: () => editParameters(delivery, parameters, parameterDefs, load) }) : null,
        ].filter(Boolean),
      }),

      div(
        { class: 'grid grid--halves' },
        div(
          { class: 'flex-col', style: { gap: '16.8px', minWidth: 0 } },
          panel({
            title: `Levering ${delivery.delivery_note ?? ''}`,
            sub: `${delivery.project_name} · ${smart(delivery.volume_m3)} m³ ${delivery.recipe_code} · ${dateTime(delivery.delivered_at)}`,
            body: div(
              { class: 'flex-col', style: { gap: '14px' } },
              kv([
                ['Afstand centrale → werf', `${smart(delivery.distance_km)} km (enkele rit)`],
                ['Receptuurversie', `v${delivery.version_no}`],
                ['Sterkteklasse', delivery.strength_class ?? '—'],
                ['A4 ingevuld door', a4Owner?.org_name ?? 'niet toegewezen'],
                ['A5 ingevuld door', a5Owner?.org_name ?? 'niet toegewezen'],
              ]),

              div(
                {},
                div({ class: 'panel__kicker mb-1' }, 'A5 — verwerking op de werf'),
                parameters.length
                  ? div(
                      { class: 'flex-col', style: { gap: '5.6px' } },
                      parameters.map((p) =>
                        div(
                          { class: ['checkrow', p.value > 0 && 'is-active'] },
                          icon(p.value > 0 ? 'check' : 'minus', { size: 15, className: p.value > 0 ? '' : 'muted' }),
                          span({ class: 'grow' }, defLabel(p.code, parameterDefs)),
                          span({ class: 'small dim tnum' }, `${smart(p.value)} ${p.unit}`),
                          p.overridden ? tag('Eigen meting', 'tag-outline') : null,
                        ),
                      ),
                    )
                  : empty('Nog geen werfparameters', 'De verantwoordelijke partij heeft ze nog niet ingevuld.'),
                div({ class: 'field__hint mt-1' }, 'Verlies door restbeton en spoelwater wordt afgeleid uit de teruggevoerde kubage.'),
              ),
            ),
          }),

          lastGate ? gatePanel(lastGate, delivery) : panel({ kicker: 'Controle', body: empty('Nog geen controle uitgevoerd', 'Voer de controle uit om te zien of deze levering gedekt is door een geldige declaratie.') }),

          panel({ kicker: 'Audittrail', body: logList(audit, { limit: 12 }) }),
        ),

        div(
          { class: 'flex-col', style: { gap: '16.8px', minWidth: 0 } },
          panel({
            kicker: 'Totaal A1–A5',
            body: div(
              {},
              figure(smart(result.totals.GWP_TOTAL), unit),
              div(
                { class: 'mt-2' },
                tablePanel(
                  [
                    { label: '', wrap: true, render: (s) => s.label },
                    { label: '', align: 'right', render: (s) => span({ class: 'tnum' }, smart(s.value)) },
                    { label: '', muted: true, wrap: true, width: '40%', render: (s) => span({ class: 'small' }, s.owner) },
                  ],
                  stageRows,
                ),
              ),
              div(
                { class: 'flex-between mt-2' },
                small({ class: 'muted' }, `Volledige levering: ${smart((result.absolute ?? {}).GWP_TOTAL ?? result.totals.GWP_TOTAL * delivery.volume_m3)} kg CO₂e`),
                verdictTag(result.verdict),
              ),
            ),
          }),

          card({
            kicker: 'Doorstroom naar het E-peil',
            title: 'Ontwerp naast as-built',
            body: 'De architect rekende in ontwerpfase met de generieke sectorwaarde. Deze levering levert het as-built cijfer; het platform bewaart beide, met de datum waarop ze golden.',
          }),

          panel({
            kicker: 'Berekening',
            body: div({}, barLines(result.modules.map((m) => ({ label: m, value: result.byModule[m]?.GWP_TOTAL ?? 0 })), { unit })),
          }),
        ),
      ),
    );
  };

  await load();
}

/* ------------------------------------------------------------------ */

function gatePanel(gate, delivery) {
  const reasons = gate.reasons_json ? JSON.parse(gate.reasons_json) : [];
  const stop = gate.decision === 'NO_GO';
  const tone = gate.decision === 'GO' ? 'accent' : stop ? 'neutral' : 'warn';

  return panel({
    kicker: 'Controle',
    body: div(
      { class: 'flex-col' },
      banner(tone, {
        icon: gate.decision === 'GO' ? 'sealCheck' : stop ? 'prohibit' : 'warning',
        title: GATE_LABELS[gate.decision] ?? gate.decision,
        body: gate.deviation_pct !== null ? `Afwijking ${pct(gate.deviation_pct, 2)} · bandbreedte ±${gate.threshold_pct}% · ${dateTime(gate.created_at)}` : dateTime(gate.created_at),
      }),
      checklist(reasons),
      stop
        ? div(
            { class: 'flex-col' },
            p(
              { class: 'small dim' },
              strong({}, 'Wat dit betekent. '),
              'Deze levering kan niet gerapporteerd worden als gedekt door een geldige declaratie. Het is geen leveringsverbod: de betonproducent blijft, net als vandaag, verantwoordelijk voor het beton dat hij levert.',
            ),
            div({}, btn('Uitzondering vastleggen', { variant: 'danger', small: true, icon: 'warning', onClick: () => override(delivery.id) })),
          )
        : small({ class: 'muted' }, 'De controle draait op de gegevens zoals ze golden op de leveringsdatum, niet op de receptuur van vandaag.'),
    ),
  });
}

async function runGate(deliveryId, reload) {
  try {
    const outcome = await api.post(`/deliveries/${deliveryId}/gate`, {});
    toast(`Controle uitgevoerd: ${GATE_LABELS[outcome.decision] ?? outcome.decision}.`, outcome.decision === 'NO_GO' ? 'bad' : 'ok');
    await reload();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function override(deliveryId) {
  formModal({
    title: 'Uitzondering vastleggen',
    hint: 'Gebruik dit wanneer de controle niet afgerond kan worden maar de levering wel doorgaat. De uitzondering komt op uw naam en verschijnt op de controlelijst van het controlebureau.',
    fields: [
      banner('warn', { icon: 'warning', body: 'Deze registratie vervangt geen declaratie. Ze legt vast dat u de verantwoordelijkheid opneemt, met de reden erbij.' }),
      textAreaField('justification', 'Verantwoording', {
        required: true,
        placeholder: 'bv. "Platform onbereikbaar tijdens de levering; receptuur ongewijzigd t.o.v. de geverifieerde versie v3."',
      }),
    ],
    submitLabel: 'Vastleggen',
    onSubmit: async (values, close) => {
      await api.post(`/deliveries/${deliveryId}/override`, values);
      close();
      toast('Uitzondering geregistreerd.', 'ok');
      location.reload();
    },
  });
}

function editParameters(delivery, parameters, defs, onDone) {
  const byCode = Object.fromEntries(parameters.map((p) => [p.code, p]));

  formModal({
    title: 'Werfparameters (A5)',
    hint: 'Laat staan wat u niet meet: dan geldt de generieke sectorwaarde. Wat u zelf invult, moet u kunnen aantonen.',
    wide: true,
    fields: defs.flatMap((def) => {
      const current = byCode[def.code];
      return [
        div({ class: 'card-kicker mt-2' }, def.label),
        div(
          { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '11.2px' } },
          textField(`value_${def.code}`, def.unit, { type: 'number', step: '0.01', min: '0', value: current?.value ?? '' }),
          textField(`just_${def.code}`, 'Verantwoording', { value: current?.justification ?? '', placeholder: 'Enkel nodig bij een eigen meting.' }),
        ),
        div(
          { class: 'field' },
          label(
            { class: 'flex', style: { cursor: 'pointer', fontSize: '13px' } },
            input({ type: 'checkbox', name: `override_${def.code}`, checked: !!current?.overridden }),
            span({}, 'Eigen gemeten waarde in plaats van de sectorwaarde'),
          ),
        ),
      ];
    }),
    submitLabel: 'Opslaan',
    submitIcon: 'check',
    onSubmit: async (values, close) => {
      const payload = defs
        .filter((def) => values[`value_${def.code}`] !== null && values[`value_${def.code}`] !== '')
        .map((def) => ({
          code: def.code,
          value: values[`value_${def.code}`],
          unit: def.unit,
          overridden: values[`override_${def.code}`],
          justification: values[`just_${def.code}`] || null,
        }));
      await api.patch(`/deliveries/${delivery.id}/parameters`, { parameters: payload });
      close();
      toast('Werfparameters opgeslagen.', 'ok');
      await onDone();
    },
  });
}

function defLabel(code, defs) {
  return defs.find((d) => d.code === code)?.label ?? code;
}
