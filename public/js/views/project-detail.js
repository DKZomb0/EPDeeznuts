/**
 * Project detail: who carries which module, and the deliveries themselves.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { state, can } from '../app.js';
import {
  card, dataTable, kv, badge, note, pageHead, toast, formModal, textField,
  selectField, timeline, ref, empty,
} from '../lib/ui.js';
import { smart, date, GATE_LABELS } from '../lib/format.js';

const { div, span, strong, a, button, p } = tags;

export async function render(outlet, { params, setTitle, navigate }) {
  const host = div();
  mount(outlet, host);

  const load = async () => {
    const data = await api.get(`/projects/${params.id}`);
    draw(data);
  };

  const draw = ({ project, deliveries, responsibilities, audit }) => {
    setTitle(project.name, project.reference ?? '');
    const isOwner = project.org_id === state.user.orgId;

    mount(
      host,
      pageHead(
        project.name,
        `${project.address ?? ''}${project.city ? `, ${project.city}` : ''}${project.architect ? ` · ontwerp: ${project.architect}` : ''}`,
        [
          can('deliveries:write') && isOwner
            ? button({ class: 'btn btn--accent', onClick: () => openDelivery(project, load) }, '+ Levering registreren')
            : null,
        ].filter(Boolean),
      ),

      div(
        { class: 'grid grid--side' },
        div(
          {},
          card(
            'Leveringen',
            dataTable(
              [
                { label: 'Bon', render: (d) => span({ class: 'mono small' }, d.delivery_note ?? '—') },
                { label: 'Receptuur', render: (d) => div({}, strong({}, d.recipe_code), span({ class: 'sub' }, `v${d.version_no} · ${d.strength_class ?? ''}`)) },
                { label: 'Producent', render: (d) => d.producer_name },
                { label: 'Volume', align: 'right', render: (d) => `${smart(d.volume_m3)} m³` },
                { label: 'Afstand', align: 'right', render: (d) => `${smart(d.distance_km)} km` },
                { label: 'Geleverd', render: (d) => date(d.delivered_at) },
                { label: '', align: 'right', render: (d) => a({ href: `#/deliveries/${d.id}`, class: 'btn btn--small btn--ghost' }, 'Openen') },
              ],
              deliveries,
              { onRow: (d) => navigate(`/deliveries/${d.id}`), emptyText: 'Nog geen leveringen op dit project.' },
            ),
            { flush: true },
          ),
          card('Registraties', timeline(audit)),
        ),

        div(
          {},
          card(
            'Verantwoordelijkheid per module',
            div(
              {},
              p({ class: 'small muted mb-1' }, 'Alleen de aangeduide organisatie kan de cijfers van die module invullen.'),
              (responsibilities ?? []).map((r) =>
                div(
                  { class: 'flex-between', style: { padding: '7px 0', borderBottom: '1px solid var(--line)' } },
                  div({}, badge(r.module, 'info'), ' ', span({ class: 'small' }, moduleLabel(r.module))),
                  div({ class: 'right' }, strong({ class: 'small' }, r.org_name)),
                ),
              ),
              isOwner && can('projects:write')
                ? div({ class: 'mt-2' }, button({ class: 'btn btn--small', onClick: () => assign(project, responsibilities, load) }, 'Toewijzing wijzigen'))
                : null,
            ),
          ),
          card(
            'Project',
            kv([
              ['Bouwheer / aannemer', project.owner_name],
              ['Referentie', project.reference ?? '—'],
              ['Adres', `${project.address ?? '—'}${project.city ? `, ${project.city}` : ''}`],
              ['Architect', project.architect ?? '—'],
              ['Aangemaakt', date(project.created_at)],
            ]),
          ),
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

  formModal({
    title: 'Verantwoordelijkheid toewijzen',
    hint: 'Levert de centrale met eigen mixers, dan draagt zij A4. Haalt u het beton zelf op, dan draagt u beide modules.',
    fields: [
      selectField('A4', 'A4 — transport naar de werf', candidates.map((o) => ({ value: o.id, label: `${o.name} (${o.type === 'PRODUCER' ? 'producent' : 'aannemer'})` })), {
        value: current.A4,
        required: true,
        placeholder: false,
      }),
      selectField('A5', 'A5 — verwerking op de werf', candidates.map((o) => ({ value: o.id, label: `${o.name} (${o.type === 'PRODUCER' ? 'producent' : 'aannemer'})` })), {
        value: current.A5,
        required: true,
        placeholder: false,
      }),
    ],
    submitLabel: 'Toewijzen',
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
  const [{ recipes }, reference] = await Promise.all([api.get('/recipes?scope=all'), Promise.resolve(ref())]);
  const mixers = (reference.transportProfiles ?? []).filter((p) => p.mode === 'MIXER');

  formModal({
    title: 'Levering registreren',
    hint: 'Het systeem koppelt automatisch de receptuurversie die op de leveringsdatum van kracht was.',
    fields: [
      selectField('recipeId', 'Receptuur', recipes.map((r) => ({ value: r.id, label: `${r.code} — ${r.producer_name}` })), { required: true }),
      div(
        { class: 'field-row' },
        textField('deliveryNote', 'Bonnummer', { placeholder: 'BON-2026-4611' }),
        textField('volumeM3', 'Volume (m³)', { type: 'number', step: '0.5', required: true }),
      ),
      div(
        { class: 'field-row' },
        textField('deliveredAt', 'Leveringsdatum', { type: 'date', required: true, value: new Date().toISOString().slice(0, 10) }),
        textField('distanceKm', 'Afstand centrale → werf (km)', { type: 'number', step: '0.5', required: true }),
      ),
      selectField('transportProfileId', 'Transportprofiel (A4)', mixers.map((p) => ({ value: p.id, label: p.name })), { placeholder: '— standaard mixer —' }),
      note('muted', 'De werfparameters (A5) staan na registratie klaar met de generieke sectorwaarden. De verantwoordelijke partij kan ze daarna aanpassen.'),
    ],
    submitLabel: 'Registreren',
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
