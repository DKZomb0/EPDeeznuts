/**
 * Test scaffolding: an isolated database per test file, seeded with the demo
 * dataset so tests can assert against a realistic chain rather than fixtures
 * invented for the test.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'epd-test-'));
process.env.EPD_DB = join(dir, 'test.db');
process.env.DEMO_DATA = '1';
delete process.env.DATABASE_URL;

const db = await import('../server/db/index.js');
await db.ready();

export { db };

export async function teardown() {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
}

export async function org(type) {
  return db.get('SELECT * FROM organisations WHERE type = ? ORDER BY name LIMIT 1', [type]);
}

export async function userOf(orgName) {
  const row = await db.get(
    `SELECT u.*, o.name AS org_name, o.type AS org_type
       FROM users u JOIN organisations o ON o.id = u.org_id
      WHERE o.name = ? LIMIT 1`,
    [orgName],
  );
  if (!row) throw new Error(`no user for organisation ${orgName}`);
  return { id: row.id, name: row.name, role: row.role, orgId: row.org_id, orgName: row.org_name, orgType: row.org_type };
}

export async function recipeByCode(code) {
  return db.get('SELECT * FROM recipes WHERE code = ? LIMIT 1', [code]);
}

export async function activeVersionOf(code) {
  return db.get(
    `SELECT rv.* FROM recipe_versions rv JOIN recipes r ON r.id = rv.recipe_id
      WHERE r.code = ? AND rv.status = 'ACTIVE' ORDER BY rv.version_no DESC LIMIT 1`,
    [code],
  );
}

/* ------------------------------------------------------------------ */
/* HTTP harness                                                        */
/* ------------------------------------------------------------------ */

export async function startServer() {
  const { handleRequest } = await import('../server/http/app.js');
  const server = createServer((req, res) => {
    handleRequest(req, res, { serveAssets: false }).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  /** A client that keeps its session cookie, like a browser would. */
  const client = () => {
    let cookie = null;
    const call = async (method, path, body) => {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    };
    return {
      get: (path) => call('GET', path),
      post: (path, body) => call('POST', path, body ?? {}),
      patch: (path, body) => call('PATCH', path, body ?? {}),
      async login(email, password = 'demo1234') {
        const res = await call('POST', '/auth/login', { email, password });
        if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.body?.error?.message}`);
        return res.body;
      },
    };
  };

  return { base, server, client, close: () => new Promise((resolve) => server.close(resolve)) };
}
