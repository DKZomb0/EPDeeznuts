/**
 * Schil: sessie, hash-router, navigatie.
 *
 * Hash-routing met opzet — de client is daardoor een statische bundel die geen
 * rewrites nodig heeft, wat hem op Vercel rechtstreeks vanaf de edge laat
 * serveren.
 */
import { api } from './lib/api.js';
import { tags, mount } from './lib/dom.js';
import { setReference, toast, modal, btn, seg, logList, empty, icon } from './lib/ui.js';
import { initials } from './lib/format.js';
import { renderLogin } from './views/login.js';

const { div, span, a, nav, main, header, button } = tags;

export const state = {
  user: null,
  capabilities: [],
  reference: {},
  notifications: [],
  counts: {},
  personas: { accounts: [], password: null },
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
  { path: '/access', load: () => import('./views/access.js'), title: 'Toegangsaanvragen' },
  { path: '/recipes', load: () => import('./views/recipes.js'), title: 'Recepturen' },
  { path: '/recipes/:id', load: () => import('./views/recipe-detail.js'), title: 'Receptuur' },
  { path: '/versions/:id', load: () => import('./views/version-detail.js'), title: 'Rekenblad' },
  { path: '/declarations', load: () => import('./views/declarations.js'), title: 'Declaraties' },
  { path: '/declarations/:id', load: () => import('./views/declaration-detail.js'), title: 'Dossier' },
  { path: '/verification', load: () => import('./views/verification.js'), title: 'Verificatiedossiers' },
  { path: '/verification/:id', load: () => import('./views/declaration-detail.js'), title: 'Dossier' },
  { path: '/projects', load: () => import('./views/projects.js'), title: 'Projecten' },
  { path: '/projects/:id', load: () => import('./views/project-detail.js'), title: 'Project' },
  { path: '/deliveries/:id', load: () => import('./views/delivery-detail.js'), title: 'Levering' },
  { path: '/sector', load: () => import('./views/sector.js'), title: 'Generieke waarden' },
  { path: '/reference', load: () => import('./views/reference.js'), title: 'Rekenregels' },
  { path: '/audit', load: () => import('./views/audit.js'), title: 'Audittrail' },
];

/** Navigatie per organisatietype, met icoon en teller zoals in het ontwerp. */
function navigation() {
  const type = state.user.orgType;
  const c = state.counts;

  const items = [
    { href: '#/', icon: 'chart', label: 'Overzicht', all: true },
    {
      href: '#/materials',
      icon: 'stack',
      label: type === 'SUPPLIER' ? 'Grondstoffen' : 'Grondstofcatalogus',
      badge: c.materials,
      all: true,
    },
    { href: '#/access', icon: 'lock', label: 'Toegangsaanvragen', badge: c.access, when: ['SUPPLIER', 'PRODUCER', 'CONTRACTOR'] },
    { href: '#/recipes', icon: 'list', label: 'Recepturen', badge: c.recipes, when: ['PRODUCER', 'VERIFIER', 'FEDERATION', 'REGULATOR'] },
    { href: '#/declarations', icon: 'fileText', label: 'Declaraties', badge: c.declarations, when: ['PRODUCER', 'FEDERATION', 'REGULATOR'] },
    { href: '#/verification', icon: 'sealCheck', label: 'Verificatiedossiers', badge: c.verification, when: ['VERIFIER'] },
    { href: '#/projects', icon: 'truck', label: 'Leveringen', badge: c.deliveries ?? c.projects, when: ['CONTRACTOR', 'PRODUCER', 'VERIFIER', 'REGULATOR'] },
    { href: '#/sector', icon: 'buildings', label: 'Generieke waarden', when: ['FEDERATION', 'REGULATOR', 'PRODUCER', 'VERIFIER'] },
    { href: '#/reference', icon: 'calculator', label: 'Rekenregels', all: true },
    { href: '#/audit', icon: 'history', label: 'Audittrail', all: true },
  ];

  return items.filter((item) => item.all || item.when.includes(type));
}

/* ------------------------------------------------------------------ */
/* Opstart                                                             */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    const [me, reference] = await Promise.all([api.get('/auth/me'), api.get('/reference')]);
    state.user = me.user;
    state.capabilities = me.capabilities;
    state.reference = reference;
    setReference(reference);
    await Promise.all([loadCounts(), loadPersonas()]);
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
  state.reference = await api.get('/reference');
  setReference(state.reference);
  await Promise.all([loadCounts(), loadPersonas()]);
  location.hash = '#/';
  renderShell();
  await route();
}

async function loadCounts() {
  try {
    const { counts } = await api.get('/navcounts');
    state.counts = counts;
  } catch {
    state.counts = {};
  }
}

async function loadPersonas() {
  try {
    state.personas = await api.get('/auth/demo-accounts');
  } catch {
    state.personas = { accounts: [], password: null };
  }
}

/* ------------------------------------------------------------------ */
/* Schil                                                               */
/* ------------------------------------------------------------------ */

let outlet;
let navHost;
let topbarRight;

function renderShell() {
  root.className = '';
  outlet = main({ class: 'main' });
  navHost = nav({ class: 'sidenav' });
  topbarRight = div({ class: 'topbar__right' });

  mount(
    root,
    div(
      { class: 'shell' },
      header(
        { class: 'topbar' },
        div(
          { class: 'wordmark' },
          span({ class: 'wordmark__name' }, 'Materia'),
          span({ class: 'wordmark__sub' }, 'Milieudeclaratie beton · Vlaanderen'),
        ),
        span({ class: 'chip-poc' }, 'Proof of concept'),
        topbarRight,
      ),
      div({ class: 'body' }, navHost, outlet),
    ),
  );

  renderTopbarRight();
  renderNav();
  refreshNotifications();
}

/**
 * De rolwissel uit het ontwerp. In de demo-opstelling meldt hij echt aan als
 * die persona in plaats van alleen de weergave te veranderen — anders zou het
 * platform rechten voorwenden die het niet afdwingt. Zonder demodata valt de
 * schakelaar gewoon weg.
 */
function renderTopbarRight() {
  const byType = new Map();
  for (const account of state.personas.accounts ?? []) {
    if (!byType.has(account.org_type)) byType.set(account.org_type, account);
  }

  const labels = state.reference.orgTypeLabels ?? {};
  const shortLabel = {
    SUPPLIER: 'Leverancier',
    PRODUCER: 'Producent',
    CONTRACTOR: 'Aannemer',
    VERIFIER: 'Verificateur',
    FEDERATION: 'Federatie',
    REGULATOR: 'Overheid',
  };

  const personaSwitch =
    byType.size > 1 && state.personas.password
      ? [
          span({ class: 'topbar__label' }, 'Rol'),
          seg(
            [...byType.keys()].map((type) => ({ key: type, label: shortLabel[type] ?? labels[type] ?? type })),
            state.user.orgType,
            async (type) => {
              const account = byType.get(type);
              if (!account || type === state.user.orgType) return;
              try {
                const session = await api.post('/auth/login', { email: account.email, password: state.personas.password });
                await onAuthenticated(session);
              } catch (err) {
                toast(err.message, 'bad');
              }
            },
          ),
        ]
      : [];

  mount(
    topbarRight,
    ...personaSwitch,
    notificationButton(),
    button(
      {
        class: 'usermenu',
        title: 'Afmelden',
        type: 'button',
        onClick: async () => {
          await api.post('/auth/logout');
          location.hash = '#/';
          location.reload();
        },
      },
      span({ class: 'avatar' }, initials(state.user.name)),
      span(
        { class: 'usermenu__text' },
        span({ class: 'usermenu__name' }, state.user.name),
        span({ class: 'usermenu__org' }, state.user.orgName),
      ),
      icon('signOut', { size: 15, className: 'muted' }),
    ),
  );
}

function renderNav() {
  const current = currentPath();
  const settings = state.reference.settings ?? {};

  mount(
    navHost,
    div({ class: 'sidenav__label' }, state.reference.orgTypeLabels?.[state.user.orgType] ?? state.user.orgType),
    navigation().map((item) => {
      const path = item.href.slice(1);
      const active = path === '/' ? current === '/' : current.startsWith(path);
      return a(
        { href: item.href, class: active ? 'is-active' : '' },
        icon(item.icon, { size: 17 }),
        span({ class: 'sidenav__text' }, item.label),
        item.badge ? span({ class: 'sidenav__badge' }, String(item.badge)) : null,
      );
    }),
    div(
      { class: 'sidenav__foot' },
      div({ class: 'sidenav__rule' }),
      'Rekenregels EN 15804+A2 · EN 16757',
      div({}, `Auto-validatie binnen ±${settings.bypass_tolerance_pct ?? 3}%`),
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
        { class: 'btn btn-ghost btn-sm', title: 'Meldingen', type: 'button', onClick: showNotifications },
        icon('bell', { size: 16 }),
        unseen ? span({ class: 'tag tag-accent', style: { padding: '0 5px' } }, String(unseen)) : null,
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
    /* meldingen zijn versiering; de toepassing mag er nooit op blijven hangen */
  }
}

function showNotifications() {
  modal({
    title: 'Meldingen',
    hint: 'Systeemberichten voor uw organisatie.',
    body: state.notifications.length
      ? logList(
          state.notifications.map((n) => ({ ts: n.created_at, actor_label: n.title, summary: n.body ?? '' })),
          { limit: 20 },
        )
      : empty('Geen meldingen'),
    actions: (close) => [btn('Sluiten', { variant: 'secondary', onClick: close })],
  });

  api
    .post('/notifications/seen')
    .then(() => {
      state.notifications = state.notifications.map((n) => ({ ...n, seen: 1 }));
      notificationHost?.refresh?.();
    })
    .catch(() => {});
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
    setTitle('Niet gevonden');
    mount(outlet, div({ class: 'empty' }, div({ class: 'empty__title' }, 'Deze pagina bestaat niet'), span({}, path)));
    return;
  }

  setTitle(matched.route.title);
  mount(outlet, div({ class: 'empty' }, 'Bezig met laden…'));

  try {
    const module = await matched.route.load();
    if (token !== renderToken) return; // een nieuwere navigatie won
    await module.render(outlet, { params: matched.params, setTitle, navigate, refresh });
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    mount(
      outlet,
      div(
        { class: 'banner banner--neutral' },
        icon('warning', { size: 19, className: 'banner__icon' }),
        div({}, div({ class: 'banner__title' }, 'Deze pagina kon niet geladen worden'), div({}, err.message)),
      ),
    );
  }
}

export function setTitle(title) {
  document.title = `${title} — Materia`;
}

export function navigate(path) {
  location.hash = path.startsWith('#') ? path : `#${path}`;
}

/** Tellers en meldingen opnieuw ophalen, bv. na een beslissing. */
export async function refresh() {
  await Promise.all([loadCounts(), refreshNotifications()]);
  renderNav();
}

window.addEventListener('hashchange', () => {
  route().catch((err) => toast(err.message, 'bad'));
});

boot();
