/**
 * Access management: what we asked others for, and what others asked of us.
 */
import { api } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { can } from '../app.js';
import { card, dataTable, badge, note, pageHead, toast, formModal, textAreaField, selectField, ref } from '../lib/ui.js';
import { date, relative, STATUS_TONE } from '../lib/format.js';

const { div, span, strong, button } = tags;

const STATUS_LABELS = {
  PENDING: 'In behandeling',
  GRANTED: 'Toegekend',
  DENIED: 'Geweigerd',
  REVOKED: 'Ingetrokken',
};

export async function render(outlet, { setTitle }) {
  setTitle('Toegangsbeheer', '');
  const host = div();

  const load = async () => {
    const data = await api.get('/access');
    mount(
      host,
      data.incoming.length || can('access:decide')
        ? card(
            'Aanvragen aan ons gericht',
            dataTable(
              [
                { label: 'Afnemer', render: (r) => div({}, strong({}, r.requester_name), span({ class: 'sub' }, r.requester_city ?? '')) },
                { label: 'Bereik', render: (r) => (r.material_name ? span({ class: 'small' }, r.material_name) : badge('Volledige catalogus', 'info')) },
                { label: 'Motivering', render: (r) => span({ class: 'small muted' }, r.reason ?? '—') },
                { label: 'Status', render: (r) => badge(STATUS_LABELS[r.status] ?? r.status, STATUS_TONE[r.status] ?? 'muted') },
                { label: 'Gevraagd', render: (r) => relative(r.created_at) },
                {
                  label: '',
                  align: 'right',
                  render: (r) =>
                    r.status === 'PENDING'
                      ? div(
                          { class: 'btn-row' },
                          button({ class: 'btn btn--small btn--accent', onClick: () => decide(r, 'GRANT') }, 'Toestaan'),
                          button({ class: 'btn btn--small btn--danger', onClick: () => decide(r, 'DENY') }, 'Weigeren'),
                        )
                      : r.status === 'GRANTED'
                        ? button({ class: 'btn btn--small btn--ghost', onClick: () => revoke(r) }, 'Intrekken')
                        : span({ class: 'muted small' }, date(r.decided_at)),
                },
              ],
              data.incoming,
              { compact: true, emptyText: 'Nog niemand heeft toegang gevraagd tot uw gegevens.' },
            ),
            {
              flush: true,
              hint: 'U beslist zelf wie uw milieuparameters mag inkijken. Een afnemer ziet altijd wél dat het product bestaat — anders kan hij het niet aanvragen.',
            },
          )
        : null,

      card(
        'Onze aanvragen bij leveranciers',
        dataTable(
          [
            { label: 'Leverancier', render: (r) => strong({}, r.owner_name) },
            { label: 'Bereik', render: (r) => (r.material_name ? span({ class: 'small' }, r.material_name) : badge('Volledige catalogus', 'info')) },
            { label: 'Status', render: (r) => badge(STATUS_LABELS[r.status] ?? r.status, STATUS_TONE[r.status] ?? 'muted') },
            { label: 'Gevraagd', render: (r) => relative(r.created_at) },
            { label: 'Beslist', render: (r) => (r.decided_at ? date(r.decided_at) : '—') },
            { label: 'Antwoord', render: (r) => span({ class: 'small muted' }, r.decision_note ?? '—') },
          ],
          data.outgoing,
          { compact: true, emptyText: 'U hebt nog geen toegang aangevraagd.' },
        ),
        {
          flush: true,
          actions: can('access:request') ? [button({ class: 'btn btn--small btn--accent', onClick: () => openRequest(load) }, '+ Toegang vragen')] : null,
        },
      ),
    );
  };

  mount(
    outlet,
    pageHead(
      'Toegangsbeheer',
      'Milieudeclaraties zijn commercieel gevoelig. Een leverancier bepaalt zelf welke afnemers zijn cijfers mogen inkijken; de aanvraag en de beslissing blijven allebei geregistreerd.',
    ),
    note(
      'info',
      strong({}, 'Waarom deze stap bestaat: '),
      'een cementproducent wil niet dat een centrale die niets bij hem koopt, zijn declaraties leest. Tegelijk moet elke centrale wél kunnen vinden dat het product bestaat, anders kan ze er nooit naar vragen.',
    ),
    host,
  );

  await load();

  async function decide(request, decision) {
    try {
      await api.post(`/access/${request.id}/decide`, { decision });
      toast(decision === 'GRANT' ? `${request.requester_name} heeft nu toegang.` : 'Aanvraag geweigerd.', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function revoke(request) {
    formModal({
      title: `Toegang van ${request.requester_name} intrekken`,
      hint: 'De afnemer verliest onmiddellijk het zicht op uw cijfers. Bestaande declaraties blijven wel verwijzen naar de versie waarmee ze berekend zijn.',
      fields: [textAreaField('note', 'Reden', { required: true, placeholder: 'Bv. "Leveringscontract beëindigd op 31/12."' })],
      submitLabel: 'Intrekken',
      onSubmit: async (values, close) => {
        await api.post(`/access/${request.id}/revoke`, { note: values.note });
        close();
        toast('Toegang ingetrokken.', 'ok');
        await load();
      },
    });
  }
}

async function openRequest(onDone) {
  const { organisations } = await api.get('/organisations');
  const suppliers = organisations.filter((o) => o.type === 'SUPPLIER');

  formModal({
    title: 'Toegang vragen',
    hint: 'De leverancier krijgt uw motivering te zien en beslist.',
    fields: [
      selectField('ownerOrgId', 'Leverancier', suppliers.map((s) => ({ value: s.id, label: `${s.name}${s.city ? ` — ${s.city}` : ''}` })), { required: true }),
      textAreaField('reason', 'Motivering', {
        required: true,
        placeholder: 'Bv. "Wij nemen CEM I 42,5 N af sinds januari en hebben de milieuparameters nodig voor onze declaratie."',
      }),
    ],
    submitLabel: 'Versturen',
    onSubmit: async (values, close) => {
      await api.post('/access', values);
      close();
      toast('Aanvraag verstuurd.', 'ok');
      await onDone();
    },
  });
}
