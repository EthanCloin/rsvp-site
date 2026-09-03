// Run: cd tests/frontend && npm test   (or: node tests/frontend/e2e.mjs from the repo root)
// Needs playwright@1.56.1 in tests/frontend/node_modules and Chromium under $PLAYWRIGHT_BROWSERS_PATH.
// Starts the in-memory stub server on a free port, drives the page in headless Chromium,
// and writes screenshots to tests/frontend/screenshots/.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './stub-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(HERE, '../../static');
const SHOTS = path.join(HERE, 'screenshots');
const TZ = 'America/New_York';

const DUPLICATE_MSG = 'That name is already on the list';
const SLOW_DOWN_MSG = 'Slow down and try again in a minute';

function utcStamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    const candidates = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome'];
    for (const executablePath of candidates) {
      try { await fs.access(executablePath); return await chromium.launch({ executablePath }); } catch { /* next */ }
    }
    throw err;
  }
}

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log(`  ok   ${name}`); },
    (err) => { console.log(`  FAIL ${name}`); throw err; });
}

const events = JSON.parse(await fs.readFile(path.join(STATIC_DIR, 'events.json'), 'utf8'));
const sorted = [...events.events].sort((a, b) => new Date(a.start) - new Date(b.start));
const first = sorted[0];
const noEnd = sorted.find((e) => !e.end);

const stub = await startServer({ port: 0 });
console.log(`stub server at ${stub.url}`);
const browser = await launch();
let exitCode = 0;

try {
  await fs.mkdir(SHOTS, { recursive: true });

  const consoleErrors = [];
  const pageErrors = [];
  const attach = (page) => {
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
  };

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: TZ, locale: 'en-US', colorScheme: 'light' });
  const page = await ctx.newPage();
  attach(page);
  await page.goto(stub.url + '/');
  await page.waitForSelector('article.event');
  await page.waitForFunction(() => [...document.querySelectorAll('.rsvp-count')].every((n) => n.textContent !== 'Loading…'));

  await check('title and intro come from events.json', async () => {
    assert.equal(await page.title(), events.title);
    assert.equal(await page.locator('#page-title').textContent(), events.title);
    assert.equal(await page.locator('#page-intro').textContent(), events.intro);
  });

  await check('three cards render under day headings, sorted by start', async () => {
    assert.equal(await page.locator('article.event').count(), 3);
    const headings = await page.locator('h2.day-heading').allTextContents();
    assert.deepEqual(headings, ['Saturday, October 10', 'Sunday, October 11', 'Wednesday, October 14']);
    for (const h of await page.locator('section.day').all()) assert.equal(await h.locator('article.event').count(), 1);
    const ids = await page.locator('article.event').evaluateAll((els) => els.map((e) => e.id));
    assert.deepEqual(ids, sorted.map((e) => 'event-' + e.id));
    const time = (await page.locator('#event-sat-coffee .event-time').textContent()).replace(/[\u2009\u202f]/g, ' ');
    assert.equal(time, '10:00 AM – 12:00 PM');
    assert.match(await page.locator('#tz-note').textContent(), /EDT/);
    assert.equal(await page.locator('#event-sat-coffee .rsvp-count').textContent(), 'Nobody yet');
    // With no remembered name: every form is shown and no "You're going" badge is visible.
    assert.equal(await page.locator('form.rsvp-form:visible').count(), 3);
    assert.equal(await page.locator('.you-going:visible').count(), 0);
  });

  await check('honeypot exists, is offscreen, and is not display:none', async () => {
    const hp = page.locator('#event-sat-coffee input[name="website"]');
    assert.equal(await hp.count(), 1);
    assert.equal(await hp.getAttribute('tabindex'), '-1');
    assert.equal(await hp.getAttribute('autocomplete'), 'off');
    assert.equal(await hp.getAttribute('aria-hidden'), 'true');
    const info = await hp.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { display: getComputedStyle(el).display, right: r.right, bottom: r.bottom };
    });
    assert.notEqual(info.display, 'none');
    assert.ok(info.right < 0 || info.bottom < 0, `honeypot should be offscreen, got ${JSON.stringify(info)}`);
    assert.equal(await hp.evaluate((el) => el.value), '');
  });

  await check('.ics link has correct UID and UTC DTSTART/DTEND', async () => {
    const link = page.locator('#event-sat-coffee a.ics-link');
    assert.equal(await link.getAttribute('download'), `${first.id}.ics`);
    const href = await link.getAttribute('href');
    assert.ok(href.startsWith('blob:'), `expected blob: URL, got ${href}`);
    const ics = await page.evaluate((u) => fetch(u).then((r) => r.text()), href);
    assert.ok(ics.includes('BEGIN:VCALENDAR'));
    assert.ok(ics.includes('BEGIN:VEVENT'));
    assert.ok(ics.includes(`UID:${first.id}@come-see.ethancloin.xyz`));
    assert.ok(ics.includes(`DTSTART:${utcStamp(first.start)}`), `DTSTART should be ${utcStamp(first.start)}\n${ics}`);
    assert.ok(ics.includes(`DTEND:${utcStamp(first.end)}`));
    assert.ok(ics.includes(`SUMMARY:${first.title}`));
    assert.ok(ics.includes(`LOCATION:${first.address.replace(/,/g, '\\,')}`));
    assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
    assert.ok(!/[^\r]\n/.test(ics), 'all line endings should be CRLF');
    for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
    assert.equal(utcStamp(first.start), '20261010T140000Z');
  });

  await check('Google Calendar link has dates in UTC', async () => {
    const href = await page.locator('#event-sat-coffee a.gcal-link').getAttribute('href');
    assert.ok(href.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'));
    assert.ok(href.includes('dates=20261010T140000Z/20261010T160000Z'), href);
    assert.ok(href.includes(`dates=${utcStamp(first.start)}/${utcStamp(first.end)}`));
    assert.ok(href.includes('text=' + encodeURIComponent(first.title)));
    assert.ok(href.includes('location=' + encodeURIComponent(first.address)));
    assert.ok(href.includes('details=' + encodeURIComponent(first.description)));
    // Missing end -> start + 2h.
    const plus2h = new Date(new Date(noEnd.start).getTime() + 2 * 3600 * 1000).toISOString();
    const noEndHref = await page.locator(`#event-${noEnd.id} a.gcal-link`).getAttribute('href');
    assert.ok(noEndHref.includes(`dates=${utcStamp(noEnd.start)}/${utcStamp(plus2h)}`), noEndHref);
  });

  await page.screenshot({ path: path.join(SHOTS, 'mobile-390x844.png') });

  await check('submitting a name adds it to the list and updates the count', async () => {
    const card = page.locator('#event-sat-coffee');
    await card.locator('input[name="display_name"]').fill('Sam');
    await card.locator('button[type="submit"]').click();
    await card.locator('.rsvp-list li', { hasText: 'Sam' }).waitFor();
    assert.equal(await card.locator('.rsvp-count').textContent(), '1 going');
    assert.deepEqual(await card.locator('.rsvp-list li').allTextContents(), ['Sam']);
    await card.locator('.you-going').waitFor({ state: 'visible' });
    assert.equal(await card.locator('form.rsvp-form').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('come-see:name')), 'Sam');
    // Other forms are prefilled with the remembered name.
    assert.equal(await page.locator('#event-sun-dinner input[name="display_name"]').inputValue(), 'Sam');
    assert.equal(stub.rsvps.get('sat-coffee').length, 1);
  });

  await check('a second, different name bumps the count', async () => {
    const ctx2 = await browser.newContext({ timezoneId: TZ, locale: 'en-US' });
    const p2 = await ctx2.newPage();
    attach(p2);
    await p2.goto(stub.url + '/');
    const card = p2.locator('#event-sat-coffee');
    await card.locator('input[name="display_name"]').fill('Alex');
    await card.locator('button[type="submit"]').click();
    await card.locator('.rsvp-list li', { hasText: 'Alex' }).waitFor();
    assert.equal(await card.locator('.rsvp-count').textContent(), '2 going');
    await ctx2.close();
  });

  await check('reload with a remembered name shows "You\'re going" and hides the form', async () => {
    await page.reload();
    const card = page.locator('#event-sat-coffee');
    await card.locator('.you-going').waitFor({ state: 'visible' });
    assert.equal(await card.locator('form.rsvp-form').isVisible(), false);
    assert.equal(await card.locator('.rsvp-count').textContent(), '2 going');
    assert.equal(await page.locator('#event-sun-dinner form.rsvp-form').isVisible(), true);
  });

  await check('submitting a duplicate name shows the 409 message', async () => {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const card = page.locator('#event-sat-coffee');
    await card.locator('form.rsvp-form').waitFor({ state: 'visible' });
    assert.equal(await card.locator('.you-going').isVisible(), false);
    await card.locator('input[name="display_name"]').fill('  sam ');
    await card.locator('button[type="submit"]').click();
    await card.locator('.form-error', { hasText: DUPLICATE_MSG }).waitFor();
    assert.equal(await card.locator('.form-error').getAttribute('aria-live'), 'polite');
    assert.equal(await card.locator('button[type="submit"]').isDisabled(), false);
    assert.equal(await card.locator('.rsvp-count').textContent(), '2 going');
  });

  await check('a 429 shows the slow-down message', async () => {
    const card = page.locator('#event-sun-dinner');
    await card.locator('input[name="display_name"]').fill('ratelimit');
    await card.locator('button[type="submit"]').click();
    await card.locator('.form-error', { hasText: SLOW_DOWN_MSG }).waitFor();
    assert.equal(await card.locator('.rsvp-count').textContent(), 'Nobody yet');
  });

  await check('a 400 shows the server message; a network failure shows a generic one', async () => {
    const card = page.locator('#event-wed-trivia');
    await card.locator('input[name="display_name"]').fill('x'.repeat(40));
    await page.route('**/api/events/wed-trivia/rsvps', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_name', message: 'Name contains control characters' }) });
    });
    await card.locator('button[type="submit"]').click();
    await card.locator('.form-error', { hasText: 'Name contains control characters' }).waitFor();
    await page.unroute('**/api/events/wed-trivia/rsvps');
    await page.route('**/api/events/wed-trivia/rsvps', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    await card.locator('button[type="submit"]').click();
    await card.locator('.form-error', { hasText: 'Something went wrong' }).waitFor();
    await page.unroute('**/api/events/wed-trivia/rsvps');
  });

  await check('a failed events.json shows an error, not a blank page', async () => {
    const ctx3 = await browser.newContext({ timezoneId: TZ });
    const p3 = await ctx3.newPage();
    attach(p3);
    await p3.route('**/events.json', (route) => route.fulfill({ status: 500, body: 'nope' }));
    await p3.goto(stub.url + '/');
    await p3.locator('#status', { hasText: "Couldn't load the events" }).waitFor();
    await ctx3.close();
  });

  await check('desktop screenshot (dark scheme)', async () => {
    const ctx4 = await browser.newContext({ viewport: { width: 1200, height: 800 }, timezoneId: TZ, locale: 'en-US', colorScheme: 'dark' });
    const p4 = await ctx4.newPage();
    attach(p4);
    await p4.addInitScript(() => { try { localStorage.setItem('come-see:name', 'Sam'); } catch {} });
    await p4.goto(stub.url + '/');
    await p4.locator('#event-sat-coffee .you-going').waitFor({ state: 'visible' });
    await p4.screenshot({ path: path.join(SHOTS, 'desktop-1200x800.png') });
    await ctx4.close();
  });

  await check('no console errors from page code', async () => {
    // Chromium logs "Failed to load resource: ... 409/429/400" for the error responses we
    // deliberately triggered above; those are network status logs, not errors from app.js.
    const expected = /Failed to load resource: (the server responded with a status of (400|409|429|500)|net::ERR_FAILED)/;
    const unexpected = consoleErrors.filter((t) => !expected.test(t));
    assert.deepEqual(pageErrors, [], 'uncaught page errors');
    assert.deepEqual(unexpected, [], 'unexpected console errors');
  });

  await ctx.close();
  console.log(`\n${passed} checks passed`);
} catch (err) {
  exitCode = 1;
  console.error('\nE2E FAILED');
  console.error(err);
} finally {
  await browser.close();
  await stub.close();
}
process.exit(exitCode);
