/**
 * Project list.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { can } from '../app.js';
import { card, dataTable, pageHead, note, toast, formModal, textField, textAreaField } from '../lib/ui.js';
import { smart, date } from '../lib/format.js';

const { div, span, strong, button } = tags;

export async function render(outlet, { setTitle, navigate }) {
  setTitle('Projecten en leveringen', '');
  const host = div();

  const load = async () => {
    const { projects } = await api.get('/projects');
    mount(
      host,
      card(
        `${projects.length} project${projects.length === 1 ? '' : 'en'}`,
        dataTable(
          [
            { label: 'Project', render: (p) => div({}, strong({}, p.name), span({ class: 'sub' }, `${p.address ?? ''}${p.city ? `, ${p.city}` : ''}`)) },
            { label: 'Referentie', render: (p) => span({ class: 'mono small' }, p.reference ?? '—') },
            { label: 'Bouwheer / aannemer', render: (p) => p.owner_name },
            { label: 'Architect', render: (p) => span({ class: 'small muted' }, p.architect ?? '—') },
            { label: 'Leveringen', align: 'right', render: (p) => String(p.deliveryCount) },
            { label: 'Volume', align: 'right', render: (p) => `${smart(p.volumeM3)} m³` },
            { label: 'Aangemaakt', render: (p) => date(p.created_at) },
          ],
          projects,
          { onRow: (p) => navigate(`/projects/${p.id}`), emptyText: 'Nog geen projecten.' },
        ),
        { flush: true },
      ),
    );
  };

  mount(
    outlet,
    pageHead(
      'Projecten en leveringen',
      'Modules A4 en A5 horen bij een levering, niet bij een receptuur: het transport en de verwerking hangen van de werf af. Per project legt u vast wie welke module invult.',
      can('projects:write') ? [button({ class: 'btn btn--accent', onClick: () => openCreate(load) }, '+ Project aanmaken')] : null,
    ),
    note(
      'info',
      strong({}, 'Verantwoordelijkheid staat vast. '),
      'Levert de centrale met eigen mixers, dan draagt zij A4. Haalt de aannemer het beton zelf op, dan draagt hij A4 én A5. Alleen de aangeduide partij kan die cijfers invullen, en de audittrail houdt bij wie het deed.',
    ),
    host,
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
      div({ class: 'field-row' }, textField('address', 'Adres', {}), textField('city', 'Gemeente', {})),
      textField('architect', 'Architect / ontwerper', {}),
      textAreaField('note', 'Nota', {}),
    ],
    submitLabel: 'Aanmaken',
    onSubmit: async (values, close) => {
      await api.post('/projects', values);
      close();
      toast('Project aangemaakt.', 'ok');
      await onDone();
    },
  });
}
