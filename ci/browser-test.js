#!/usr/bin/env node
/**
 * ci/browser-test.js — Puppeteer smoke tests
 *
 * Starts the dev server, visits key views with a mock admin login,
 * checks for console errors, and verifies key DOM landmarks render.
 *
 * Prerequisites:
 *   python -m http.server 8082   (or already running)
 *   npm install puppeteer        (installed)
 *
 * Usage:
 *   node ci/browser-test.js
 *
 * Exit 0 = all pass. Exit 1 = failures.
 */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BASE = 'http://localhost:8082';
const TIMEOUT = 15000;

// Views to smoke-test with their expected DOM landmark selectors
const VIEWS = [
  { id: 'calendar',    label: 'Calendar',       selector: '.calendar-view, #calendar-container, .fc' },
  { id: 'prospects',   label: 'Prospects',       selector: '#prospects-table-body, .prospects-view' },
  { id: 'agents',      label: 'Agents',          selector: '.agents-view, #agents-table-body' },
  { id: 'reports',     label: 'Reports',         selector: '.reports-view, #reports-container' },
  { id: 'documents',   label: 'Documents',       selector: '.documents-view, #documents-container' },
  { id: 'performance', label: 'Performance',     selector: '.ranking-view, .performance-view' },
  { id: 'milestones',  label: 'Milestones',      selector: '.milestone-view-wrap, .milestone-view' },
  { id: 'noticeboard', label: 'Noticeboard',     selector: '.noticeboard-view, .notice-container' },
];

const ADMIN_USER = {
  id: 1, username: 'admin', full_name: 'System Admin',
  role: 'Level 1 Super Admin', status: 'active',
  email: 'destinoraclessolution9@gmail.com',
};

async function injectAdminLogin(page) {
  await page.evaluate((user) => {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-shell').style.display = 'flex';
    window._currentUser = user;
    if (window._appState) window._appState._forcedUser = user;
    if (window.app && window.app.updateNavVisibility) window.app.updateNavVisibility();
  }, ADMIN_USER);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  let server = null;
  let browser = null;
  const results = [];
  let passed = 0, failed = 0;

  try {
    // ── Start dev server if not already running ──
    try {
      const res = await fetch(BASE + '/index.html').catch(() => null);
      if (!res || !res.ok) throw new Error('not running');
      console.log('Dev server already running at', BASE);
    } catch {
      console.log('Starting dev server...');
      server = spawn('python', ['-m', 'http.server', '8082'], {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'pipe',
      });
      await sleep(2000);
    }

    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // Capture console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message));

    // ── Load and bypass login ──
    console.log('\nLoading app...');
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    await sleep(2000);
    await injectAdminLogin(page);
    await sleep(1000);

    // ── Smoke test each view ──
    for (const view of VIEWS) {
      consoleErrors.length = 0;
      console.log(`\nTesting view: ${view.label} (${view.id})`);

      try {
        await page.evaluate((viewId) => {
          if (window.app && window.app.navigateTo) window.app.navigateTo(viewId);
        }, view.id);
        await sleep(2500);

        // Check DOM landmark exists
        const el = await page.$(view.selector).catch(() => null);
        const rendered = !!el;

        // Check for JS errors in this view
        const jsErrors = consoleErrors.filter(e =>
          !e.includes('supabase') && !e.includes('Failed to fetch') &&
          !e.includes('net::ERR')
        );

        const status = rendered && jsErrors.length === 0 ? 'PASS' : 'FAIL';
        if (status === 'PASS') passed++; else failed++;

        results.push({ view: view.label, status, rendered, jsErrors });
        console.log(`  ${status === 'PASS' ? '✅' : '❌'} ${view.label}: rendered=${rendered}, errors=${jsErrors.length}`);
        if (jsErrors.length) jsErrors.slice(0, 2).forEach(e => console.log('     ' + e.slice(0, 120)));

      } catch (e) {
        failed++;
        results.push({ view: view.label, status: 'ERROR', error: e.message });
        console.log(`  ❌ ${view.label}: ${e.message.slice(0, 100)}`);
      }
    }

  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════');
  console.log(`Browser tests: ${passed}/${passed + failed} PASS`);
  results.forEach(r => {
    const sym = r.status === 'PASS' ? '✅' : '❌';
    console.log(`  ${sym} ${r.view}`);
  });
  console.log('═══════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
