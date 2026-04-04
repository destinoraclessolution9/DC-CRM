const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8082';
const SCREENSHOT_DIR = path.join(__dirname, 'test_screenshots');
const REPORT_FILE = path.join(__dirname, 'test_report.md');

const SKIP_LABELS = ['delete', 'remove', 'deactivate', 'reset password', 'force delete'];
function shouldSkip(label) {
  return SKIP_LABELS.some(s => (label || '').toLowerCase().includes(s));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function bypassLogin(page) {
  console.log('=== BYPASSING LOGIN ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  // Bypass login by directly setting user and showing app shell
  await page.evaluate(() => {
    // Set a mock admin user
    const adminUser = {
      id: 1,
      username: 'admin',
      full_name: 'System Admin',
      role: 'Level 1 super admin',
      status: 'active',
      email: 'admin@test.com'
    };

    // Access the app's internal state by calling exposed methods
    // Hide login, show app
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-shell').style.display = 'block';
  });

  // Now set the _currentUser through the app object if possible
  await page.evaluate(() => {
    const adminUser = {
      id: 1,
      username: 'admin',
      full_name: 'System Admin',
      role: 'Level 1 super admin',
      status: 'active',
      email: 'admin@test.com'
    };
    // Try to set _currentUser via any exposed setter or property
    if (window.app) {
      window.app._currentUser = adminUser;
      // Also try calling internal methods
      if (window.app.setCurrentUser) window.app.setCurrentUser(adminUser);
    }
  });

  await sleep(1000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'login_bypass.png'), fullPage: false });
  console.log('Login bypassed, app shell visible');
}

async function getViewButtons(page) {
  return await page.evaluate(() => {
    const elements = [];
    const seen = new Set();

    // Get all interactive elements in the visible view area (not sidebar)
    const mainContent = document.querySelector('.view-container:not([style*="display: none"]), .content-area, .main-content, #main-content');
    const searchRoot = mainContent || document.body;

    searchRoot.querySelectorAll('button, a.btn, .btn, [role="button"], [onclick]').forEach(el => {
      // Skip if in sidebar/navbar
      if (el.closest('.sidebar, #sidebar, .nav-sidebar, .navbar-nav')) return;
      // Skip if in a hidden modal
      if (el.closest('.modal[style*="display: none"]')) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      let label = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
      const title = el.getAttribute('title') || el.getAttribute('aria-label') || '';
      const onclick = (el.getAttribute('onclick') || '').substring(0, 150);
      const icon = el.querySelector('i, .fa, .fas, .far, .fab');
      const iconClass = icon ? icon.className : '';

      // Build display label
      let displayLabel = label || title || '';
      if (!displayLabel && iconClass) {
        if (iconClass.includes('edit') || iconClass.includes('pencil')) displayLabel = '[Edit icon]';
        else if (iconClass.includes('eye')) displayLabel = '[View icon]';
        else if (iconClass.includes('trash')) displayLabel = '[Delete icon]';
        else if (iconClass.includes('plus')) displayLabel = '[Add icon]';
        else if (iconClass.includes('download')) displayLabel = '[Download icon]';
        else if (iconClass.includes('upload')) displayLabel = '[Upload icon]';
        else if (iconClass.includes('search')) displayLabel = '[Search icon]';
        else if (iconClass.includes('filter')) displayLabel = '[Filter icon]';
        else if (iconClass.includes('refresh') || iconClass.includes('sync')) displayLabel = '[Refresh icon]';
        else displayLabel = `[Icon: ${iconClass.substring(0, 40)}]`;
      }

      if (!displayLabel) return;

      // Deduplicate
      const key = displayLabel + '|' + onclick;
      if (seen.has(key)) return;
      seen.add(key);

      elements.push({
        displayLabel,
        onclick,
        title,
        tag: el.tagName,
        id: el.id || '',
        className: (typeof el.className === 'string' ? el.className : '').substring(0, 60),
        iconClass,
        idx: elements.length
      });
    });
    return elements;
  });
}

async function clickButtonAndObserve(page, btn, viewId) {
  const label = btn.displayLabel;

  if (shouldSkip(label)) {
    return { label, action: '(skipped - dangerous action)', status: '⏭️ SKIPPED' };
  }

  try {
    // Check for modal before click
    const modalBefore = await page.evaluate(() => {
      const m = document.querySelector('.modal[style*="display: block"], .modal.show');
      return !!m;
    });

    // Try to click
    let clickSuccess = false;
    if (btn.onclick) {
      try {
        await page.evaluate((onclick) => {
          try { eval(onclick); } catch(e) { console.error('onclick eval error:', e); }
        }, btn.onclick);
        clickSuccess = true;
      } catch(e) {}
    }

    if (!clickSuccess) {
      // Find by text content matching
      try {
        await page.evaluate((lbl, tag, id, cls) => {
          let el = null;
          if (id) el = document.getElementById(id);
          if (!el) {
            const candidates = document.querySelectorAll('button, a.btn, .btn, [role="button"], [onclick]');
            el = Array.from(candidates).find(c => {
              const t = (c.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 80);
              return t === lbl || (c.id === id && id);
            });
          }
          if (el) el.click();
        }, label, btn.tag, btn.id, btn.className);
        clickSuccess = true;
      } catch(e) {}
    }

    await sleep(1200);

    // Check what happened
    // 1. Check for modal
    const modalInfo = await page.evaluate(() => {
      const modals = document.querySelectorAll('.modal, .modal-overlay');
      for (const m of modals) {
        const style = window.getComputedStyle(m);
        const inlineDisplay = m.style.display;
        if (style.display !== 'none' && inlineDisplay !== 'none' && style.visibility !== 'hidden') {
          const title = m.querySelector('.modal-title, .modal-header h3, .modal-header h4, .modal-header h5, h3, h4, h5');
          return { visible: true, title: title ? title.textContent.trim().substring(0, 60) : 'Modal' };
        }
      }
      return { visible: false };
    });

    // 2. Check for toast
    const toast = await page.evaluate(() => {
      const t = document.querySelector('.toast-message, .toast, .notification, [class*="toast"]');
      if (t && t.offsetHeight > 0) return t.textContent.trim().substring(0, 80);
      return null;
    });

    let action = '';
    let status = '✅ PASS';

    if (modalInfo.visible && !modalBefore) {
      action = `Opened modal: "${modalInfo.title}"`;
      // Close it
      try {
        await page.evaluate(() => {
          // Try various close methods
          const closeSelectors = [
            '.modal .btn-close', '.modal .close', '.modal [onclick*="hideModal"]',
            '.modal [onclick*="close"]', '.modal-header button',
            '.modal-overlay .btn-close', '.btn-secondary[onclick*="hide"]',
            '.modal .btn-secondary', '.modal [data-dismiss="modal"]'
          ];
          for (const sel of closeSelectors) {
            const btn = document.querySelector(sel);
            if (btn) { btn.click(); return; }
          }
          // Fallback
          if (typeof UI !== 'undefined' && UI.hideModal) UI.hideModal();
        });
        await sleep(500);
      } catch(e) {}
    } else if (toast) {
      action = `Toast: "${toast}"`;
      if (toast.toLowerCase().includes('error')) status = '❌ FAIL';
    } else {
      // Check if view changed
      const currentView = await page.evaluate(() => {
        const views = document.querySelectorAll('.view-container, [id$="-view"]');
        for (const v of views) {
          if (v.style.display !== 'none' && v.offsetHeight > 0) return v.id;
        }
        return 'unknown';
      });

      // Check for JS errors that may have been thrown
      action = 'No visible response (may have updated UI)';
      status = '⚠️ CHECK';
    }

    // Make sure we're still on the right view
    const onCorrectView = await page.evaluate((vid) => {
      const el = document.getElementById(vid + '-view') || document.getElementById(vid);
      if (!el) return true; // can't check
      return el.style.display !== 'none';
    }, viewId);

    if (!onCorrectView) {
      try {
        await page.evaluate((id) => { if (window.app && app.navigateTo) app.navigateTo(id); }, viewId);
        await sleep(1500);
      } catch(e) {}
      if (action === 'No visible response (may have updated UI)') {
        action = `Navigated away (returned to ${viewId})`;
        status = '✅ PASS';
      }
    }

    return { label, action, status };
  } catch(e) {
    return { label, action: `Error: ${e.message.substring(0, 80)}`, status: '❌ FAIL' };
  }
}

async function testView(page, viewId) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`TESTING VIEW: ${viewId}`);
  console.log('='.repeat(50));

  // Navigate
  try {
    await page.evaluate((id) => app.navigateTo(id), viewId);
  } catch(e) {
    console.log(`  navigateTo error: ${e.message.substring(0, 60)}`);
  }
  await sleep(2500);

  // Screenshot
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${viewId}.png`), fullPage: false });
  console.log(`  Screenshot: ${viewId}.png`);

  // Get buttons
  const buttons = await getViewButtons(page);
  console.log(`  Found ${buttons.length} buttons/controls`);

  const results = [];
  for (const btn of buttons) {
    console.log(`  Testing: "${btn.displayLabel}"`);
    const result = await clickButtonAndObserve(page, btn, viewId);
    console.log(`    → ${result.action} [${result.status}]`);
    results.push(result);
  }

  return results;
}

// Form test functions
async function testProspectForm(page) {
  console.log('\n--- FORM TEST: Add Prospect ---');
  await page.evaluate(() => app.navigateTo('prospects'));
  await sleep(2000);

  try {
    // Look for and click Add button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, .btn, [onclick]'));
      const addBtn = btns.find(b => {
        const text = (b.textContent || '').toLowerCase();
        const onclick = (b.getAttribute('onclick') || '').toLowerCase();
        return (text.includes('add') && (text.includes('prospect') || text.includes('new'))) ||
               onclick.includes('addprospect') || onclick.includes('showaddprospect') ||
               onclick.includes('showprospectmodal') || onclick.includes('createprospect');
      });
      if (addBtn) { addBtn.click(); return true; }
      // Try any "+" button
      const plusBtn = btns.find(b => b.textContent.trim() === '+' || b.textContent.includes('Add'));
      if (plusBtn) { plusBtn.click(); return true; }
      return false;
    });
    await sleep(1500);

    // Screenshot the modal
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'prospect_form.png'), fullPage: false });

    // Fill form fields
    await page.evaluate(() => {
      // Try multiple selectors for name field
      const nameSelectors = ['#prospect-name', '#full_name', '#fullName', '#name',
                             'input[name="full_name"]', 'input[name="name"]',
                             'input[placeholder*="name" i]', 'input[placeholder*="Name"]'];
      for (const sel of nameSelectors) {
        const el = document.querySelector(`.modal ${sel}, .modal-overlay ${sel}, ${sel}`);
        if (el && el.offsetHeight > 0) {
          el.value = 'TEST_QA_001';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
      // Phone
      const phoneSelectors = ['#prospect-phone', '#phone', 'input[name="phone"]',
                              'input[placeholder*="phone" i]', 'input[type="tel"]'];
      for (const sel of phoneSelectors) {
        const el = document.querySelector(`.modal ${sel}, .modal-overlay ${sel}, ${sel}`);
        if (el && el.offsetHeight > 0) {
          el.value = '0100000001';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    });
    await sleep(500);

    // Click save
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.modal button, .modal-overlay button'));
      const saveBtn = btns.find(b => {
        const t = (b.textContent || '').toLowerCase();
        return t.includes('save') || t.includes('create') || t.includes('submit') || t.includes('add');
      });
      if (saveBtn) saveBtn.click();
    });
    await sleep(2500);

    // Check table
    const found = await page.evaluate(() => {
      return document.body.innerHTML.includes('TEST_QA_001');
    });

    return { test: 'Add Prospect', data: 'Full Name: TEST_QA_001, Phone: 0100000001',
             expected: 'Name column shows TEST_QA_001', result: found ? '✅ PASS' : '❌ FAIL' };
  } catch(e) {
    return { test: 'Add Prospect', data: 'TEST_QA_001', expected: 'Name in table',
             result: `❌ FAIL (${e.message.substring(0, 50)})` };
  }
}

async function testAgentForm(page) {
  console.log('\n--- FORM TEST: Add Agent ---');
  await page.evaluate(() => app.navigateTo('agents'));
  await sleep(2000);

  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, .btn, [onclick]'));
      const addBtn = btns.find(b => {
        const text = (b.textContent || '').toLowerCase();
        const onclick = (b.getAttribute('onclick') || '').toLowerCase();
        return (text.includes('add') && text.includes('agent')) ||
               onclick.includes('addagent') || onclick.includes('showaddagent') ||
               onclick.includes('showagentmodal');
      });
      if (addBtn) addBtn.click();
    });
    await sleep(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'agent_form.png'), fullPage: false });

    await page.evaluate(() => {
      const allInputs = document.querySelectorAll('.modal input, .modal-overlay input');
      allInputs.forEach(inp => {
        const name = (inp.name || inp.id || inp.placeholder || '').toLowerCase();
        if (name.includes('name') || name.includes('full')) {
          inp.value = 'QA Agent';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (name.includes('phone') || name.includes('mobile') || name.includes('tel')) {
          inp.value = '0100000002';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (name.includes('email')) {
          inp.value = 'qa@test.com';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (name.includes('ic') || name.includes('nric') || name.includes('identity')) {
          inp.value = '990101010001';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      // Select role
      const selects = document.querySelectorAll('.modal select, .modal-overlay select');
      selects.forEach(sel => {
        if (sel.options.length > 1) {
          sel.selectedIndex = 1;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
    await sleep(500);

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.modal button, .modal-overlay button'));
      const saveBtn = btns.find(b => {
        const t = (b.textContent || '').toLowerCase();
        return t.includes('create') || t.includes('save') || t.includes('submit');
      });
      if (saveBtn) saveBtn.click();
    });
    await sleep(2500);

    const found = await page.evaluate(() => document.body.innerHTML.includes('QA Agent'));
    return { test: 'Add Agent', data: 'QA Agent / 0100000002 / qa@test.com / 990101010001',
             expected: 'Name in agents table', result: found ? '✅ PASS' : '❌ FAIL' };
  } catch(e) {
    return { test: 'Add Agent', data: 'QA Agent', expected: 'Name in table',
             result: `❌ FAIL (${e.message.substring(0, 50)})` };
  }
}

async function testCaseForm(page) {
  console.log('\n--- FORM TEST: Add Case ---');
  await page.evaluate(() => app.navigateTo('cases'));
  await sleep(2000);

  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, .btn, [onclick]'));
      const addBtn = btns.find(b => {
        const text = (b.textContent || '').toLowerCase();
        const onclick = (b.getAttribute('onclick') || '').toLowerCase();
        return (text.includes('new') || text.includes('add')) && text.includes('case') ||
               onclick.includes('case') && (onclick.includes('add') || onclick.includes('new') || onclick.includes('create') || onclick.includes('show'));
      });
      if (addBtn) addBtn.click();
    });
    await sleep(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'case_form.png'), fullPage: false });

    await page.evaluate(() => {
      const inputs = document.querySelectorAll('.modal input, .modal-overlay input, input');
      inputs.forEach(inp => {
        const name = (inp.name || inp.id || inp.placeholder || '').toLowerCase();
        if (name.includes('title') || name.includes('name') || name.includes('subject')) {
          inp.value = 'QA Test Case';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (name.includes('amount') || name.includes('value') || name.includes('price')) {
          inp.value = '1000';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
    await sleep(500);

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.modal button, .modal-overlay button'));
      const saveBtn = btns.find(b => {
        const t = (b.textContent || '').toLowerCase();
        return t.includes('save') || t.includes('create') || t.includes('submit');
      });
      if (saveBtn) saveBtn.click();
    });
    await sleep(2500);

    const found = await page.evaluate(() => document.body.innerHTML.includes('QA Test Case'));
    return { test: 'Add Case', data: 'Title: QA Test Case, Amount: 1000',
             expected: 'Title in cases table', result: found ? '✅ PASS' : '❌ FAIL' };
  } catch(e) {
    return { test: 'Add Case', data: 'QA Test Case', expected: 'Title in table',
             result: `❌ FAIL (${e.message.substring(0, 50)})` };
  }
}

function appendToReport(text) {
  fs.appendFileSync(REPORT_FILE, text + '\n');
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
    protocolTimeout: 60000
  });

  const page = await browser.newPage();

  // Collect page errors
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  const views = ['calendar', 'prospects', 'pipeline', 'agents', 'promotions', 'reports',
                 'documents', 'protection', 'import', 'integrations', 'referrals', 'cases', 'marketing_lists'];

  let totalButtons = 0, totalPass = 0, totalFail = 0, totalSkipped = 0, totalCheck = 0;
  const failedItems = [];
  const formResults = [];
  let viewsTested = 0;

  try {
    await bypassLogin(page);

    // Try to initialize the app view
    await page.evaluate(() => {
      if (window.app && app.navigateTo) app.navigateTo('calendar');
    });
    await sleep(2000);

    for (const viewId of views) {
      console.log(`\nStarting test for: ${viewId}`);

      const buttonResults = await testView(page, viewId);
      viewsTested++;

      // Form tests
      let formResult = null;
      if (viewId === 'prospects') formResult = await testProspectForm(page);
      else if (viewId === 'agents') formResult = await testAgentForm(page);
      else if (viewId === 'cases') formResult = await testCaseForm(page);
      if (formResult) formResults.push(formResult);

      // Write to report
      let reportBlock = `\n---\n### View: ${viewId}\nScreenshot: \`test_screenshots/${viewId}.png\`\n\n`;
      reportBlock += `#### Buttons Tested\n| Button / Control | Action Observed | Status |\n|---|---|---|\n`;

      for (const r of buttonResults) {
        totalButtons++;
        if (r.status.includes('PASS')) totalPass++;
        else if (r.status.includes('FAIL')) { totalFail++; failedItems.push({ view: viewId, button: r.label, action: r.action }); }
        else if (r.status.includes('SKIPPED')) totalSkipped++;
        else if (r.status.includes('CHECK')) totalCheck++;

        reportBlock += `| ${r.label.replace(/\|/g, '\\|')} | ${r.action.replace(/\|/g, '\\|')} | ${r.status} |\n`;
      }

      if (buttonResults.length === 0) {
        reportBlock += `| (no buttons found) | N/A | ⚠️ CHECK |\n`;
      }

      if (formResult) {
        reportBlock += `\n#### Form Data Verification\n| Test | Data Entered | Expected in Table | Result |\n|---|---|---|---|\n`;
        reportBlock += `| ${formResult.test} | ${formResult.data} | ${formResult.expected} | ${formResult.result} |\n`;
      }

      appendToReport(reportBlock);
      console.log(`  View ${viewId} complete: ${buttonResults.length} buttons tested`);
    }

  } catch(e) {
    console.log(`Fatal error: ${e.message}`);
    appendToReport(`\n**FATAL ERROR:** ${e.message}\n`);
  }

  // Summary
  const formPassed = formResults.filter(f => f.result.includes('PASS')).length;
  let summary = `\n---\n## Summary\n`;
  summary += `- **Views tested:** ${viewsTested} / 13\n`;
  summary += `- **Total buttons tested:** ${totalButtons}\n`;
  summary += `- **✅ PASS:** ${totalPass}\n`;
  summary += `- **❌ FAIL:** ${totalFail}\n`;
  summary += `- **⏭️ SKIPPED:** ${totalSkipped}\n`;
  summary += `- **⚠️ CHECK (no visible response):** ${totalCheck}\n`;
  summary += `- **Form data tests:** ${formPassed} / 3 passed\n`;

  summary += `\n## Failed Items\n`;
  if (failedItems.length === 0) {
    summary += `(none)\n`;
  } else {
    for (const f of failedItems) {
      summary += `- **${f.view}** → "${f.button}" — ${f.action}\n`;
    }
  }

  summary += `\n## Notes\n`;
  summary += `- Login was bypassed (Supabase Auth returns 409 on localhost — no real auth server). App shell was shown by direct DOM manipulation.\n`;
  summary += `- The app uses seeded in-memory data via AppDataStore when Supabase is unreachable.\n`;
  if (pageErrors.length > 0) {
    summary += `- Page-level JS errors encountered: ${pageErrors.length}\n`;
    const unique = [...new Set(pageErrors.map(e => e.substring(0, 100)))];
    for (const e of unique.slice(0, 10)) {
      summary += `  - \`${e}\`\n`;
    }
  }

  appendToReport(summary);
  console.log('\n' + summary);

  await browser.close();
  console.log('\n=== QA TEST COMPLETE ===');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
