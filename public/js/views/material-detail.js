/**
 * One material with its full version history.
 *
 * The version list is the point: a verifier looking at a delivery from August
 * needs to see which numbers were in force in August, not what the supplier
 * publishes today.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  card, dataTable, kv, badge, verdictBadge, evidenceBadge, note, pageHead, toast,
  formModal, textField, textAreaField, checkField, selectField, empty, ref,
} from '../lib/ui.js';
import { smart, date, dateTime } from '../lib/format.js';

const { div, span, strong, a, button, p, small } = tags;

export async function render(outlet, { params, setTitle }) {
  const data = await api.get(`/materials/${params.id}`);
  const material = data.material;
  setTitle(material.name, `${material.supplier_name} · ${material.code}`);

  const isOwner = material.org_id === state.user.orgId;

  if (data.restricted) {
    return mount(
      outlet,
      pageHead(material.name, `${material.supplier_name} · ${material.code}`),
      card(
        'Afgeschermde gegevens',
        div(
          {},
          note('warn', strong({}, 'U hebt nog geen toegang tot de milieuparameters van deze grondstof. '), data.hint),
          kv([
            ['Leverancier', material.supplier_name],
            ['Categorie', categoryLabel(material.category)],
            ['Type declaratie', evidenceBadge(material.evidence_type)],
            ['Productielocatie', material.site_name ?? '—'],
          ]),
        ),
        {
          actions: can('access:request')
            ? [button({ class: 'btn btn--accent', onClick: () => requestAccess(material) }, 'Toegang vragen')]
            : null,
        },
      ),
    );
  }

  mount(
    outlet,
    pageHead(
      material.name,
      material.description ?? `${categoryLabel(material.category)} van ${material.supplier_name}.`,
      isOwner && can('materials:write')
        ? [button({ class: 'btn btn--accent', onClick: () => openNewVersion(material, data.versions[0]) }, '+ Nieuwe versie')]
        : null,
    ),

    div(
      { class: 'grid grid--side' },
      div(
        {},
        card('Versiegeschiedenis', versionTable(data.versions), {
          flush: true,
          hint: 'Een wijziging vervangt de vorige versie nooit: ze sluit die af en opent een nieuwe, zodat elke levering naar de cijfers van haar eigen moment blijft verwijzen.',
        }),
        currentValues(data.versions[0]),
      ),
      div(
        {},
        card(
          'Kenmerken',
          kv([
            ['Code', span({ class: 'mono' }, material.code)],
            ['Leverancier', material.supplier_name],
            ['Categorie', categoryLabel(material.category)],
            ['Productielocatie', material.site_name ? `${material.site_name}${material.site_city ? `, ${material.site_city}` : ''}` : '—'],
            ['Declaratie-eenheid', ref().declaredUnits?.[material.declared_unit]?.label ?? material.declared_unit],
            ['Huidig oordeel', verdictBadge(material.verdict)],
          ]),
        ),
        evidenceCard(data.versions[0]?.evidence),
        material.reasons?.length
          ? card(
              'Bevindingen',
              div({}, material.reasons.map((r) => note(toneFor(r.verdict), r.message))),
            )
          : null,
        card('Verplichte modules', moduleRules(material.category), {
          hint: 'Europese productregels bepalen hoe ver deze categorie moet rapporteren.',
        }),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */

function versionTable(versions) {
  return dataTable(
    [
      { label: 'Versie', render: (v) => strong({}, `v${v.version_no}`) },
      {
        label: 'Geldig',
        render: (v) =>
          div(
            {},
            `${date(v.effective_from)} → ${v.effective_to ? date(v.effective_to) : 'nu'}`,
            v.effective_to ? null : span({ class: 'sub' }, 'lopende versie'),
          ),
      },
      { label: 'Status', render: (v) => badge(v.status === 'ACTIVE' ? 'Actief' : v.status === 'SUPERSEDED' ? 'Vervangen' : v.status, v.status === 'ACTIVE' ? 'ok' : 'muted') },
      { label: 'Bewijsstuk', render: (v) => (v.evidence ? div({}, evidenceBadge(v.evidence.type), span({ class: 'sub mono' }, v.evidence.number ?? '')) : badge('Geen', 'bad')) },
      { label: 'GWP A1–A3', align: 'right', render: (v) => `${smart(sumGwp(v.values))} kg CO₂/t` },
      { label: 'Reden', render: (v) => span({ class: 'small muted' }, v.change_reason ?? '—') },
    ],
    versions,
    { compact: true },
  );
}

function currentValues(version) {
  if (!version) return null;
  const indicators = ref().indicators ?? [];
  const modules = ['A1', 'A2', 'A3'];

  const rows = indicators.map((indicator) => ({
    indicator,
    ...Object.fromEntries(modules.map((m) => [m, version.values?.[m]?.[indicator.code] ?? 0])),
    total: modules.reduce((sum, m) => sum + (version.values?.[m]?.[indicator.code] ?? 0), 0),
  }));

  return card(
    `Milieuparameters — v${version.version_no}`,
    dataTable(
      [
        { label: 'Indicator', render: (r) => div({}, strong({}, r.indicator.short), span({ class: 'sub' }, r.indicator.label)) },
        { label: 'Eenheid', render: (r) => span({ class: 'small muted' }, r.indicator.unit) },
        ...modules.map((m) => ({ label: m, align: 'right', render: (r) => smart(r[m]) })),
        { label: 'A1–A3', align: 'right', render: (r) => strong({}, smart(r.total)) },
      ],
      rows,
      { compact: true },
    ),
    { flush: true, hint: `Per ${ref().declaredUnits?.TONNE?.label ?? '1 ton'}, volgens EN 15804+A2.` },
  );
}

function evidenceCard(evidence) {
  if (!evidence) {
    return card('Bewijsstuk', note('bad', 'Aan deze versie hangt geen enkele milieudeclaratie. Elk dossier dat deze grondstof gebruikt, is daardoor ongeldig.'));
  }
  const meta = ref().evidenceTypes?.[evidence.type];
  return card(
    'Bewijsstuk',
    div(
      {},
      kv([
        ['Type', evidenceBadge(evidence.type)],
        ['Nummer', evidence.number ? span({ class: 'mono' }, evidence.number) : span({ class: 'muted' }, 'ontbreekt')],
        ['Programma', evidence.programme ?? '—'],
        ['Geverifieerd door', evidence.issuer ?? '—'],
        ['Geldig van', date(evidence.valid_from)],
        ['Geldig tot', evidence.valid_until ? date(evidence.valid_until) : '—'],
      ]),
      meta?.description ? p({ class: 'small muted mt-2' }, meta.description) : null,
      evidence.document_url ? p({ class: 'mt-1' }, a({ href: evidence.document_url, target: '_blank', rel: 'noopener' }, 'Declaratie openen ↗')) : null,
    ),
  );
}

function moduleRules(category) {
  const rule = (ref().categoryRules ?? []).find((r) => r.category === category);
  if (!rule) return empty('Geen specifieke regel vastgelegd voor deze categorie');
  return div(
    {},
    div({ class: 'flex wrap mb-1' }, rule.required_modules.split(',').map((m) => badge(m.trim(), 'info'))),
    p({ class: 'small muted' }, rule.note ?? ''),
    p({ class: 'tiny muted mt-1' }, `Bron: ${rule.source}`),
  );
}

/* ------------------------------------------------------------------ */

function openNewVersion(material, latest) {
  const modules = ['A1', 'A2', 'A3'];
  const current = latest?.values ?? {};

  formModal({
    title: `Nieuwe versie van ${material.code}`,
    hint: 'De lopende versie wordt afgesloten op de ingangsdatum. Oudere leveringen blijven naar de oude cijfers verwijzen.',
    wide: true,
    fields: [
      textAreaField('changeReason', 'Reden voor de wijziging', {
        required: true,
        placeholder: 'Bv. "Nieuwe ovenlijn in gebruik genomen, aandeel alternatieve brandstoffen gestegen naar 62 %."',
        hint: 'Deze tekst komt in de audittrail en wordt door de verificateur gelezen.',
      }),
      textField('effectiveFrom', 'Geldig vanaf', { type: 'date', hint: 'Leeg laten = vanaf vandaag.' }),
      div({ class: 'card__title mt-2 mb-1' }, 'Milieuparameters per ton'),
      ...modules.map((m) =>
        textField(`gwp_${m}`, `${m} — GWP-totaal (kg CO₂ eq./t)`, {
          type: 'number',
          step: '0.0001',
          value: current[m]?.GWP_TOTAL ?? '',
        }),
      ),
      checkField('includesInboundTransport', 'Levering franco: transport naar de klant is inbegrepen', {
        value: !!latest?.includes_inbound_transport,
      }),
      latest?.evidence
        ? note('info', 'Het bestaande bewijsstuk ', strong({}, latest.evidence.number ?? latest.evidence.type), ' blijft gekoppeld. Zijn de cijfers gewijzigd, dan hoort daar in principe een nieuwe geverifieerde declaratie bij.')
        : null,
    ],
    submitLabel: 'Versie aanmaken',
    onSubmit: async (values, close) => {
      await api.post(`/materials/${material.id}/versions`, {
        changeReason: values.changeReason,
        effectiveFrom: values.effectiveFrom || null,
        evidenceId: latest?.evidence?.id ?? null,
        includesInboundTransport: values.includesInboundTransport,
        values: Object.fromEntries(
          modules.filter((m) => values[`gwp_${m}`] !== null && values[`gwp_${m}`] !== '').map((m) => [m, { GWP_TOTAL: values[`gwp_${m}`] }]),
        ),
      });
      close();
      toast('Nieuwe versie aangemaakt.', 'ok');
      location.reload();
    },
  });
}

function requestAccess(material) {
  formModal({
    title: `Toegang vragen aan ${material.supplier_name}`,
    fields: [textAreaField('reason', 'Motivering', { required: true })],
    submitLabel: 'Versturen',
    onSubmit: async (values, close) => {
      await api.post('/access', { ownerOrgId: material.org_id, reason: values.reason });
      close();
      toast('Aanvraag verstuurd.', 'ok');
    },
  });
}

/* ------------------------------------------------------------------ */

function sumGwp(values) {
  return ['A1', 'A2', 'A3'].reduce((sum, m) => sum + (values?.[m]?.GWP_TOTAL ?? 0), 0);
}

function categoryLabel(code) {
  return ref().materialCategories?.find((c) => c.code === code)?.label ?? code;
}

function toneFor(verdict) {
  return { VALID: 'ok', VALID_WITH_WARNINGS: 'warn', INDICATIVE: 'warn', INVALID: 'bad' }[verdict] ?? 'muted';
}
