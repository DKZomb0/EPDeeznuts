/**
 * Projectdetail: wie welke module draagt, en de leveringen zelf.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import { panel, tablePanel, kv, tag, banner, pageHead, toast, formModal, textField, selectField, btn, logList, ref, smart, date } from '../lib/ui.js';

const { div, span, strong, p } = tags;

export async function render(outlet, { params, setTitle, navigate }) {
  const host = div({ class: 'stack' });
  mount(outlet, host);

  const load = async () => {
    const data = await api.get(`/projects/${params.id}`);
    draw(data);
  };

  const draw = ({ project, deliveries, responsibilities, audit }) => {
    setTitle(project.name);
    const isOwner = project.org_id === state.user.orgId;

    mount(
      host,
      pageHead({
        crumb: [{ label: 'Projecten', onClick: () => navigate('/projects') }, { label: project.name }],
        title: project.name,
        lede: `${project.address ?? ''}${project.city ? `, ${project.city}` : ''}${project.architect ? ` · ontwerp: ${project.architect}` : ''}`,
        actions: can('deliveries:write') && isOwner ? [btn('Levering registreren', { variant: 'primary', icon: 'truck', onClick: () => openDelivery(project, load) })] : null,
      }),

      div(
        { class: 'grid grid--wide' },
        div(
          { class: 'flex-col', style: { gap: '16.8px', minWidth: 0 } },
          panel({
            title: 'Leveringen',
            variant: 'flush',
            body: tablePanel(
              [
                { label: 'Bon', render: (d) => span({ class: 'mono small' }, d.delivery_note ?? '—') },
                { label: 'Receptuur', render: (d) => div({}, div({ class: 'strong' }, d.recipe_code), div({ class: 'sub' }, `v${d.version_no} · ${d.strength_class ?? ''}`)) },
                { label: 'Producent', muted: true, render: (d) => d.producer_name },
                { label: 'Volume', align: 'right', render: (d) => `${smart(d.volume_m3)} m³` },
                { label: 'Afstand', align: 'right', muted: true, render: (d) => `${smart(d.distance_km)} km` },
                { label: 'Geleverd', muted: true, render: (d) => date(d.delivered_at) },
                { label: '', align: 'right', render: (d) => btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/deliveries/${d.id}` }) },
              ],
              deliveries,
              { onRow: (d) => navigate(`/deliveries/${d.id}`), emptyTitle: 'Nog geen leveringen', emptyText: 'Registreer de eerste levering op dit project.' },
            ),
          }),
          panel({ kicker: 'Registraties', body: logList(audit, { limit: 16 }) }),
        ),

        div(
          { class: 'flex-col', style: { gap: '16.8px', minWidth: 0 } },
          panel({
            kicker: 'Verantwoordelijkheid per module',
            body: div(
              {},
              p({ class: 'small dim' }, 'Alleen de aangeduide organisatie kan de cijfers van die module invullen.'),
              div(
                { class: 'flex-col mt-2', style: { gap: '5.6px' } },
                (responsibilities ?? []).map((r) =>
                  div(
                    { class: 'checkrow' },
                    tag(r.module, 'tag-accent'),
                    span({ class: 'grow small' }, moduleLabel(r.module)),
                    strong({ class: 'small' }, r.org_name),
                  ),
                ),
              ),
              isOwner && can('projects:write')
                ? div({ class: 'mt-2' }, btn('Toewijzing wijzigen', { variant: 'secondary', small: true, icon: 'users', onClick: () => assign(project, responsibilities, load) }))
                : null,
            ),
          }),
          panel({
            kicker: 'Project',
            body: kv([
              ['Bouwheer / aannemer', project.owner_name],
              ['Referentie', project.reference ?? '—'],
              ['Adres', `${project.address ?? '—'}${project.city ? `, ${project.city}` : ''}`],
              ['Architect', project.architect ?? '—'],
              ['Aangemaakt', date(project.created_at)],
              ['Leveringen', String(deliveries.length)],
              ['Volume', `${smart(deliveries.reduce((s, d) => s + Number(d.volume_m3 ?? 0), 0))} m³`],
            ]),
          }),
        ),
      ),
    );
  };

  await load();
}

function moduleLabel(code) {
  return (ref().modules ?? []).find((m) => m.code === code)?.label ?? code;
}

async function assign(project, responsibilities, onDone) {
  const { organisations } = await api.get('/organisations');
  const candidates = organisations.filter((o) => ['PRODUCER', 'CONTRACTOR'].includes(o.type));
  const current = Object.fromEntries(responsibilities.map((r) => [r.module, r.org_id]));
  const options = candidates.map((o) => ({ value: o.id, label: `${o.name} (${o.type === 'PRODUCER' ? 'producent' : 'aannemer'})` }));

  formModal({
    title: 'Verantwoordelijkheid toewijzen',
    hint: 'Levert de centrale met eigen mixers, dan draagt zij A4. Haalt u het beton zelf op, dan draagt u beide modules.',
    fields: [
      selectField('A4', 'A4 — transport naar de werf', options, { value: current.A4, required: true, placeholder: false }),
      selectField('A5', 'A5 — verwerking op de werf', options, { value: current.A5, required: true, placeholder: false }),
    ],
    submitLabel: 'Toewijzen',
    submitIcon: 'check',
    onSubmit: async (values, close) => {
      for (const module of ['A4', 'A5']) {
        if (values[module] && values[module] !== current[module]) {
          await api.post(`/projects/${project.id}/responsibilities`, { module, orgId: values[module] });
        }
      }
      close();
      toast('Toewijzing bijgewerkt.', 'ok');
      await onDone();
    },
  });
}

async function openDelivery(project, onDone) {
  const { recipes } = await api.get('/recipes?scope=all');
  const mixers = (ref().transportProfiles ?? []).filter((p) => p.mode === 'MIXER');

  formModal({
    title: 'Levering registreren',
    hint: 'Het systeem koppelt automatisch de receptuurversie die op de leveringsdatum van kracht was.',
    fields: [
      selectField('recipeId', 'Receptuur', recipes.map((r) => ({ value: r.id, label: `${r.code} — ${r.producer_name}` })), { required: true }),
      div(
        { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '11.2px' } },
        textField('deliveryNote', 'Bonnummer', { placeholder: 'BON-2026-4611' }),
        textField('volumeM3', 'Volume (m³)', { type: 'number', step: '0.5', required: true }),
      ),
      div(
        { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '11.2px' } },
        textField('deliveredAt', 'Leveringsdatum', { type: 'date', required: true, value: new Date().toISOString().slice(0, 10) }),
        textField('distanceKm', 'Afstand centrale → werf (km)', { type: 'number', step: '0.5', required: true }),
      ),
      selectField('transportProfileId', 'Transportprofiel (A4)', mixers.map((p) => ({ value: p.id, label: p.name })), { placeholder: '— standaard mixer —' }),
      banner('plain', { icon: 'info', body: 'De werfparameters (A5) staan na registratie klaar met de generieke sectorwaarden. De verantwoordelijke partij kan ze daarna aanpassen.' }),
    ],
    submitLabel: 'Registreren',
    submitIcon: 'truck',
    onSubmit: async (values, close) => {
      await api.post(`/projects/${project.id}/deliveries`, {
        ...values,
        deliveredAt: values.deliveredAt ? new Date(values.deliveredAt).toISOString() : null,
      });
      close();
      toast('Levering geregistreerd.', 'ok');
      await onDone();
    },
  });
}
