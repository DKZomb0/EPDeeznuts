/**
 * Projectenlijst.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { can } from '../app.js';
import { tablePanel, banner, pageHead, toast, formModal, textField, textAreaField, btn, smart, date } from '../lib/ui.js';

const { div, span, strong } = tags;

export async function render(outlet, { setTitle, navigate }) {
  setTitle('Projecten');
  const host = div();

  const load = async () => {
    const { projects } = await api.get('/projects');
    mount(
      host,
      tablePanel(
        [
          { label: 'Project', render: (p) => div({}, div({ class: 'strong' }, p.name), div({ class: 'sub' }, `${p.address ?? ''}${p.city ? `, ${p.city}` : ''}`)) },
          { label: 'Referentie', muted: true, render: (p) => span({ class: 'mono small' }, p.reference ?? '—') },
          { label: 'Bouwheer / aannemer', muted: true, render: (p) => p.owner_name },
          { label: 'Architect', muted: true, render: (p) => p.architect ?? '—' },
          { label: 'Leveringen', align: 'right', muted: true, render: (p) => String(p.deliveryCount) },
          { label: 'Volume', align: 'right', render: (p) => `${smart(p.volumeM3)} m³` },
          { label: '', align: 'right', render: (p) => btn('Openen', { variant: 'ghost', small: true, icon: 'arrowRight', href: `#/projects/${p.id}` }) },
        ],
        projects,
        { onRow: (p) => navigate(`/projects/${p.id}`), emptyTitle: 'Nog geen projecten', emptyText: 'Maak een project aan om leveringen te registreren.' },
      ),
    );
  };

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        title: 'Projecten en leveringen',
        lede:
          'Modules A4 en A5 horen bij een levering, niet bij een receptuur: het transport en de verwerking hangen van de werf af. Per project legt u vast wie welke module invult.',
        actions: can('projects:write') ? [btn('Project aanmaken', { variant: 'primary', icon: 'plus', onClick: () => openCreate(load) })] : null,
      }),
      banner('plain', {
        icon: 'users',
        title: 'Verantwoordelijkheid staat vast',
        body:
          'Levert de centrale met eigen mixers, dan draagt zij A4. Haalt de aannemer het beton zelf op, dan draagt hij A4 én A5. Alleen de aangeduide partij kan die cijfers invullen, en de audittrail houdt bij wie het deed.',
      }),
      host,
    ),
  );

  await load();
}

function openCreate(onDone) {
  formModal({
    title: 'Nieuw project',
    hint: 'U krijgt standaard zelf A4 en A5 toegewezen; die kunt u daarna doorgeven aan de betoncentrale.',
    fields: [
      textField('name', 'Projectnaam', { required: true, placeholder: 'Woonproject Nieuwe Dokken' }),
      textField('reference', 'Eigen referentie', { placeholder: 'VH-2026-014' }),
      div(
        { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '11.2px' } },
        textField('address', 'Adres', {}),
        textField('city', 'Gemeente', {}),
      ),
      textField('architect', 'Architect / ontwerper', {}),
      textAreaField('note', 'Nota', {}),
    ],
    submitLabel: 'Aanmaken',
    submitIcon: 'plus',
    onSubmit: async (values, close) => {
      await api.post('/projects', values);
      close();
      toast('Project aangemaakt.', 'ok');
      await onDone();
    },
  });
}
