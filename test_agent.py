import anyio, os

# Required on Windows: point the Agent SDK to git-bash
os.environ.setdefault(
    "CLAUDE_CODE_GIT_BASH_PATH",
    r"C:\Users\DC\AppData\Local\Programs\Git\usr\bin\bash.exe"
)

from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

BASE_URL = "http://localhost:8082"

VIEWS = [
    "calendar", "prospects", "pipeline", "agents",
    "promotions", "reports", "documents", "protection",
    "import", "integrations", "referrals", "cases", "marketing_lists"
]

SYSTEM_PROMPT = f"""
You are a QA agent testing the Feng Shui CRM at {BASE_URL}.

## Login
- Open {BASE_URL} in the browser
- Find the email/username input field and type: admin
- Find the password input field and type: admin123
- Click the Login button
- Wait for the dashboard to load

## For each view, do ALL of the following in order:

### Step 1 — Navigate & screenshot
- Execute in browser console: app.navigateTo('<viewId>')
- Wait for the view to load (1-2 seconds)
- Take a screenshot and save to test_screenshots/<viewId>.png

### Step 2 — Button testing
Find and click every visible button, link, and interactive control. For each one:
- Note its label or title
- Note exactly what happened: modal opened, toast message shown, page navigated, nothing happened, JS error in console
- If a modal opened: note its title, then close it (click Cancel, Close, or ✕) before moving on
- If clicking navigated away from the view: go back using app.navigateTo('<current-viewId>') and continue
- SKIP any button whose label contains: Delete, Remove, Deactivate, Reset Password, Force Delete
  (mark these as ⏭️ SKIPPED in the report)

### Step 3 — Form data verification (run this ONLY for these 3 views)

**prospects view:**
1. Click the "+ Add Prospect" or "Add New" button
2. Fill in: Full Name field → "TEST_QA_001", Phone field → "0100000001"
3. Click Save / Create / Submit
4. Look at the prospects table — does a row with "TEST_QA_001" appear?
5. Record PASS or FAIL

**agents view:**
1. Click the "+ Add Agent" button
2. Fill in: Full Name → "QA Agent", Phone → "0100000002", Email → "qa@test.com", IC Number → "990101010001"
3. Select any role from the Role dropdown
4. Click "Create Agent Account"
5. Look at the agents table — does a row with "QA Agent" appear?
6. Record PASS or FAIL

**cases view:**
1. Click the "+ New Case Study" or similar button
2. Fill in: Title → "QA Test Case", Amount → "1000"
3. Click Save
4. Look at the cases table — does a row with "QA Test Case" appear?
5. Record PASS or FAIL

### Step 4 — Write results to test_report.md
After testing each view, APPEND this block to test_report.md:

---
### View: <view-id>
Screenshot: `test_screenshots/<view-id>.png`

#### Buttons Tested
| Button / Control | Action Observed | Status |
|---|---|---|
| + Add Agent | Opened "Add New Agent" modal | ✅ PASS |
| View icon (eye) | Opened agent profile page | ✅ PASS |
| Export CSV | No response | ❌ FAIL |
| Delete button | (skipped) | ⏭️ SKIPPED |

#### Form Data Verification
(include only if this is prospects / agents / cases view)
| Test | Data Entered | Expected in Table | Result |
|---|---|---|---|
| Add Prospect | TEST_QA_001 | Name column | ✅ PASS |

---

## After ALL views are tested
Append this final section to test_report.md:

---
## Summary
- **Views tested:** X / {len(VIEWS)}
- **Total buttons tested:** X
- **✅ PASS:** X
- **❌ FAIL:** X
- **⏭️ SKIPPED:** X
- **Form data tests:** X / 3 passed

## Failed Items
(list each FAIL with view name and button label)

## Notes
(any patterns, recurring errors, or observations)
"""

PROMPT = f"""
Run a full QA test of the Feng Shui CRM.

1. Create test_report.md with this header:
   # CRM Test Report
   **Date:** <today's date>
   **Tester:** QA Agent (claude-opus-4-6)
   **Target:** {BASE_URL}
   **Views tested:** {', '.join(VIEWS)}

2. Create the test_screenshots/ folder if it doesn't exist

3. Open {BASE_URL}, log in as admin / admin123

4. Test each view one by one in this order:
   {', '.join(VIEWS)}

5. For each view: navigate → screenshot → test buttons → run form tests (if prospects/agents/cases) → write results to test_report.md

6. Write the Summary section at the very end of test_report.md

Be thorough — test every button you can see in each view.
"""


def safe_print(text):
    """Print text safely, replacing unencodable characters."""
    import sys
    encoded = text.encode(sys.stdout.encoding or "utf-8", errors="replace")
    sys.stdout.buffer.write(encoded + b"\n")
    sys.stdout.buffer.flush()


async def main():
    os.makedirs("test_screenshots", exist_ok=True)
    print(f"Starting CRM test agent against {BASE_URL}")
    print(f"Testing {len(VIEWS)} views: {', '.join(VIEWS)}")
    print("Results will be written to test_report.md\n")

    async for message in query(
        prompt=PROMPT,
        options=ClaudeAgentOptions(
            cwd=r"C:\Users\DC\Desktop\DestinOraclesSolution CRM",
            mcp_servers={
                "playwright": {
                    "command": "npx",
                    "args": ["@playwright/mcp@latest", "--headless"]
                }
            },
            system_prompt=SYSTEM_PROMPT,
            model="claude-opus-4-6",
            thinking={"type": "adaptive"},
            max_turns=200,
            permission_mode="bypassPermissions",
        )
    ):
        if isinstance(message, ResultMessage):
            safe_print("\n=== TEST AGENT COMPLETE ===")
            safe_print(message.result)


anyio.run(main)
