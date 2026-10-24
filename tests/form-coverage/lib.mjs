// Shared helpers for the form coverage tests: log in, open a form, run
// Sutram commands in the page, clean up test nodes.
//
// Each test gets its own browser context (own session), so groups can run at
// the same time against the same site.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

export { assert };
export const SITE = process.env.SITE || 'https://drupal-sutram-demo.ddev.site';
export const DEMO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const BUNDLE = 'sutram_form_test';
export const FORM = 'node-sutram-form-test-form';
export const EDIT_FORM = 'node-sutram-form-test-edit-form';
// Every node a test creates starts with this, so cleanup finds them.
export const PREFIX = '[form-coverage]';

export const drush = (...args) =>
  execFileSync('ddev', ['drush', ...args], {
    cwd: DEMO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

let browser;
export async function launch() {
  browser ??= await chromium.launch({ headless: !process.env.HEADED });
  return browser;
}
export async function close() {
  if (browser) await browser.close();
  browser = undefined;
}

/** A logged-in page in a fresh context, as the admin (uid 1). */
export async function session() {
  const b = await launch();
  const ctx = await b.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1400, height: 1000 },
  });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.error(`  [pageerror] ${err.message}`));
  await login(page);
  return new Session(ctx, page);
}

const LOCK = path.join(os.tmpdir(), 'sutram-form-coverage-login.lock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Logs in with a one-time link from drush uli.
 *
 * A link stops working once anyone logs in as that user (its hash includes
 * the last login time), so logins take turns, across processes too, through
 * a lock directory; a login that did not take is tried again.
 */
async function login(page) {
  for (let attempt = 1; ; attempt++) {
    for (;;) {
      try {
        fs.mkdirSync(LOCK);
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        // A lock older than a minute was left by a crashed run.
        if (Date.now() - fs.statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs > 60000) fs.rmSync(LOCK, { recursive: true, force: true });
        await sleep(200);
      }
    }
    try {
      await page.goto(drush('uli', '--no-browser', `--uri=${SITE}`));
      await page.waitForLoadState('load');
    } finally {
      fs.rmSync(LOCK, { recursive: true, force: true });
    }
    if (await page.evaluate(() => document.body.classList.contains('user-logged-in'))) return;
    if (attempt === 5) throw new Error(`login failed: ${page.url()}`);
  }
}

export class Session {
  constructor(ctx, page) {
    this.ctx = ctx;
    this.page = page;
  }

  async close() {
    await this.ctx.close();
  }

  /** Opens a path and waits until Sutram's commands are registered. */
  async open(pathname) {
    await this.page.goto(SITE + pathname);
    await this.ready();
  }

  async ready() {
    await this.page.waitForFunction(() => window.Sutram && window.Sutram.ready, null, {
      timeout: 20000,
    });
    await this.page.evaluate(() => window.Sutram.ready);
  }

  /** Opens the add form of the test content type. */
  add() {
    return this.open(`/node/add/${BUNDLE}`);
  }

  /** Opens the edit form of a node. */
  edit(nid) {
    return this.open(`/node/${nid}/edit`);
  }

  /** Runs a command, confirmed, and returns { code, text, data, message }. */
  call(name, input = {}) {
    return this.page.evaluate(
      ([n, i]) => window.Sutram.call(n, i, { confirmed: true }),
      [name, input],
    );
  }

  /** Runs a command and fails unless it exits 0. */
  async ok(name, input = {}) {
    const r = await this.call(name, input);
    assert.equal(r.code, 0, `${name} ${JSON.stringify(input)} → ${r.code}: ${r.message || r.text}`);
    return r;
  }

  /** The fields of a form, by path. */
  async fields(form = FORM) {
    const r = await this.ok('form fields', { form });
    return Object.fromEntries(r.data.fields.map((f) => [f.field, f]));
  }

  /** form save, then waits for the page that follows. */
  async save(form = FORM) {
    const nav = this.page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });
    const r = await this.ok('form save', { form });
    await nav;
    await this.ready();
    return r;
  }

  /** The node id of the node page we are on, or null. */
  async nid() {
    return this.page.evaluate(() => {
      const m = document.querySelector('link[rel="shortlink"]')?.getAttribute('href')?.match(/\/node\/(\d+)/)
        || location.pathname.match(/^\/node\/(\d+)/);
      return m ? Number(m[1]) : null;
    });
  }
}

/** A title for a test node: recognisable, unique enough. */
export const title = (group, what = '') =>
  `${PREFIX} ${group}${what ? ` ${what}` : ''} ${Date.now().toString(36)}`;

/** Deletes the test nodes, all or one group's. Content only, never config. */
export function cleanup(group = '') {
  const like = `${PREFIX} ${group}%`.replace(/'/g, "''");
  const nids = drush(
    'sql:query',
    `SELECT nid FROM node_field_data WHERE type = '${BUNDLE}' AND title LIKE '${like}'`,
  )
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  if (nids.length) drush('entity:delete', 'node', nids.join(','));
  return nids.length;
}

/**
 * Deletes file entities a test uploaded (and so their files), temporary or
 * permanent. Call it after cleanup(): Drupal keeps a file a node still uses.
 */
export function deleteFiles(fids, group = '') {
  const list = [...new Set([...fids].map(Number).filter(Boolean))];
  if (!list.length) return 0;
  try {
    drush('entity:delete', 'file', list.join(','));
  } catch (err) {
    console.error(`  ${group}: could not delete files ${list}: ${err.message}`);
  }
  return list.length;
}

/**
 * Runs named steps, reporting each. Returns the number of failures.
 */
export async function steps(group, list) {
  let failed = 0;
  for (const [name, fn] of list) {
    const t = Date.now();
    try {
      await fn();
      console.log(`  ok   ${group}: ${name} (${Date.now() - t} ms)`);
    } catch (err) {
      failed++;
      console.log(`  FAIL ${group}: ${name}\n       ${String(err && (err.stack || err)).split('\n').slice(0, 6).join('\n       ')}`);
    }
  }
  return failed;
}
