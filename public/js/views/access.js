/**
 * Toegangsaanvragen tussen organisaties.
 *
 * Een cementproducent wil niet dat een centrale die niets bij hem koopt zijn
 * declaraties leest. Tegelijk moet die centrale het product wél kunnen vinden.
 * Aanvraag én beslissing blijven allebei geregistreerd.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { can } from '../app.js';
import { panel, tablePanel, banner, tag, pageHead, toast, formModal, textAreaField, selectField, btn, empty, date, icon } from '../lib/ui.js';
import { relative, STATUS_TAG } from '../lib/format.js';

const { div, span, strong, small } = tags;

const STATUS_LABELS = { PENDING: 'Wacht op beslissing', GRANTED: 'Toegekend', DENIED: 'Geweigerd', REVOKED: 'Ingetrokken' };

export async function render(outlet, { setTitle, refresh }) {
  setTitle('Toegangsaanvragen');
  const host = div({ class: 'stack' });

  const load = async () => {
    const data = await api.get('/access');
    mount(
      host,
      can('access:decide')
        ? panel({
            title: 'Aan ons gericht',
            sub: 'Betonproducenten zien dát uw producten bestaan, niet de onderliggende milieuparameters. Inzage kent u per afnemer toe en trekt u weer in.',
            body: data.incoming.length
              ? div(
                  { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: '16.8px' } },
                  data.incoming.map((request) => requestCard(request, decide, revoke)),
                )
              : empty('Nog geen aanvragen', 'Niemand heeft tot nu toe inzage gevraagd in uw gegevens.'),
          })
        : null,

      panel({
        title: 'Onze aanvragen bij leveranciers',
        actions: can('access:request') ? [btn('Inzage vragen', { variant: 'primary', icon: 'lockOpen', small: true, onClick: () => openRequest(load) })] : null,
        variant: 'flush',
        body: tablePanel(
          [
            { label: 'Leverancier', render: (r) => strong({}, r.owner_name) },
            { label: 'Bereik', render: (r) => (r.material_name ? span({ class: 'small' }, r.material_name) : tag('Volledige catalogus', 'tag-quiet')) },
            { label: 'Status', render: (r) => tag(STATUS_LABELS[r.status] ?? r.status, STATUS_TAG[r.status] ?? 'tag-quiet') },
            { label: 'Gevraagd', muted: true, render: (r) => relative(r.created_at) },
            { label: 'Beslist', muted: true, render: (r) => (r.decided_at ? date(r.decided_at) : '—') },
            { label: 'Antwoord', wrap: true, muted: true, render: (r) => span({ class: 'small' }, r.decision_note ?? '—') },
          ],
          data.outgoing,
          { emptyTitle: 'Nog geen aanvragen verstuurd', emptyText: 'Vraag inzage aan bij een leverancier om zijn grondstoffen te kunnen gebruiken.' },
        ),
      }),
    );
  };

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        title: 'Toegangsaanvragen',
        lede: 'Milieudeclaraties zijn commercieel gevoelig. De leverancier bepaalt zelf welke afnemers zijn cijfers mogen inkijken.',
      }),
      host,
    ),
  );

  await load();

  async function decide(request, decision) {
    try {
      await api.post(`/access/${request.id}/decide`, { decision });
      toast(decision === 'GRANT' ? `${request.requester_name} heeft nu inzage.` : 'Aanvraag geweigerd.', 'ok');
      await load();
      await refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function revoke(request) {
    formModal({
      title: `Inzage van ${request.requester_name} intrekken`,
      hint: 'De afnemer verliest onmiddellijk het zicht op uw cijfers. Bestaande declaraties blijven wel verwijzen naar de versie waarmee ze berekend zijn.',
      fields: [textAreaField('note', 'Reden', { required: true, placeholder: 'bv. "Leveringscontract beëindigd op 31/12."' })],
      submitLabel: 'Intrekken',
      onSubmit: async (values, close) => {
        await api.post(`/access/${request.id}/revoke`, { note: values.note });
        close();
        toast('Inzage ingetrokken.', 'ok');
        await load();
      },
    });
  }
}

function requestCard(request, decide, revoke) {
  const pending = request.status === 'PENDING';

  return div(
    { class: 'card elev-sm' },
    div(
      { class: 'flex', style: { alignItems: 'baseline' } },
      span({ class: 'card-title grow' }, request.requester_name),
      small({ class: 'muted tnum' }, date(request.created_at)),
    ),
    div(
      { class: 'small dim' },
      'Vraagt inzage in ',
      strong({ style: { color: 'var(--color-text)' } }, request.material_name ?? 'de volledige catalogus'),
      request.requester_city ? div({}, request.requester_city) : null,
    ),
    request.reason ? div({ class: 'small dim' }, `„${request.reason}”`) : null,
    pending
      ? div(
          { class: 'btn-row mt-1' },
          btn('Inzage toekennen', { variant: 'primary', icon: 'lockOpen', onClick: () => decide(request, 'GRANT') }),
          btn('Weigeren', { variant: 'ghost', onClick: () => decide(request, 'DENY') }),
        )
      : request.status === 'GRANTED'
        ? div({ class: 'btn-row mt-1' }, btn('Intrekken', { variant: 'ghost', icon: 'lock', small: true, onClick: () => revoke(request) }))
        : null,
    div(
      { class: 'tiny muted' },
      request.status === 'GRANTED'
        ? 'Inzage actief · intrekbaar'
        : request.status === 'DENIED'
          ? 'Geweigerd — de afnemer ziet enkel dat het product bestaat'
          : request.status === 'REVOKED'
            ? 'Ingetrokken'
            : 'Wacht op uw beslissing',
    ),
  );
}

async function openRequest(onDone) {
  const { organisations } = await api.get('/organisations');
  const suppliers = organisations.filter((o) => o.type === 'SUPPLIER');

  formModal({
    title: 'Inzage vragen',
    hint: 'De leverancier krijgt uw motivering te zien en beslist.',
    fields: [
      selectField('ownerOrgId', 'Leverancier', suppliers.map((s) => ({ value: s.id, label: `${s.name}${s.city ? ` — ${s.city}` : ''}` })), { required: true }),
      textAreaField('reason', 'Motivering', {
        required: true,
        placeholder: 'bv. "Wij nemen CEM I 42,5 N af sinds januari en hebben de milieuparameters nodig voor onze declaratie."',
      }),
    ],
    submitLabel: 'Versturen',
    submitIcon: 'send',
    onSubmit: async (values, close) => {
      await api.post('/access', values);
      close();
      toast('Aanvraag verstuurd.', 'ok');
      await onDone();
    },
  });
}
