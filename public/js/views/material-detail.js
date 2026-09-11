/**
 * Eén grondstof met haar volledige versiegeschiedenis.
 *
 * De versielijst is het punt: een verificateur die naar een levering van
 * augustus kijkt, moet de cijfers zien die in augustus golden — niet wat de
 * leverancier vandaag publiceert.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  panel, card, tablePanel, banner, kv, tag, verdictTag, evidenceTag, pageHead, toast, formModal,
  textField, textAreaField, checkField, btn, empty, ref, smart, date,
} from '../lib/ui.js';

const { div, span, strong, a, p } = tags;

export async function render(outlet, { params, setTitle, navigate }) {
  const data = await api.get(`/materials/${params.id}`);
  const material = data.material;
  setTitle(material.name);

  const isOwner = material.org_id === state.user.orgId;

  if (data.restricted) {
    return mount(
      outlet,
      div(
        { class: 'stack' },
        pageHead({
          crumb: [{ label: 'Grondstofcatalogus', onClick: () => navigate('/materials') }, { label: material.code }],
          title: material.name,
          lede: `${material.supplier_name} · ${material.code}`,
          actions: can('access:request') ? [btn('Inzage vragen', { variant: 'primary', icon: 'lockOpen', onClick: () => requestAccess(material) })] : null,
        }),
        banner('neutral', { icon: 'lock', title: 'Afgeschermde gegevens', body: data.hint }),
        panel({
          kicker: 'Wat wel zichtbaar is',
          body: kv([
            ['Leverancier', material.supplier_name],
            ['Categorie', categoryLabel(material.category)],
            ['Type declaratie', evidenceTag(material.evidence_type)],
            ['Productielocatie', material.site_name ?? '—'],
          ]),
        }),
      ),
    );
  }

  const latest = data.versions[0];

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        crumb: [{ label: 'Grondstoffen', onClick: () => navigate('/materials') }, { label: material.code }],
        title: material.name,
        lede: material.description ?? `${categoryLabel(material.category)} van ${material.supplier_name}.`,
        actions: isOwner && can('materials:write') ? [btn('Nieuwe versie', { variant: 'primary', icon: 'plus', onClick: () => openNewVersion(material, latest) })] : null,
      }),

      material.verdict !== 'VALID'
        ? banner(material.verdict === 'INVALID' ? 'neutral' : 'warn', {
            icon: material.verdict === 'INVALID' ? 'prohibit' : 'warning',
            title: ref().verdicts?.[material.verdict]?.label ?? material.verdict,
            body: material.reasons?.[0]?.message ?? ref().verdicts?.[material.verdict]?.description ?? '',
          })
        : null,

      div(
        { class: 'grid grid--wide' },
        div(
          { class: 'flex-col', style: { gap: '16.8px', minWidth: 0 } },
          panel({
            title: 'Versiegeschiedenis',
            sub: 'Een wijziging vervangt de vorige versie nooit: ze sluit die af en opent een nieuwe, zodat elke levering naar de cijfers van haar eigen moment blijft verwijzen.',
            variant: 'flush',
            body: tablePanel(
              [
                { label: 'Versie', render: (v) => strong({}, `v${v.version_no}`) },
                { label: 'Geldig', muted: true, render: (v) => `${date(v.effective_from)} → ${v.effective_to ? date(v.effective_to) : 'nu'}` },
                { label: 'Status', render: (v) => tag(v.status === 'ACTIVE' ? 'Actief' : v.status === 'SUPERSEDED' ? 'Vervangen' : v.status, v.status === 'ACTIVE' ? 'tag-accent' : 'tag-quiet') },
                { label: 'Bron', render: (v) => (v.evidence ? div({}, evidenceTag(v.evidence.type), v.evidence.number ? div({ class: 'sub mono' }, v.evidence.number) : null) : tag('Geen', 'tag-neutral')) },
                { label: 'GWP A1–A3', align: 'right', render: (v) => div({}, span({ class: 'tnum' }, smart(sumGwp(v.values))), div({ class: 'sub' }, 'kg CO₂e / ton')) },
                { label: 'Reden', wrap: true, muted: true, render: (v) => span({ class: 'small' }, v.change_reason ?? '—') },
              ],
              data.versions,
            ),
          }),

          latest ? valuesPanel(latest) : null,
        ),

        div(
          { class: 'flex-col', style: { gap: '16.8px', minWidth: 0 } },
          panel({
            kicker: 'Kenmerken',
            body: kv([
              ['Code', span({ class: 'mono' }, material.code)],
              ['Leverancier', material.supplier_name],
              ['Categorie', categoryLabel(material.category)],
              ['Productielocatie', material.site_name ? `${material.site_name}${material.site_city ? `, ${material.site_city}` : ''}` : '—'],
              ['Declaratie-eenheid', ref().declaredUnits?.[material.declared_unit]?.label ?? material.declared_unit],
              ['Oordeel', verdictTag(material.verdict)],
            ]),
          }),
          evidencePanel(latest?.evidence),
          panel({
            kicker: 'Verplichte fasen',
            sub: 'Europese productregels bepalen hoe ver deze categorie moet rapporteren.',
            body: moduleRules(material.category),
          }),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */

function valuesPanel(version) {
  const indicators = ref().indicators ?? [];
  const modules = ['A1', 'A2', 'A3'];

  const rows = indicators.map((indicator) => ({
    indicator,
    ...Object.fromEntries(modules.map((m) => [m, version.values?.[m]?.[indicator.code] ?? 0])),
    total: modules.reduce((sum, m) => sum + (version.values?.[m]?.[indicator.code] ?? 0), 0),
  }));

  return panel({
    title: `Milieuparameters — v${version.version_no}`,
    sub: `Per ${ref().declaredUnits?.TONNE?.label ?? '1 ton'}, volgens EN 15804+A2.`,
    variant: 'flush',
    body: tablePanel(
      [
        { label: 'Indicator', render: (r) => div({}, div({ class: 'strong' }, r.indicator.short), div({ class: 'sub' }, r.indicator.label)) },
        { label: 'Eenheid', muted: true, render: (r) => r.indicator.unit },
        ...modules.map((m) => ({ label: m, align: 'right', render: (r) => smart(r[m]) })),
        { label: 'A1–A3', align: 'right', render: (r) => strong({ class: 'tnum' }, smart(r.total)) },
      ],
      rows,
    ),
  });
}

function evidencePanel(evidence) {
  if (!evidence) {
    return panel({
      kicker: 'Bewijsstuk',
      body: banner('neutral', {
        icon: 'prohibit',
        body: 'Aan deze versie hangt geen enkele milieudeclaratie. Elk dossier dat deze grondstof gebruikt, is daardoor ongeldig.',
      }),
    });
  }

  const meta = ref().evidenceTypes?.[evidence.type];
  return panel({
    kicker: 'Bewijsstuk',
    body: div(
      {},
      kv([
        ['Type', evidenceTag(evidence.type)],
        ['Nummer', evidence.number ? span({ class: 'mono' }, evidence.number) : span({ class: 'muted' }, 'ontbreekt')],
        ['Programma', evidence.programme ?? '—'],
        ['Geverifieerd door', evidence.issuer ?? '—'],
        ['Geldig van', date(evidence.valid_from)],
        ['Geldig tot', evidence.valid_until ? date(evidence.valid_until) : '—'],
      ]),
      meta?.description ? p({ class: 'small dim mt-2' }, meta.description) : null,
      evidence.document_url ? p({ class: 'mt-1' }, a({ href: evidence.document_url, target: '_blank', rel: 'noopener' }, 'Declaratie openen ↗')) : null,
    ),
  });
}

function moduleRules(category) {
  const rule = (ref().categoryRules ?? []).find((r) => r.category === category);
  if (!rule) return empty('Geen specifieke regel vastgelegd voor deze categorie');
  return div(
    {},
    div({ class: 'flex wrap mb-1' }, rule.required_modules.split(',').map((m) => tag(m.trim(), 'tag-accent'))),
    rule.optional_modules ? div({ class: 'flex wrap mb-1' }, rule.optional_modules.split(',').map((m) => tag(`${m.trim()} optioneel`, 'tag-quiet'))) : null,
    p({ class: 'small dim' }, rule.note ?? ''),
    p({ class: 'tiny muted' }, `Bron: ${rule.source}`),
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
        placeholder: 'bv. "Nieuwe ovenlijn in gebruik genomen, aandeel alternatieve brandstoffen gestegen naar 62 %."',
        hint: 'Deze tekst komt in de audittrail en wordt door het controlebureau gelezen.',
      }),
      textField('effectiveFrom', 'Geldig vanaf', { type: 'date', hint: 'Leeg laten = vanaf vandaag.' }),
      div({ class: 'card-kicker mt-2' }, 'Milieuparameters per ton'),
      ...modules.map((m) => textField(`gwp_${m}`, `${m} — GWP-totaal (kg CO₂e / ton)`, { type: 'number', step: '0.0001', value: current[m]?.GWP_TOTAL ?? '' })),
      checkField('includesInboundTransport', 'Levering franco: transport naar de klant is inbegrepen', { value: !!latest?.includes_inbound_transport }),
      latest?.evidence
        ? banner('plain', {
            icon: 'info',
            body: div({}, 'Het bestaande bewijsstuk ', strong({}, latest.evidence.number ?? latest.evidence.type), ' blijft gekoppeld. Zijn de cijfers gewijzigd, dan hoort daar in principe een nieuwe geverifieerde declaratie bij.'),
          })
        : null,
    ],
    submitLabel: 'Versie aanmaken',
    submitIcon: 'plus',
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
    title: `Inzage vragen aan ${material.supplier_name}`,
    fields: [textAreaField('reason', 'Motivering', { required: true })],
    submitLabel: 'Versturen',
    submitIcon: 'send',
    onSubmit: async (values, close) => {
      await api.post('/access', { ownerOrgId: material.org_id, reason: values.reason });
      close();
      toast('Aanvraag verstuurd.', 'ok');
    },
  });
}

function sumGwp(values) {
  return ['A1', 'A2', 'A3'].reduce((sum, m) => sum + (values?.[m]?.GWP_TOTAL ?? 0), 0);
}

function categoryLabel(code) {
  return ref().materialCategories?.find((c) => c.code === code)?.label ?? code;
}
