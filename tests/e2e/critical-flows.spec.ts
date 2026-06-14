/**
 * Phase 0 (#10) — Playwright e2e on the critical flows. This is the behavioral
 * safety net that must stay green before any Phase 1–4 refactor ships.
 *
 * Run:
 *   E2E_BASE_URL=http://localhost:8082 E2E_EMAIL=... E2E_PASSWORD=... npx playwright test
 *
 * Without E2E_EMAIL/E2E_PASSWORD the authed specs skip (so CI stays green until a
 * dedicated Supabase TEST project + seeded account is wired — do NOT point these
 * at production data).
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:8082';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const authed = test.extend({});

async function login(page: Page) {
  await page.goto(BASE);
  await page.getByRole('textbox', { name: /email/i }).fill(EMAIL!);
  await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD!);
  await page.getByRole('button', { name: /login/i }).click();
  await expect(page.locator('#app-shell')).toBeVisible({ timeout: 15000 });
}

test.describe('boot + auth', () => {
  test('login page renders with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(BASE);
    await expect(page.getByRole('button', { name: /login/i })).toBeVisible();
    expect(errors, 'no console errors on boot').toEqual([]);
  });
});

authed.describe('critical flows (require E2E_EMAIL/E2E_PASSWORD)', () => {
  authed.beforeEach(async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL / E2E_PASSWORD against a TEST Supabase project');
    await login(page);
  });

  authed('customers list renders + paginates', async ({ page }) => {
    await page.evaluate(() => { (window as any).__SERVER_TABLES = true; });   // exercise the Phase 1 path
    await page.getByRole('link', { name: /customers/i }).click();
    await expect(page.locator('#customers-table-body tr').first()).toBeVisible();
    const pager = page.locator('#customers-pagination');
    if (await pager.getByRole('button', { name: /next/i }).isEnabled()) {
      await pager.getByRole('button', { name: /next/i }).click();
      await expect(page.locator('#customers-table-body tr').first()).toBeVisible();
    }
  });

  authed('customer search filters server-side', async ({ page }) => {
    await page.evaluate(() => { (window as any).__SERVER_TABLES = true; });
    await page.getByRole('link', { name: /customers/i }).click();
    await page.locator('#customer-search').fill('a');
    await page.waitForTimeout(600); // debounce
    await expect(page.locator('#customers-table-body tr')).not.toHaveCount(0);
  });

  authed('create prospect → appears in list', async ({ page }) => {
    await page.getByRole('link', { name: /prospects/i }).click();
    // flow-specific selectors filled here once seeded test data exists
    test.fixme(true, 'wire create-prospect selectors against seeded test project');
  });

  authed('convert prospect → customer (live flow, not the deleted confirmConvertToCustomer)', async () => {
    test.fixme(true, 'wire convertToCustomer → showConversionApprovalModal happy path');
  });

  authed('calendar masks other agents\' client names', async () => {
    test.fixme(true, 'log in as agent B, assert agent A\'s public activity shows type, not client name');
  });

  authed('offline create → syncs on reconnect', async () => {
    test.fixme(true, 'go offline, create activity, reconnect, assert sync-queue drains');
  });
});
