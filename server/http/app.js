/**
 * The request handler.
 *
 * Shared by both entry points: `server/index.js` wraps it in a node:http
 * server for local use, `api/index.js` hands it Vercel's (req, res) pair. Which
 * one is running changes nothing about the routing.
 */
import { ready } from '../db/index.js';
import { userForToken, purgeExpiredSessions } from '../lib/auth.js';
import { Forbidden } from '../domain/permissions.js';
import { Router } from './router.js';
import { fail, json, parseCookies, readBody, unauthorised } from './respond.js';
import { serveStatic } from './static.js';

import authRoutes from './routes/auth.js';
import referenceRoutes from './routes/reference.js';
import dashboardRoutes from './routes/dashboard.js';
import materialRoutes from './routes/materials.js';
import accessRoutes from './routes/access.js';
import recipeRoutes from './routes/recipes.js';
import declarationRoutes from './routes/declarations.js';
import projectRoutes from './routes/projects.js';
import aggregationRoutes from './routes/aggregation.js';
import auditRoutes from './routes/audit.js';

const router = new Router();
router.use('/api/auth', authRoutes);
router.use('/api', referenceRoutes);
router.use('/api', dashboardRoutes);
router.use('/api', materialRoutes);
router.use('/api', accessRoutes);
router.use('/api', recipeRoutes);
router.use('/api', declarationRoutes);
router.use('/api', projectRoutes);
router.use('/api', aggregationRoutes);
router.use('/api', auditRoutes);

let lastPurge = 0;

export async function handleRequest(req, res, { serveAssets = false } = {}) {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname.replace(/\/{2,}/g, '/');

    if (!pathname.startsWith('/api/')) {
      if (serveAssets) return serveStatic(req, res, pathname);
      return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Onbekend eindpunt.' } });
    }

    await ready();

    // Cheap housekeeping, at most once a minute per instance.
    if (Date.now() - lastPurge > 60_000) {
      lastPurge = Date.now();
      purgeExpiredSessions().catch(() => {});
    }

    const matched = router.match(req.method, pathname);
    if (!matched) return json(res, 404, { error: { code: 'NOT_FOUND', message: `Onbekend eindpunt: ${pathname}` } });
    if (matched.methodMismatch) {
      return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} is hier niet toegelaten.` } });
    }

    const { route, params } = matched;
    const cookies = parseCookies(req.headers.cookie);
    const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const user = await userForToken(cookies.epd_session ?? bearer ?? null);

    if (!route.public && !user) throw unauthorised();

    const ctx = {
      req,
      res,
      user,
      params,
      query: Object.fromEntries(url.searchParams.entries()),
      url,
      body: ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {},
    };

    await route.handler(ctx);
  } catch (err) {
    if (err instanceof Forbidden) return fail(res, err);
    return fail(res, err);
  }
}

export default handleRequest;
