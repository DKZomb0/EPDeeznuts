/**
 * De audittrail.
 *
 * Toezichtsrollen lezen over het hele platform; iedereen anders ziet de eigen
 * organisatie. Dit is het antwoord op "wie heeft dit ingevuld?" — de vraag die
 * gedeelde accounts onaanvaardbaar maakt.
 */
import { api, qs } from '../lib/api.js';
import { tags, mount } from '../lib/dom.js';
import { panel, tablePanel, banner, tag, pageHead, modal, btn, dateTime } from '../lib/ui.js';
import { shortId } from '../lib/format.js';

const { div, span, strong, input, select, option, pre } = tags;

const ACTION_TAG = {
  DECLARATION_VERIFIED: 'tag-accent',
  DECLARATION_PUBLISHED: 'tag-accent',
  ACCESS_GRANTED: 'tag-accent',
  DECLARATION_REJECTED: 'tag-neutral',
  ACCESS_DENIED: 'tag-neutral',
  ACCESS_REVOKED: 'tag-neutral',
  DELIVERY_OVERRIDE: 'tag-outline',
  DECLARATION_AUTO_ACCEPTED: 'tag-outline',
  SETTINGS_UPDATED: 'tag-outline',
};

export async function render(outlet, { setTitle }) {
  setTitle('Audittrail');

  const filters = { q: '', action: '' };
  const host = div();

  const load = async () => {
    const data = await api.get(`/audit${qs({ ...filters, limit: 200 })}`);
    draw(data);
  };

  const draw = (data) => {
    mount(
      host,
      div(
        { class: 'toolbar mb-2' },
        searchInput((value) => {
          filters.q = value;
          load();
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
      tablePanel(
        [
          { label: 'Wanneer', muted: true, render: (e) => span({ class: 'nowrap small tnum' }, dateTime(e.ts)) },
          { label: 'Wie', render: (e) => span({ class: 'small' }, e.actor_label ?? 'Systeem') },
          { label: 'Handeling', render: (e) => tag(e.action, ACTION_TAG[e.action] ?? 'tag-quiet') },
          { label: 'Onderwerp', muted: true, render: (e) => div({}, span({ class: 'small' }, e.entity_type ?? '—'), div({ class: 'sub mono' }, shortId(e.entity_id))) },
          { label: 'Omschrijving', wrap: true, render: (e) => span({ class: 'small' }, e.summary ?? '—') },
          {
            label: '',
            align: 'right',
            render: (e) => (e.detail ? btn('Detail', { variant: 'ghost', small: true, onClick: (ev) => (ev.stopPropagation(), showDetail(e)) }) : null),
          },
        ],
        data.entries,
        { emptyTitle: 'Geen registraties gevonden', emptyText: 'Pas de filters aan.' },
      ),
    );
  };

  mount(
    outlet,
    div(
      { class: 'stack' },
      pageHead({
        title: 'Audittrail',
        lede: 'Elke handeling met haar auteur en tijdstip. De registratie wordt nooit bijgewerkt of verwijderd — er komt alleen bij.',
      }),
      banner('plain', {
        icon: 'history',
        title: 'Waarom dit zo streng staat',
        body:
          'Omdat modules aan verschillende partijen toegewezen worden, moet achteraf vaststaan wie welk cijfer invulde. Dat werkt alleen als iedereen onder zijn eigen naam werkt.',
      }),
      host,
    ),
  );

  await load();
}

function searchInput(onChange) {
  let timer;
  const el = input({ type: 'search', placeholder: 'Zoek in omschrijving, persoon of kenmerk…' });
  el.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(el.value), 250);
  });
  return el;
}

function showDetail(entry) {
  modal({
    title: entry.action,
    hint: `${entry.actor_label ?? 'Systeem'} · ${dateTime(entry.ts)}`,
    wide: true,
    body: div(
      { class: 'flex-col' },
      strong({}, entry.summary ?? ''),
      pre({ class: 'formula-block', style: { maxHeight: '52vh', overflow: 'auto' } }, JSON.stringify(entry.detail, null, 2)),
    ),
    actions: (close) => [btn('Sluiten', { variant: 'primary', onClick: close })],
  });
}
