import { Router } from '../router.js';
import { ok, str, setSessionCookie, clearSessionCookie, unauthorised, parseCookies, noContent } from '../respond.js';
import { login, logout, demoAccounts } from '../../lib/auth.js';
import { record } from '../../lib/audit.js';
import { can } from '../../domain/permissions.js';

const router = new Router();

router.post(
  '/login',
  async ({ res, body }) => {
    const email = str(body.email, 'email', { required: true });
    const password = str(body.password, 'wachtwoord', { required: true });

    const session = await login(email, password);
    if (!session) throw unauthorised('Onbekend e-mailadres of verkeerd wachtwoord.');

    setSessionCookie(res, session.token, session.expires);
    await record(session.user, 'LOGIN', { type: 'USER', id: session.user.id }, `${session.user.name} heeft zich aangemeld.`);
    ok(res, { user: session.user, token: session.token, capabilities: capabilitiesOf(session.user) });
  },
  { public: true },
);

router.post('/logout', async ({ req, res, user }) => {
  const cookies = parseCookies(req.headers.cookie);
  await logout(cookies.epd_session);
  clearSessionCookie(res);
  await record(user, 'LOGOUT', { type: 'USER', id: user.id }, `${user.name} heeft zich afgemeld.`);
  noContent(res);
});

router.get('/me', async ({ res, user }) => {
  ok(res, { user, capabilities: capabilitiesOf(user) });
});

/**
 * The demo login screen lists the personas so a pitch audience can jump between
 * roles. In a real deployment this route disappears together with the password
 * login, replaced by the identity provider.
 */
router.get(
  '/demo-accounts',
  async ({ res }) => {
    if (process.env.DEMO_DATA === '0') return ok(res, { accounts: [], password: null });
    ok(res, { accounts: await demoAccounts(), password: 'demo1234' });
  },
  { public: true },
);

/** Flattened capability list, so the client can hide what it may not do. */
export function capabilitiesOf(user) {
  const all = [
    'materials:write',
    'evidence:write',
    'access:decide',
    'access:request',
    'recipes:write',
    'declarations:submit',
    'declarations:readall',
    'declarations:readpublished',
    'verification:decide',
    'projects:write',
    'deliveries:write',
    'siteparams:write',
    'masterdata:write',
    'aggregation:write',
    'aggregation:read',
    'settings:write',
    'audit:read',
    'catalogue:read',
    'materials:readall',
    'sites:write',
  ];
  return all.filter((c) => can(user, c));
}

export default router;
