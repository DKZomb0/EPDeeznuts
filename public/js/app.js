/**
 * Application shell: session, hash router, navigation.
 *
 * Hash routing on purpose - it means the whole client is a static bundle that
 * needs no server rewrites, which is what lets it sit in public/ on Vercel and
 * be served from the edge.
 */
import { api } from './lib/api.js';
import { tags, mount, h } from './lib/dom.js';
import { setReference, toast } from './lib/ui.js';
import { initials } from './lib/format.js';
import { renderLogin } from './views/login.js';

const { div, span, a, nav, main, header, button } = tags;

export const state = {
  user: null,
  capabilities: [],
  reference: {},
  notifications: [],
};

export const can = (capability) => state.capabilities.includes(capability);

const root = document.getElementById('app');

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

const ROUTES = [
  { path: '/', load: () => import('./views/dashboard.js'), title: 'Overzicht' },
  { path: '/materials', load: () => import('./views/materials.js'), title: 'Grondstoffen' },
  { path: '/materials/:id', load: () => import('./views/material-detail.js'), title: 'Grondstof' },
  { path: '/access', load: () => import('./views/access.js'), title: 'Toegangsbeheer' },
  { path: '/recipes', load: () => import('./views/recipes.js'), title: 'Recepturen' },
  { path: '/recipes/:id', load: () => import('./views/recipe-detail.js'), title: 'Receptuur' },
  { path: '/versions/:id', load: () => import('./views/version-detail.js'), title: 'Receptuurversie' },
  { path: '/declarations', load: () => import('./views/declarations.js'), title: 'Declaraties' },
  { path: '/declarations/:id', load: () => import('./views/declaration-detail.js'), title: 'Declaratie' },
  { path: '/verification', load: () => import('./views/verification.js'), title: 'Verificatie' },
  { path: '/verification/:id', load: () => import('./views/declaration-detail.js'), title: 'Verificatie' },
  { path: '/projects', load: () => import('./views/projects.js'), title: 'Projecten' },
  { path: '/projects/:id', load: () => import('./views/project-detail.js'), title: 'Project' },
  { path: '/deliveries/:id', load: () => import('./views/delivery-detail.js'), title: 'Levering' },
  { path: '/sector', load: () => import('./views/sector.js'), title: 'Sectorgemiddelden' },
  { path: '/reference', load: () => import('./views/reference.js'), title: 'Rekenregels en masterdata' },
  { path: '/audit', load: () => import('./views/audit.js'), title: 'Audittrail' },
];

/** Navigation, filtered per organisation type. */
function navigation() {
  const type = state.user.orgType;
  const groups = [
    {
      label: 'Werk',
      items: [
        { href: '#/', icon: '▤', label: 'Overzicht', all: true },
        { href: '#/materials', icon: '◇', label: type === 'SUPPLIER' ? 'Mijn grondstoffen' : 'Grondstofcatalogus', all: true },
        { href: '#/access', icon: '⇄', label: 'Toegangsbeheer', when: ['SUPPLIER', 'PRODUCER', 'CONTRACTOR'] },
        { href: '#/recipes', icon: '▦', label: 'Recepturen', when: ['PRODUCER', 'VERIFIER', 'FEDERATION', 'REGULATOR'] },
        { href: '#/declarations', icon: '▣', label: 'Declaraties', when: ['PRODUCER', 'FEDERATION', 'REGULATOR'] },
        { href: '#/verification', icon: '✓', label: 'Verificatiedossiers', when: ['VERIFIER'] },
        { href: '#/projects', icon: '⌂', label: 'Projecten en leveringen', when: ['CONTRACTOR', 'PRODUCER', 'VERIFIER', 'REGULATOR'] },
      ],
    },
    {
      label: 'Sector',
      items: [
        { href: '#/sector', icon: '∑', label: 'Sectorgemiddelden', when: ['FEDERATION', 'REGULATOR', 'PRODUCER', 'VERIFIER'] },
        { href: '#/reference', icon: '𝑓', label: 'Rekenregels', all: true },
        { href: '#/audit', icon: '⧉', label: 'Audittrail', all: true },
      ],
    },
  ];

  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.all || item.when.includes(type)) }))
    .filter((group) => group.items.length);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    const [me, reference] = await Promise.all([api.get('/auth/me'), api.get('/reference')]);
    state.user = me.user;
    state.capabilities = me.capabilities;
    state.reference = reference;
    setReference(reference);
    renderShell();
    await route();
  } catch (err) {
    if (err.status === 401) {
      renderLogin(root, onAuthenticated);
      return;
    }
    mount(root, div({ class: 'empty' }, `De toepassing kon niet starten: ${err.message}`));
  }
}

async function onAuthenticated(session) {
  state.user = session.user;
  state.capabilities = session.capabilities;
  const reference = await api.get('/reference');
  state.reference = reference;
  setReference(reference);
  location.hash = '#/';
  renderShell();
  await route();
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

let outlet;
let navHost;
let titleHost;
let crumbHost;

function renderShell() {
  root.className = '';
  outlet = main({ class: 'main' });
  navHost = nav({ class: 'sidenav' });
  titleHost = div({ class: 'topbar__title' });
  crumbHost = div({ class: 'topbar__crumb' });

  mount(
    root,
    div(
      { class: 'shell' },
      header(
        { class: 'brand' },
        div({ class: 'brand__mark' }, 'E'),
        div({}, div({ class: 'brand__name' }, 'EPDeeznuts'), div({ class: 'brand__sub' }, 'Milieudeclaraties beton')),
      ),
      div(
        { class: 'topbar' },
        div({ class: 'topbar__context' }, titleHost, crumbHost),
        div({ class: 'topbar__actions' }, notificationButton(), whoButton()),
      ),
      navHost,
      outlet,
    ),
  );

  renderNav();
  refreshNotifications();
}

function renderNav() {
  const current = currentPath();
  mount(
    navHost,
    navigation().map((group) =>
      div(
        { class: 'sidenav__group' },
        div({ class: 'sidenav__label' }, group.label),
        group.items.map((item) => {
          const path = item.href.slice(1);
          const active = path === '/' ? current === '/' : current.startsWith(path);
          return a(
            { href: item.href, class: active ? 'is-active' : '' },
            span({ class: 'sidenav__icon' }, item.icon),
            span({}, item.label),
            item.badge ? span({ class: 'sidenav__count' }, item.badge) : null,
          );
        }),
      ),
    ),
  );
}

function whoButton() {
  return button(
    {
      class: 'who',
      onClick: async () => {
        await api.post('/auth/logout');
        location.hash = '#/';
        location.reload();
      },
      title: 'Afmelden',
    },
    div({ class: 'who__avatar' }, initials(state.user.name)),
    div(
      { class: 'who__text' },
      div({ class: 'who__name' }, state.user.name),
      div({ class: 'who__org' }, `${state.user.orgName} · ${state.reference.orgTypeLabels?.[state.user.orgType] ?? state.user.orgType}`),
    ),
  );
}

function notificationButton() {
  const host = span({ class: 'flex' });

  const render = () => {
    const unseen = state.notifications.filter((n) => !n.seen).length;
    mount(
      host,
      button(
        {
          class: 'btn btn--ghost btn--small',
          title: 'Meldingen',
          onClick: () => showNotifications(),
        },
        '🔔',
        unseen ? span({ class: 'sidenav__count is-alert' }, String(unseen)) : null,
      ),
    );
  };

  host.refresh = render;
  notificationHost = host;
  render();
  return host;
}

let notificationHost = null;

async function refreshNotifications() {
  try {
    const { notifications } = await api.get('/notifications');
    state.notifications = notifications;
    notificationHost?.refresh?.();
  } catch {
    /* notifications are decoration; never block the app on them */
  }
}

async function showNotifications() {
  const { modal, timeline, empty } = await import('./lib/ui.js');
  modal({
    title: 'Meldingen',
    hint: 'Systeemberichten voor uw organisatie.',
    body: state.notifications.length
      ? timeline(
          state.notifications.map((n) => ({ ts: n.created_at, summary: n.title, actor_label: n.body ?? '' })),
          { highlight: (_, i) => i === 0 },
        )
      : empty('Geen meldingen'),
    actions: (close) => [button({ class: 'btn', onClick: close }, 'Sluiten')],
  });
  await api.post('/notifications/seen');
  state.notifications = state.notifications.map((n) => ({ ...n, seen: 1 }));
  notificationHost?.refresh?.();
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

function currentPath() {
  const hash = location.hash.replace(/^#/, '');
  return hash || '/';
}

function matchRoute(path) {
  for (const route of ROUTES) {
    const keys = [];
    const pattern = route.path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment;
      })
      .join('/');
    const match = new RegExp(`^${pattern}$`).exec(path);
    if (match) {
      const params = {};
      keys.forEach((key, i) => {
        params[key] = decodeURIComponent(match[i + 1]);
      });
      return { route, params };
    }
  }
  return null;
}

let renderToken = 0;

async function route() {
  if (!outlet) return;
  const token = ++renderToken;
  const path = currentPath();
  const matched = matchRoute(path);

  renderNav();
  window.scrollTo(0, 0);

  if (!matched) {
    setTitle('Niet gevonden', path);
    mount(outlet, div({ class: 'empty' }, div({ class: 'empty__title' }, 'Deze pagina bestaat niet'), h('p', {}, path)));
    return;
  }

  setTitle(matched.route.title, '');
  mount(outlet, div({ class: 'empty' }, 'Bezig met laden…'));

  try {
    const module = await matched.route.load();
    if (token !== renderToken) return; // a newer navigation won
    await module.render(outlet, { params: matched.params, setTitle, navigate, refreshNotifications });
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    mount(
      outlet,
      div(
        { class: 'note note--bad' },
        span({ class: 'note__icon' }, '✕'),
        div({}, h('strong', {}, 'Deze pagina kon niet geladen worden. '), err.message),
      ),
    );
  }
}

export function setTitle(title, crumb = '') {
  if (titleHost) mount(titleHost, title);
  if (crumbHost) mount(crumbHost, crumb);
  document.title = `${title} — EPDeeznuts`;
}

export function navigate(path) {
  location.hash = path.startsWith('#') ? path : `#${path}`;
}

window.addEventListener('hashchange', () => {
  route().catch((err) => toast(err.message, 'bad'));
});

boot();
