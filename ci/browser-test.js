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

// Views to smoke-test with their expected DOM landmark selectors.
// Selectors verified against actual container.innerHTML in each chunk (2026-06-06).
const VIEWS = [
  { id: 'calendar',    label: 'Calendar',    selector: '.calendar-page-layout' },
  { id: 'prospects',   label: 'Prospects',   selector: '.prospects-view' },
  { id: 'agents',      label: 'Agents',      selector: '.agents-view, #agents-table-body, .agents-table' },
  { id: 'reports',     label: 'Reports',     selector: '.kpi-dashboard' },
  { id: 'documents',   label: 'Documents',   selector: '.dms-view' },
  { id: 'performance', label: 'Performance', selector: '.ranking-view' },
  { id: 'milestones',  label: 'Milestones',  selector: '.milestone-view-wrap' },
  { id: 'noticeboard', label: 'Noticeboard', selector: '.nb-page' },
  { id: 'pipeline',    label: 'Pipeline',    selector: '.pipeline-dual-view' },
  { id: 'marketing_automation', label: 'Marketing', selector: '.marketing-view, .mktg-view, .workflow-view' },
];

const ADMIN_USER = {
  id: 1, username: 'admin', full_name: 'System Admin',
  role: 'Level 1 Super Admin', status: 'active',
  email: 'destinoraclessolution9@gmail.com',
};

async function injectAdminLogin(page) {
  await page.evaluate((user) => {
    // Hide login, show app shell
    const lc = document.getElementById('login-container');
    const shell = document.getElementById('app-shell');
    if (lc) lc.style.display = 'none';
    if (shell) { shell.style.display = 'flex'; shell.style.visibility = 'visible'; }

    // Set current user via the _appState bridge (has a setter since 2026-06-06).
    // The old window._currentUser trick set a *global*, not the IIFE's private var.
    if (window._appState) {
      window._appState.cu = user;
    }

    // Trigger nav visibility update so the sidebar shows the right items
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
    await sleep(3000);  // extra time for SW registration + init
    await injectAdminLogin(page);
    await sleep(1500);

    // ── Smoke test each view ──
    for (const view of VIEWS) {
      consoleErrors.length = 0;
      console.log(`\nTesting view: ${view.label} (${view.id})`);

      try {
        await page.evaluate((viewId) => {
          if (window.app && window.app.navigateTo) window.app.navigateTo(viewId);
        }, view.id);
        // 4s gives lazy chunks time to download + execute
        await sleep(4000);

        // Check DOM landmark exists
        const el = await page.$(view.selector).catch(() => null);
        const rendered = !!el;

        // Check for JS errors — exclude expected network noise from offline/unauthenticated mode:
        // 400/401/403 from Supabase (mock login has no real session), CDN 404s (Vercel analytics
        // not available on localhost), and generic network failures.
        const jsErrors = consoleErrors.filter(e =>
          !e.includes('supabase') &&
          !e.includes('Failed to fetch') &&
          !e.includes('net::ERR') &&
          !e.includes('status of 400') &&
          !e.includes('status of 401') &&
          !e.includes('status of 403') &&
          !e.includes('status of 404') &&
          !e.includes('_vercel') &&
          !e.includes('posthog') &&
          !e.includes('analytics')
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
