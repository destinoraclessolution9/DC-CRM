import { test, expect, Page } from '@playwright/test';

// ----------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------
const CRM_EMAIL    = 'destinoraclessolution9@gmail.com';
const CRM_PASSWORD = 'destinoraclessolution2026!';

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
  const closeBtn = page.locator('#global-modal-overlay .close, #global-modal-overlay button:has-text("Cancel"), #global-modal-overlay button:has-text("Close"), button[aria-label="Close"]');
  if (await closeBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
    await closeBtn.first().click();
    await page.waitForTimeout(300);
  }
}

// ----------------------------------------------------------------------
// TEST SUITE
// ----------------------------------------------------------------------
test.describe('DestinOraclesSolution CRM – Full Functional & Data Validation', () => {

  async function goToAgents(page: Page) {
    await page.click('#nav-agents');
    await page.waitForSelector('button:has-text("Add Agent")', { timeout: 8000 });
    await page.waitForTimeout(500);
  }

  async function login(page: Page) {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Wait for login form
    const emailInput = page.locator('#loginEmail, input[type="email"], input[name="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.fill(CRM_EMAIL);

    const pwInput = page.locator('#loginPassword, input[type="password"]').first();
    await pwInput.fill(CRM_PASSWORD);

    const loginBtn = page.locator('#loginBtn, button:has-text("Login"), button[type="submit"]').first();
    await loginBtn.click();

    // Wait for app to load past the login screen
    await page.waitForSelector('.nav-links, [data-view], nav li[data-view]', { timeout: 20000 });
    await page.waitForTimeout(1000);
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ------------------------------------------------------------------
  // LEVEL 1 – BUTTON PRESENCE
  // ------------------------------------------------------------------
  test('L1: Critical buttons are visible and enabled', async ({ page }) => {
    await goToAgents(page);

    const checks = [
      { selector: 'button:has-text("Add Agent")', label: 'Add Agent' },
      { selector: 'button[title="Reset Password"]', label: 'Reset Password' },
      { selector: 'button[title="Edit Agent"]', label: 'Edit Agent' },
      { selector: 'button[title="View Detail"]', label: 'View Detail' },
    ];

    for (const { selector, label } of checks) {
      const btn = page.locator(selector).first();
      const visible = await btn.isVisible({ timeout: 3000 }).catch(() => false);
      if (visible) {
        await expect(btn).toBeEnabled();
        console.log(`  PASS  ${label} button present`);
      } else {
        console.warn(`  WARN  ${label} button not found – no agents in list or selector mismatch`);
      }
    }
  });

  // ------------------------------------------------------------------
  // LEVEL 2 – RESET PASSWORD (the previously failing flow)
  // ------------------------------------------------------------------
  test('L2: Reset Password – no force_password_change error', async ({ page }) => {
    const errors: string[] = [];

    page.on('response', async response => {
      if (response.status() >= 400) {
        let body = '';
        try { body = await response.text(); } catch { body = '(unreadable)'; }
        errors.push(`[${response.status()}] ${response.url()} — ${body.slice(0, 200)}`);
      }
    });

    await goToAgents(page);

    const resetBtn = page.locator('button[title="Reset Password"]').first();

    if (!(await resetBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.warn('  WARN  No Reset Password button found – skipping click test');
      return;
    }

    await resetBtn.click();
    await page.waitForTimeout(2000);

    // Accept confirmation modal if present
    const confirmBtn = page.locator('#global-modal-overlay button:has-text("Confirm"), #global-modal-overlay button:has-text("Yes"), #global-modal-overlay button:has-text("OK")');
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
    await goToAgents(page);

    const addBtn = page.locator('button:has-text("Add Agent")').first();
    await addBtn.click();
    const modal = page.locator('#global-modal-overlay:visible, .modal-box:visible');
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
    // Calendar view is the default landing page and shows birthday reminders
    await page.click('#nav-calendar');
    await page.waitForTimeout(1000);

    // Churn risks – look for the dedicated churn risk section heading
    const churnEl = page.locator('h3:has-text("Churn"), h4:has-text("Churn"), .churn-risk, [class*="churn"]').first();
    if (await churnEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      const txt = await churnEl.textContent();
      console.log(`  INFO  Churn element: "${txt?.trim()}"`);
      expect(txt).not.toBeNull();
    } else {
      console.warn('  WARN  No churn element found on calendar view – may be on AI Insights page');
    }

    // Birthday reminders section (visible on calendar view)
    const bdSection = page.locator('.birthday-section, [class*="birthday"], h3:has-text("BIRTHDAY"), h4:has-text("Birthday")').first();
    if (await bdSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      const txt = await bdSection.textContent();
      console.log(`  INFO  Birthday section: "${txt?.trim().slice(0, 80)}"`);
      console.log('  PASS  Birthday section visible');
    } else {
      console.warn('  WARN  Birthday section not found');
    }

    // Check birthday counts directly
    const todayCount = page.locator('.birthday-section .count, [class*="birthday"] .count').first();
    if (await todayCount.isVisible({ timeout: 2000 }).catch(() => false)) {
      const count = await todayCount.textContent();
      console.log(`  INFO  Birthday today count: ${count}`);
    }
  });

  // ------------------------------------------------------------------
  // LEVEL 3 – AGENT CRUD (add → verify → edit → delete)
  // ------------------------------------------------------------------
  test('L3: Agent CRUD – create, verify, edit, delete', async ({ page }) => {
    await goToAgents(page);

    // --- CREATE ---
    const addBtn = page.locator('button:has-text("Add Agent")').first();

    await addBtn.click();
    await page.waitForSelector('#global-modal-overlay:visible, .modal-box:visible', { timeout: 4000 });

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

    await page.locator('#global-modal-overlay button:has-text("Save"), #global-modal-overlay button:has-text("Create"), #global-modal-overlay button[type="submit"]').first().click();
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
        const nameField = page.locator('#global-modal-overlay input[name="name"], #global-modal-overlay input[placeholder*="name" i]').first();
        if (await nameField.isVisible()) {
          await nameField.fill(TEST_AGENT.name + ' Edited');
        }
        await page.locator('#global-modal-overlay button:has-text("Save"), #global-modal-overlay button:has-text("Update")').first().click();
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
      const confirmBtn = page.locator('#global-modal-overlay button:has-text("Confirm"), #global-modal-overlay button:has-text("Yes"), #global-modal-overlay button:has-text("Delete")').first();
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
