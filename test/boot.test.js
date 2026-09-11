/**
 * Wat een mislukte uitrol te zien geeft.
 *
 * Dit bestand raakt met opzet geen databank aan en gebruikt helpers.js niet:
 * het gaat juist over het geval waarin er geen databank ís. Twee keer op rij
 * kwam een uitrolprobleem bij de gebruiker aan als "er ging intern iets mis",
 * met de eigenlijke reden alleen in een serverlogboek. Die vertaalslag is
 * hieronder vastgelegd, zodat ze niet stilletjes terug kan verdwijnen.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail, HttpError } from '../server/http/respond.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Een minimale res die alleen onthoudt wat erop geschreven werd. */
function capture() {
  return {
    statusCode: null,
    payload: null,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(body) {
      this.payload = body ? JSON.parse(body) : null;
    },
  };
}

describe('foutantwoorden', () => {
  test('een 500 houdt de boodschap neutraal maar geeft de technische reden mee', () => {
    const res = capture();
    fail(res, new TypeError('kolom "listed" bestaat niet'));

    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.error.code, 'INTERNAL');
    assert.match(res.payload.error.message, /intern iets mis/);
    assert.equal(res.payload.error.detail, 'TypeError: kolom "listed" bestaat niet');
  });

  test('EPD_VERBOSE_ERRORS=0 laat de technische reden weg', () => {
    const res = capture();
    process.env.EPD_VERBOSE_ERRORS = '0';
    try {
      fail(res, new Error('interne details'));
    } finally {
      delete process.env.EPD_VERBOSE_ERRORS;
    }
    assert.equal(res.payload.error.detail, null);
  });

  test('een fout onder de 500 spreekt gewoon voor zichzelf', () => {
    const res = capture();
    fail(res, new HttpError(409, 'Deze versie is al afgesloten.', 'CONFLICT'));

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.error.message, 'Deze versie is al afgesloten.');
    assert.equal(res.payload.error.detail, null, 'geen technische ruis bij een boodschap die al klopt');
  });
});

describe('opstart zonder bereikbare databank', () => {
  test('elk eindpunt antwoordt 503 met de diagnose erbij, niet 500', async () => {
    const port = 3200 + (process.pid % 300);
    const child = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        // Een poort waar met zekerheid niets luistert.
        DATABASE_URL: 'postgres://niemand:niets@127.0.0.1:59991/bestaatniet',
        EPD_DB: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await waitForPort(`http://127.0.0.1:${port}/api/health`, child);

      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(health.status, 503);
      const info = await health.json();
      assert.equal(info.ready, false);
      assert.equal(info.driver, 'postgres');
      assert.match(info.error, /ECONNREFUSED/);

      // Het punt van deze test: een gewoon eindpunt mag hier geen kale 500
      // geven. Dan staat de reden alleen in een logboek dat de melder niet ziet.
      const response = await fetch(`http://127.0.0.1:${port}/api/reference`);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
      assert.match(body.error.detail, /ECONNREFUSED/);
      assert.equal(body.health.databaseUrlSet, true);
    } finally {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    }
  });
});

/** Wachten tot de server luistert; hij start bewust ook als de databank faalt. */
async function waitForPort(url, child, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (child.exitCode !== null) throw new Error(`de server stopte met code ${child.exitCode}`);
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`server op ${url} kwam niet op tijd omhoog`);
}
