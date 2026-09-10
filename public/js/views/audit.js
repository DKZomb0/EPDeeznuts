/**
 * The audit trail.
 *
 * Oversight roles read across the whole platform; everyone else sees their own
 * organisation. Either way this is the answer to "wie heeft dit ingevuld?" -
 * the question that made shared accounts unacceptable in the first place.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { card, dataTable, badge, note, pageHead, modal } from '../lib/ui.js';
import { dateTime, shortId } from '../lib/format.js';

const { div, span, strong, input, select, option, button, pre } = tags;

const ACTION_TONE = {
  DECLARATION_VERIFIED: 'ok',
  DECLARATION_PUBLISHED: 'ok',
  ACCESS_GRANTED: 'ok',
  DECLARATION_REJECTED: 'bad',
  ACCESS_DENIED: 'bad',
  ACCESS_REVOKED: 'bad',
  DELIVERY_OVERRIDE: 'warn',
  DECLARATION_AUTO_ACCEPTED: 'warn',
  SETTINGS_UPDATED: 'warn',
};

export async function render(outlet, { setTitle }) {
  setTitle('Audittrail', '');

  const filters = { q: '', action: '' };
  const host = div();

  const load = async () => {
    mount(host, div({ class: 'empty' }, 'Bezig met laden…'));
    const data = await api.get(`/audit${qs({ ...filters, limit: 200 })}`);
    draw(data);
  };

  const draw = (data) => {
    mount(
      host,
      div(
        { class: 'toolbar' },
        input({
          type: 'search',
          placeholder: 'Zoek in omschrijving, persoon of kenmerk…',
          onInput: debounce((e) => {
            filters.q = e.target.value;
            load();
          }, 250),
        }),
        select(
          {
            onChange: (e) => {
              filters.action = e.target.value;
              load();
            },
          },
          option({ value: '' }, 'Alle handelingen'),
          data.actions.map((action) => option({ value: action, selected: action === filters.action }, action)),
        ),
        div({ class: 'toolbar__spacer' }),
        span({ class: 'small muted' }, `${data.total} registratie(s) · bereik: ${data.scope === 'ALL' ? 'volledige sector' : 'eigen organisatie'}`),
      ),
      card(
        'Registraties',
        dataTable(
          [
            { label: 'Wanneer', render: (e) => span({ class: 'nowrap small' }, dateTime(e.ts)) },
            { label: 'Wie', render: (e) => span({ class: 'small' }, e.actor_label ?? 'Systeem') },
            { label: 'Handeling', render: (e) => badge(e.action, ACTION_TONE[e.action] ?? 'muted') },
            { label: 'Onderwerp', render: (e) => div({}, span({ class: 'small' }, e.entity_type ?? '—'), span({ class: 'sub mono' }, shortId(e.entity_id))) },
            { label: 'Omschrijving', render: (e) => span({ class: 'small' }, e.summary ?? '—') },
            {
              label: '',
              align: 'right',
              render: (e) => (e.detail ? button({ class: 'btn btn--small btn--ghost', onClick: (ev) => (ev.stopPropagation(), showDetail(e)) }, 'Detail') : null),
            },
          ],
          data.entries,
          { compact: true, emptyText: 'Geen registraties gevonden.' },
        ),
        { flush: true },
      ),
    );
  };

  mount(
    outlet,
    pageHead(
      'Audittrail',
      'Elke handeling met haar auteur en tijdstip. De registratie wordt nooit bijgewerkt of verwijderd — er komt alleen bij.',
    ),
    note(
      'muted',
      strong({}, 'Waarom dit zo streng staat. '),
      'Omdat modules aan verschillende partijen toegewezen worden, moet achteraf vaststaan wie welk cijfer invulde. Dat werkt alleen als iedereen onder zijn eigen naam werkt.',
    ),
    host,
  );

  await load();
}

function showDetail(entry) {
  modal({
    title: entry.action,
    hint: `${entry.actor_label ?? 'Systeem'} · ${dateTime(entry.ts)}`,
    wide: true,
    body: div(
      {},
      div({ class: 'mb-2' }, strong({}, entry.summary ?? '')),
      pre(
        { style: { background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '6px', padding: '13px', overflow: 'auto', maxHeight: '52vh', fontSize: '11.5px' } },
        JSON.stringify(entry.detail, null, 2),
      ),
    ),
    actions: (close) => [button({ class: 'btn btn--primary', onClick: close }, 'Sluiten')],
  });
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
