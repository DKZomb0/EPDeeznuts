/**
 * A delivery: the full A1–A5 picture and the continuous go / no-go.
 *
 * The wording on this screen matters more than usual. The check says whether
 * the delivery can be *declared* as covered by a verified declaration. It does
 * not stop a truck, and the interface says so: the producer stays responsible
 * for the concrete it ships, exactly as today. That is also why the manual
 * exception exists and is recorded rather than blocked.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  card, dataTable, kv, stat, badge, verdictBadge, note, pageHead, toast, modal, formModal,
  moduleBar, traceView, gatePanel, timeline, textField, textAreaField, checkField, ref, empty,
} from '../lib/ui.js';
import { smart, date, dateTime, pct, GATE_LABELS } from '../lib/format.js';

const { div, span, strong, a, button, p, small } = tags;

export async function render(outlet, { params, setTitle }) {
  const host = div();
  mount(outlet, host);

  const load = async () => {
    const data = await api.get(`/deliveries/${params.id}`);
    draw(data);
  };

  const draw = (data) => {
    const { delivery, parameters, parameterDefs, responsibilities, result, gates, audit } = data;
    const unit = result.lead.unit;
    setTitle(`Levering ${delivery.delivery_note ?? ''}`, `${delivery.project_name} · ${delivery.recipe_code}`);

    const a5Owner = responsibilities.find((r) => r.module === 'A5');
    const canEditA5 = a5Owner?.org_id === state.user.orgId && can('siteparams:write');
    const lastGate = gates[0];

    mount(
      host,
      pageHead(
        `Levering ${delivery.delivery_note ?? delivery.id}`,
        `${smart(delivery.volume_m3)} m³ ${delivery.recipe_code} · geleverd op ${date(delivery.delivered_at)} · ${smart(delivery.distance_km)} km naar ${delivery.project_name}.`,
        [
          a({ href: `#/projects/${delivery.project_id}`, class: 'btn btn--ghost' }, '← Project'),
          button({ class: 'btn btn--primary', onClick: () => runGate(delivery.id, load) }, 'Controle uitvoeren'),
          canEditA5 ? button({ class: 'btn btn--accent', onClick: () => editParameters(delivery, parameters, parameterDefs, load) }, 'Werfparameters invullen') : null,
        ].filter(Boolean),
      ),

      div(
        { class: 'grid grid--4 mb-2' },
        stat({ label: 'GWP per m³', value: smart(result.totals.GWP_TOTAL), unit, note: 'A1 t.e.m. A5' }),
        stat({
          label: 'GWP volledige levering',
          value: smart(result.absolute?.GWP_TOTAL ?? result.totals.GWP_TOTAL * delivery.volume_m3),
          unit: 'kg CO₂ eq.',
          note: `${smart(delivery.volume_m3)} m³`,
        }),
        stat({ label: 'Oordeel', value: ref().verdicts?.[result.verdict]?.label ?? result.verdict, tone: result.verdict === 'VALID' ? 'ok' : result.verdict === 'INVALID' ? 'bad' : 'warn' }),
        stat({
          label: 'Laatste controle',
          value: lastGate ? GATE_LABELS[lastGate.decision] ?? lastGate.decision : 'nog niet uitgevoerd',
          note: lastGate ? dateTime(lastGate.created_at) : '',
          tone: lastGate ? (lastGate.decision === 'GO' ? 'ok' : lastGate.decision === 'NO_GO' ? 'bad' : 'warn') : undefined,
        }),
      ),

      div(
        { class: 'grid grid--side' },
        div(
          {},
          card('Verdeling A1 t.e.m. A5', moduleBar(result.lead.byModule, result.modules, unit), {
            hint: 'A4 is de rit van de centrale naar deze werf; A5 is de verwerking ter plaatse.',
          }),

          card(
            'Werfparameters (A5)',
            div(
              {},
              a5Owner
                ? note(
                    canEditA5 ? 'info' : 'muted',
                    strong({}, `Module A5 is de verantwoordelijkheid van ${a5Owner.org_name}. `),
                    canEditA5 ? 'U kunt deze waarden invullen; elke wijziging komt op uw naam in de audittrail.' : 'Enkel die partij kan deze waarden invullen.',
                  )
                : note('warn', 'Voor module A5 is op dit project nog geen verantwoordelijke aangeduid.'),
              dataTable(
                [
                  { label: 'Parameter', render: (r) => div({}, strong({}, defLabel(r.code, parameterDefs)), span({ class: 'sub mono' }, r.code)) },
                  { label: 'Waarde', align: 'right', render: (r) => `${smart(r.value)} ${r.unit}` },
                  { label: 'Herkomst', render: (r) => (r.overridden ? badge('Eigen meting', 'warn') : badge('Sectorwaarde', 'muted')) },
                  { label: 'Verantwoording', render: (r) => span({ class: 'small muted' }, r.justification ?? '') },
                  { label: 'Ingevuld', render: (r) => date(r.entered_at) },
                ],
                parameters,
                { compact: true, emptyText: 'Nog geen werfparameters ingevuld.' },
              ),
            ),
          ),

          card(
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
          ),
        ),

        div(
          {},
          lastGate ? gateCard(lastGate, delivery) : card('Controle', empty('Nog geen controle uitgevoerd', 'Voer de controle uit om te zien of deze levering gedekt is door een geldige declaratie.')),
          card(
            'Levering',
            kv([
              ['Project', delivery.project_name],
              ['Receptuur', `${delivery.recipe_code} v${delivery.version_no}`],
              ['Sterkteklasse', delivery.strength_class ?? '—'],
              ['Volume', `${smart(delivery.volume_m3)} m³`],
              ['Geleverd op', dateTime(delivery.delivered_at)],
              ['Afstand', `${smart(delivery.distance_km)} km`],
              ['Bonnummer', delivery.delivery_note ?? '—'],
            ]),
          ),
          card('Audittrail', timeline(audit)),
        ),
      ),
    );
  };

  await load();
}

function gateCard(gate, delivery) {
  const reasons = gate.reasons_json ? JSON.parse(gate.reasons_json) : [];
  const stop = gate.decision === 'NO_GO';

  return card(
    'Controle',
    div(
      {},
      gatePanel({
        decision: gate.decision,
        title: GATE_LABELS[gate.decision] ?? gate.decision,
        subtitle: gate.deviation_pct !== null ? `Afwijking ${pct(gate.deviation_pct, 2)} (marge ± ${gate.threshold_pct} %)` : gate.note,
        checks: reasons,
      }),
      div(
        { class: 'card__foot' },
        stop
          ? div(
              {},
              p(
                { class: 'small' },
                strong({}, 'Wat dit betekent. '),
                'Deze levering kan niet gerapporteerd worden als gedekt door een geldige declaratie. Het is geen leveringsverbod: de betonproducent blijft, net als vandaag, verantwoordelijk voor het beton dat hij levert.',
              ),
              button({ class: 'btn btn--small btn--danger mt-1', onClick: () => override(delivery.id) }, 'Uitzondering vastleggen'),
            )
          : small({ class: 'muted' }, 'De controle draait op de gegevens zoals ze golden op de leveringsdatum, niet op de receptuur van vandaag.'),
      ),
    ),
    { flush: true },
  );
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
    hint: 'Gebruik dit wanneer de controle niet afgerond kan worden maar de levering wel doorgaat. De uitzondering komt op uw naam en verschijnt op de controlelijst van de verificateur.',
    fields: [
      note(
        'warn',
        'Deze registratie vervangt geen declaratie. Ze legt vast dat u de verantwoordelijkheid opneemt, met de reden erbij.',
      ),
      textAreaField('justification', 'Verantwoording', {
        required: true,
        placeholder: 'Bv. "Platform onbereikbaar tijdens de levering; receptuur ongewijzigd t.o.v. de geverifieerde versie v3."',
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
        textField(`value_${def.code}`, `${def.label} (${def.unit})`, {
          type: 'number',
          step: '0.01',
          min: '0',
          value: current?.value ?? '',
        }),
        checkField(`override_${def.code}`, 'Eigen gemeten waarde in plaats van de sectorwaarde', { value: !!current?.overridden }),
        textField(`just_${def.code}`, 'Verantwoording', { value: current?.justification ?? '', placeholder: 'Enkel nodig bij een eigen meting.' }),
      ];
    }),
    submitLabel: 'Opslaan',
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
