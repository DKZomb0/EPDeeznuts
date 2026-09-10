/**
 * A recipe and its version timeline.
 *
 * The timeline is where the change-control story is visible at a glance: which
 * versions went through a verifier, which inherited a verification, and which
 * one is waiting.
 */
import { api } from '../lib/api.js';
import { tags, mount, formData } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  card, dataTable, kv, badge, statusBadge, verdictBadge, note, pageHead, toast, modal,
  textField, textAreaField, timeline, ref,
} from '../lib/ui.js';
import { smart, date, pct } from '../lib/format.js';
import { compositionEditor } from './recipes.js';

const { div, span, strong, a, button, form, p } = tags;

export async function render(outlet, { params, setTitle, navigate }) {
  const data = await api.get(`/recipes/${params.id}`);
  const recipe = data.recipe;
  setTitle(recipe.code, `${recipe.producer_name} · ${recipe.name}`);

  const isOwner = recipe.org_id === state.user.orgId;
  const active = data.versions.find((v) => v.status === 'ACTIVE');

  mount(
    outlet,
    pageHead(
      recipe.code,
      recipe.name,
      [
        active ? a({ href: `#/versions/${active.id}`, class: 'btn btn--primary' }, 'Actieve versie openen') : null,
        isOwner && can('recipes:write') ? button({ class: 'btn btn--accent', onClick: () => openNewVersion(recipe, active, navigate) }, '+ Nieuwe versie') : null,
      ].filter(Boolean),
    ),

    div(
      { class: 'grid grid--side' },
      div(
        {},
        card('Versies', versionTable(data.versions, navigate), {
          flush: true,
          hint: 'Een versie die binnen de afgesproken marge blijft, erft de verificatie van de vorige. Grotere wijzigingen gaan opnieuw naar de verificateur.',
        }),
        card('Registraties', timeline(data.history), { hint: 'Wie wat wijzigde, en waarom.' }),
      ),
      div(
        {},
        card(
          'Kenmerken',
          kv([
            ['Producent', recipe.producer_name],
            ['Centrale', recipe.site_name ?? '—'],
            ['Sterkteklasse', recipe.strength_class ?? '—'],
            ['Omgevingsklassen', recipe.exposure_classes ?? '—'],
            ['Consistentie', recipe.consistency ?? '—'],
            ['Dmax', recipe.dmax ? `${recipe.dmax} mm` : '—'],
            ['Densiteit', `${smart(recipe.density)} kg/m³`],
            ['BENOR', recipe.benor ? badge('Gecertificeerd', 'ok') : span({ class: 'muted' }, 'nee')],
          ]),
        ),
      ),
    ),
  );
}

function versionTable(versions, navigate) {
  return dataTable(
    [
      { label: 'Versie', render: (v) => strong({}, `v${v.version_no}`) },
      { label: 'Status', render: (v) => badge(statusLabel(v.status), v.status === 'ACTIVE' ? 'ok' : v.status === 'DRAFT' ? 'info' : 'muted') },
      {
        label: 'Geldig',
        render: (v) => `${date(v.effective_from)} → ${v.effective_to ? date(v.effective_to) : 'nu'}`,
      },
      {
        label: 'Declaratie',
        render: (v) =>
          v.declaration
            ? div(
                {},
                statusBadge(v.declaration.status),
                v.declaration.bypass_of
                  ? span({ class: 'sub' }, `geërfd, afwijking ${pct(v.declaration.bypass_deviation, 2)}`)
                  : v.declaration.certificate_no
                    ? span({ class: 'sub mono' }, v.declaration.certificate_no)
                    : null,
              )
            : badge('Niet ingediend', 'muted'),
      },
      { label: 'Oordeel', render: (v) => (v.declaration ? verdictBadge(v.declaration.verdict) : span({ class: 'muted' }, '—')) },
      { label: 'Wijziging', render: (v) => span({ class: 'small muted' }, v.change_reason ?? '—') },
      { label: '', align: 'right', render: (v) => a({ href: `#/versions/${v.id}`, class: 'btn btn--small btn--ghost' }, 'Openen') },
    ],
    versions,
    { compact: true, onRow: (v) => navigate(`/versions/${v.id}`) },
  );
}

function statusLabel(status) {
  return { ACTIVE: 'In productie', DRAFT: 'Ontwerp', SUPERSEDED: 'Vervangen', ARCHIVED: 'Gearchiveerd' }[status] ?? status;
}

/* ------------------------------------------------------------------ */

async function openNewVersion(recipe, active, navigate) {
  const [{ materials }, versionData] = await Promise.all([
    api.get('/materials'),
    active ? api.get(`/recipe-versions/${active.id}`) : Promise.resolve({ components: [] }),
  ]);

  const profiles = ref().transportProfiles ?? [];
  const initial = (versionData.components ?? []).map((c) => ({
    materialId: c.material_id,
    quantityKg: c.quantity_kg,
    transportKm: c.transport_km,
    transportProfileId: c.transport_profile_id,
  }));

  const editor = compositionEditor(materials, profiles, initial);
  let formEl;

  modal({
    title: `Nieuwe versie van ${recipe.code}`,
    hint: 'De samenstelling is overgenomen van de actieve versie. Pas aan wat wijzigt; het systeem toont daarna meteen of er een externe verificatie nodig is.',
    wide: true,
    body: () => {
      formEl = form(
        { onSubmit: (e) => e.preventDefault() },
        textAreaField('changeReason', 'Reden voor de wijziging', {
          required: true,
          placeholder: 'Bv. "Cementdosering met 8 kg verlaagd na optimalisatie van de korrelopbouw."',
          hint: 'Verplicht. Dit is wat de verificateur leest en wat in de audittrail komt.',
        }),
        textField('effectiveFrom', 'Geldig vanaf', { type: 'date', hint: 'Leeg = vanaf vandaag.' }),
        div({ class: 'card__title mt-2 mb-1' }, 'Samenstelling per m³'),
        editor,
      );
      return formEl;
    },
    actions: (close) => [
      button({ class: 'btn', onClick: close }, 'Annuleren'),
      button(
        {
          class: 'btn btn--accent',
          onClick: async (event) => {
            if (!formEl.reportValidity()) return;
            const components = editor.readComponents();
            if (!components.length) return toast('Voeg minstens één grondstof toe.', 'bad');

            event.currentTarget.disabled = true;
            try {
              const values = formData(formEl);
              const { version, gate } = await api.post(`/recipes/${recipe.id}/versions`, {
                changeReason: values.changeReason,
                effectiveFrom: values.effectiveFrom || null,
                components,
                activate: false,
              });
              close();
              showGateOutcome(gate, version, navigate);
            } catch (err) {
              toast(err.message, 'bad');
              event.currentTarget.disabled = false;
            }
          },
        },
        'Versie aanmaken',
      ),
    ],
  });
}

/**
 * Immediately after creating a version, say whether it will need a verifier.
 * That is a planning fact for the producer, not something to discover later.
 */
function showGateOutcome(gate, version, navigate) {
  if (!gate) {
    navigate(`/versions/${version.id}`);
    return;
  }
  const auto = gate.decision === 'AUTO_ACCEPT';

  modal({
    title: auto ? 'Binnen de wijzigingsmarge' : 'Externe verificatie nodig',
    hint: `Wijziging t.o.v. de vorige declaratie: ${pct(gate.deviationPct, 2)}`,
    body: div(
      {},
      note(auto ? 'ok' : 'warn', gate.summary),
      div(
        { class: 'mt-2' },
        (gate.checks ?? []).map((check) =>
          div(
            { class: `gate__check ${check.passed ? 'gate__check--pass' : 'gate__check--fail'}` },
            span({ class: check.passed ? 'badge badge--ok' : 'badge badge--bad', style: { minWidth: '22px', justifyContent: 'center' } }, check.passed ? '✓' : '✕'),
            div({ style: { marginLeft: '8px' } }, check.message),
          ),
        ),
      ),
      p({ class: 'small muted mt-2' }, 'De versie staat nu als ontwerp klaar. Ze wordt pas actief wanneer u ze in productie neemt.'),
    ),
    actions: (close) => [
      button(
        {
          class: 'btn btn--accent',
          onClick: () => {
            close();
            navigate(`/versions/${version.id}`);
          },
        },
        'Versie openen',
      ),
    ],
  });
}
