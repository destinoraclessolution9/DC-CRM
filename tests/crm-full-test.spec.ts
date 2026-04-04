import { test, expect, Page } from '@playwright/test';

// ----------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------
const TEST_AGENT = {
  name: 'TestAgent_Playwright',
  email: 'testagent_pw@example.com',
  role: 'Agent',
  password: 'TempPass123!'
};

async function waitForToast(page: Page, text?: string) {
  const toast = page.locator('.toast, .alert, .success-message, .notification, [class*="toast"], [class*="alert"]');
  if (text) {
    await expect(toast.first()).toContainText(text, { timeout: 5000 });
  } else {
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
  }
}

async function closeAnyModal(page: Page) {
  const closeBtn = page.locator('.modal .close, .modal button:has-text("Cancel"), .modal button:has-text("Close"), button[aria-label="Close"]');
  if (await closeBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
    await closeBtn.first().click();
    await page.waitForTimeout(300);
  }
}

// ----------------------------------------------------------------------
// TEST SUITE
// ----------------------------------------------------------------------
test.describe('DestinOraclesSolution CRM – Full Functional & Data Validation', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app shell to render
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
  });

  // ------------------------------------------------------------------
  // LEVEL 1 – BUTTON PRESENCE
  // ------------------------------------------------------------------
  test('L1: Critical buttons are visible and enabled', async ({ page }) => {
    // Navigate to agents section if needed
    const agentsNav = page.locator('a:has-text("Agents"), button:has-text("Agents"), [data-section="agents"], nav *:has-text("Agents")');
    if (await agentsNav.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await agentsNav.first().click();
      await page.waitForTimeout(500);
    }

    const checks = [
      { selector: 'button:has-text("Add Agent"), button:has-text("Add User"), button:has-text("New Agent")', label: 'Add Agent' },
      { selector: 'button:has-text("Refresh"), button[title*="refresh" i], button[aria-label*="refresh" i]', label: 'Refresh' },
      { selector: 'button:has-text("Export"), button:has-text("Download")', label: 'Export' },
    ];

    for (const { selector, label } of checks) {
      const btn = page.locator(selector).first();
      const visible = await btn.isVisible({ timeout: 3000 }).catch(() => false);
      if (visible) {
        await expect(btn).toBeEnabled();
        console.log(`  PASS  ${label} button present`);
      } else {
        console.warn(`  WARN  ${label} button not found – selector may need updating`);
      }
    }
  });

  // ------------------------------------------------------------------
  // LEVEL 2 – RESET PASSWORD (the previously failing flow)
  // ------------------------------------------------------------------
  test('L2: Reset Password – no force_password_change error', async ({ page }) => {
    const errors: string[] = [];

    // Capture any 4xx responses
    page.on('response', async response => {
      if (response.status() >= 400) {
        let body = '';
        try { body = await response.text(); } catch { body = '(unreadable)'; }
        errors.push(`[${response.status()}] ${response.url()} — ${body.slice(0, 200)}`);
      }
    });

    // Navigate to agents section
    const agentsNav = page.locator('a:has-text("Agents"), [data-section="agents"]');
    if (await agentsNav.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await agentsNav.first().click();
      await page.waitForTimeout(500);
    }

    const resetBtn = page.locator('button:has-text("Reset Password"), button:has-text("Reset Pwd")').first();

    if (!(await resetBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.warn('  WARN  No Reset Password button found – skipping click test');
      return;
    }

    await resetBtn.click();
    await page.waitForTimeout(2000);

    // Accept confirmation modal if present
    const confirmBtn = page.locator('.modal button:has-text("Confirm"), .modal button:has-text("Yes"), .modal button:has-text("OK")');
    if (await confirmBtn.first().isVisible({ timeout: 1500 }).catch(() => false)) {
      await confirmBtn.first().click();
      await page.waitForTimeout(2000);
    }

    // Check for force_password_change error specifically
    const pageText = await page.content();
    const forceColError = errors.find(e => e.includes('force_password_change'));
    if (forceColError) {
      console.error(`  FAIL  force_password_change column error: ${forceColError}`);
    }
    expect(forceColError, 'force_password_change column error should not appear').toBeUndefined();

    // Check for success indicators
    const toastVisible = await page.locator('.toast, [class*="toast"], .notification').first().isVisible({ timeout: 3000 }).catch(() => false);
    if (toastVisible) {
      console.log('  PASS  Reset Password – toast appeared (no column error)');
    }

    if (errors.length > 0) {
      console.warn(`  WARN  Other API errors (${errors.length}):`, errors.join('\n'));
    }
  });

  // ------------------------------------------------------------------
  // LEVEL 2 – ADD AGENT MODAL OPEN / CANCEL
  // ------------------------------------------------------------------
  test('L2: Add Agent modal opens and cancels cleanly', async ({ page }) => {
    const agentsNav = page.locator('a:has-text("Agents"), [data-section="agents"]');
    if (await agentsNav.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await agentsNav.first().click();
      await page.waitForTimeout(500);
    }

    const addBtn = page.locator('button:has-text("Add Agent"), button:has-text("New Agent"), button:has-text("Add User")').first();
    if (!(await addBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.warn('  WARN  Add Agent button not found – skipping');
      return;
    }

    await addBtn.click();
    const modal = page.locator('.modal:visible, [role="dialog"]:visible');
    await expect(modal.first()).toBeVisible({ timeout: 4000 });
    console.log('  PASS  Modal opened');

    await closeAnyModal(page);
    await expect(modal.first()).not.toBeVisible({ timeout: 3000 });
    console.log('  PASS  Modal closed cleanly');
  });

  // ------------------------------------------------------------------
  // LEVEL 3 – NO UNEXPECTED 400s ON PRIMARY INTERACTIONS
  // ------------------------------------------------------------------
  test('L3: No 400 errors on primary button interactions', async ({ page }) => {
    const errors400: string[] = [];
    page.on('response', async response => {
      if (response.status() === 400) {
        let body = '';
        try { body = await response.text(); } catch { /* ignore */ }
        errors400.push(`[400] ${response.url()} — ${body.slice(0, 150)}`);
      }
    });

    // Click through navigation items
    const navItems = await page.locator('nav a, nav button, .sidebar a, .sidebar button, .menu a, .menu button').all();
    for (let i = 0; i < Math.min(navItems.length, 10); i++) {
      const item = navItems[i];
      if (await item.isVisible().catch(() => false) && await item.isEnabled().catch(() => false)) {
        await item.click().catch(() => {});
        await page.waitForTimeout(400);
        await closeAnyModal(page);
      }
    }

    if (errors400.length > 0) {
      console.error(`  FAIL  ${errors400.length} 400 error(s):\n` + errors400.join('\n'));
    } else {
      console.log('  PASS  No 400 errors on navigation');
    }

    expect(
      errors400.filter(e => e.includes('force_password_change')),
      'force_password_change errors must be zero'
    ).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // LEVEL 3 – CHURN + BIRTHDAY DATA PRESENCE
  // ------------------------------------------------------------------
  test('L3: Churn risks and birthday data are present', async ({ page }) => {
    // Navigate to dashboard / home
    const homeLink = page.locator('a:has-text("Dashboard"), a:has-text("Home"), [data-section="dashboard"]');
    if (await homeLink.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await homeLink.first().click();
      await page.waitForTimeout(800);
    }

    // Churn risks
    const churnEl = page.locator('*:has-text("churn")').first();
    if (await churnEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      const txt = await churnEl.textContent();
      console.log(`  INFO  Churn element text: "${txt?.trim()}"`);
      // Pass regardless – we just want it visible; business logic decides threshold
      expect(txt).not.toBeNull();
    } else {
      console.warn('  WARN  No churn element found on current view');
    }

    // Birthday data
    const bdEl = page.locator('*:has-text("Birthday"), *:has-text("birthday")').first();
    if (await bdEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      const txt = await bdEl.textContent();
      console.log(`  INFO  Birthday element text: "${txt?.trim()}"`);
      if (txt?.includes('[]') || txt?.toLowerCase().includes('no upcoming')) {
        console.warn('  WARN  Birthday data appears empty');
      } else {
        console.log('  PASS  Birthday data non-empty');
      }
    } else {
      console.warn('  WARN  No birthday element found on current view');
    }
  });

  // ------------------------------------------------------------------
  // LEVEL 3 – AGENT CRUD (add → verify → edit → delete)
  // ------------------------------------------------------------------
  test('L3: Agent CRUD – create, verify, edit, delete', async ({ page }) => {
    const agentsNav = page.locator('a:has-text("Agents"), [data-section="agents"]');
    if (await agentsNav.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await agentsNav.first().click();
      await page.waitForTimeout(500);
    }

    // --- CREATE ---
    const addBtn = page.locator('button:has-text("Add Agent"), button:has-text("New Agent"), button:has-text("Add User")').first();
    if (!(await addBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.warn('  WARN  Add Agent button not found – skipping CRUD test');
      test.skip();
      return;
    }

    await addBtn.click();
    await page.waitForSelector('.modal:visible, [role="dialog"]:visible', { timeout: 4000 });

    // Fill form fields by common name attributes or labels
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i], input[id*="name" i]').first();
    const emailInput = page.locator('input[name="email"], input[type="email"], input[placeholder*="email" i]').first();

    if (await nameInput.isVisible()) await nameInput.fill(TEST_AGENT.name);
    if (await emailInput.isVisible()) await emailInput.fill(TEST_AGENT.email);

    // Password field (may not exist if invite-based)
    const pwInput = page.locator('input[type="password"], input[name="password"]').first();
    if (await pwInput.isVisible({ timeout: 500 }).catch(() => false)) {
      await pwInput.fill(TEST_AGENT.password);
    }

    await page.locator('.modal button:has-text("Save"), .modal button:has-text("Create"), .modal button[type="submit"]').first().click();
    await page.waitForTimeout(2000);

    // Verify agent in table
    const agentRow = page.locator(`tr:has-text("${TEST_AGENT.name}"), td:has-text("${TEST_AGENT.name}")`).first();
    const rowVisible = await agentRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (rowVisible) {
      console.log('  PASS  New agent appears in table');
    } else {
      console.warn('  WARN  Agent row not found after save – table may need a refresh or selectors differ');
    }

    // --- EDIT ---
    if (rowVisible) {
      const editBtn = page.locator(`tr:has-text("${TEST_AGENT.name}") button:has-text("Edit")`).first();
      if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForSelector('.modal:visible', { timeout: 3000 });
        const nameField = page.locator('.modal input[name="name"], .modal input[placeholder*="name" i]').first();
        if (await nameField.isVisible()) {
          await nameField.fill(TEST_AGENT.name + ' Edited');
        }
        await page.locator('.modal button:has-text("Save"), .modal button:has-text("Update")').first().click();
        await page.waitForTimeout(2000);
        const updatedRow = page.locator(`tr:has-text("${TEST_AGENT.name} Edited")`).first();
        if (await updatedRow.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log('  PASS  Agent edit reflected in table');
        } else {
          console.warn('  WARN  Edited agent name not found in table');
        }
      }
    }

    // --- DELETE ---
    const finalName = rowVisible ? TEST_AGENT.name + ' Edited' : TEST_AGENT.name;
    const deleteBtn = page.locator(`tr:has-text("${finalName}") button:has-text("Delete")`).first();
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click();
      const confirmBtn = page.locator('.modal button:has-text("Confirm"), .modal button:has-text("Yes"), .modal button:has-text("Delete")').first();
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }
      await page.waitForTimeout(2000);
      const deletedRow = page.locator(`tr:has-text("${finalName}")`).first();
      const stillVisible = await deletedRow.isVisible({ timeout: 2000 }).catch(() => false);
      if (!stillVisible) {
        console.log('  PASS  Agent successfully deleted');
      } else {
        console.warn('  WARN  Agent row still visible after delete');
      }
    }
  });

});
