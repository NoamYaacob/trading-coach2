# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: verify-telegram-handoff.spec.ts >> Telegram handoff after session start >> ready-to-trade unlinked user
- Location: verify-telegram-handoff.spec.ts:56:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button:has-text("Start session")')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('button:has-text("Start session")')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - link "Trading Coach" [ref=e4] [cursor=pointer]:
        - /url: /
      - navigation [ref=e5]:
        - link "Onboarding" [ref=e6] [cursor=pointer]:
          - /url: /onboarding
        - link "Guardian" [ref=e7] [cursor=pointer]:
          - /url: /guardian
        - link "Dashboard" [ref=e8] [cursor=pointer]:
          - /url: /dashboard
    - main [ref=e9]:
      - generic [ref=e11]:
        - generic [ref=e12]:
          - paragraph [ref=e13]: Dashboard
          - heading "Your trading coach account." [level=1] [ref=e14]
          - paragraph [ref=e15]: Review account access, onboarding progress, and Telegram connection status from one authenticated dashboard.
        - generic [ref=e17]:
          - button "Connect Telegram" [ref=e18]
          - button "Logout" [ref=e19]
      - generic [ref=e20]:
        - generic [ref=e22]:
          - generic [ref=e23]:
            - generic [ref=e24]: Session active
            - heading "Session is active." [level=2] [ref=e25]
            - paragraph [ref=e26]: Started at Apr 14, 2026, 7:25 AM UTC from dashboard.
            - generic [ref=e27]:
              - paragraph [ref=e28]: What to do next
              - paragraph [ref=e29]: Your session is active. Connect Telegram now so coaching can continue in the bot.
              - button "Connect Telegram" [ref=e30]
          - generic [ref=e31]:
            - generic [ref=e32]:
              - generic [ref=e33]:
                - paragraph [ref=e34]: Today status
                - paragraph [ref=e35]: Trading open
                - paragraph [ref=e36]: Started Apr 14, 2026, 7:25 AM UTC
                - paragraph [ref=e37]: Started from dashboard.
              - generic [ref=e38]:
                - paragraph [ref=e39]: Next reset
                - paragraph [ref=e40]: Apr 14, 2026, 9:00 AM UTC
                - paragraph [ref=e41]: "Reset mode: Daily"
            - generic [ref=e42]:
              - generic [ref=e43]:
                - paragraph [ref=e44]: Trades
                - paragraph [ref=e45]: "0"
              - generic [ref=e46]:
                - paragraph [ref=e47]: P&L
                - paragraph [ref=e48]: "0"
              - generic [ref=e49]:
                - paragraph [ref=e50]: Loss streak
                - paragraph [ref=e51]: "0"
            - generic [ref=e52]:
              - paragraph [ref=e53]: Active limits
              - paragraph [ref=e54]: Started from dashboard.
              - generic [ref=e55]:
                - generic [ref=e56]: "Reset mode: Daily reset"
                - generic [ref=e57]: "Reset time zone: UTC"
                - generic [ref=e58]: "Daily reset hour: 9:00"
                - generic [ref=e59]: "Copy trade mode: Off"
        - generic [ref=e60]:
          - generic [ref=e61]:
            - generic [ref=e62]:
              - heading "Account" [level=2] [ref=e63]
              - paragraph [ref=e64]: Authenticated website account details.
            - generic [ref=e65]:
              - generic [ref=e66]:
                - term [ref=e67]: Email
                - definition [ref=e68]: ready.unlinked@example.com
              - generic [ref=e69]:
                - term [ref=e70]: Role
                - definition [ref=e71]: USER
          - generic [ref=e72]:
            - generic [ref=e73]:
              - heading "Access status" [level=2] [ref=e74]
              - paragraph [ref=e75]: Trial and subscription state control website and bot availability.
            - generic [ref=e76]:
              - generic [ref=e77]:
                - term [ref=e78]: Subscription status
                - definition [ref=e79]: TRIALING
              - generic [ref=e80]:
                - term [ref=e81]: Trial started
                - definition [ref=e82]: Apr 13, 2026, 10:20 AM
              - generic [ref=e83]:
                - term [ref=e84]: Trial ends
                - definition [ref=e85]: Apr 21, 2026, 10:20 AM
              - generic [ref=e86]:
                - term [ref=e87]: Trial active
                - definition [ref=e88]: Yes, trial access is active.
          - generic [ref=e89]:
            - generic [ref=e90]:
              - heading "Onboarding status" [level=2] [ref=e91]
              - paragraph [ref=e92]: Core profile status for the coaching account.
            - paragraph [ref=e94]: Onboarding profile is in place.
          - generic [ref=e95]:
            - generic [ref=e96]:
              - heading "Telegram status" [level=2] [ref=e97]
              - paragraph [ref=e98]: Connection status for the mental coach bot.
            - generic [ref=e99]:
              - paragraph [ref=e100]: Telegram is not connected yet.
              - paragraph [ref=e101]: Use the Telegram connect flow to link the authenticated account to the bot.
          - generic [ref=e102]:
            - generic [ref=e103]:
              - heading "Trading Guardian" [level=2] [ref=e104]
              - paragraph [ref=e105]: Quick access to Guardian status and controls.
            - generic [ref=e106]:
              - generic [ref=e107]:
                - generic [ref=e108]:
                  - paragraph [ref=e109]: Guardian
                  - paragraph [ref=e110]: Active
                  - paragraph [ref=e111]: "Connection: Mock connected"
                - generic [ref=e112]:
                  - paragraph [ref=e113]: Summary
                  - paragraph [ref=e114]: Session is already active and tracking from the dashboard.
              - link "Open Guardian" [ref=e115] [cursor=pointer]:
                - /url: /guardian
          - generic [ref=e116]:
            - generic [ref=e117]:
              - heading "Live trader state" [level=2] [ref=e118]
              - paragraph [ref=e119]: Secondary context for coach replies. Guardian still decides whether trading is allowed.
            - generic [ref=e120]:
              - paragraph [ref=e121]: "Current state: none"
              - paragraph [ref=e122]: No live state is active right now.
              - generic [ref=e123]:
                - generic [ref=e124]:
                  - paragraph [ref=e125]: Cooldown
                  - paragraph [ref=e126]: Not active
                  - paragraph [ref=e127]: Until Not set
                - generic [ref=e128]:
                  - paragraph [ref=e129]: Recent loss streak
                  - paragraph [ref=e130]: "0"
                  - paragraph [ref=e131]: Updated Not set
                - generic [ref=e132]:
                  - paragraph [ref=e133]: Events today
                  - paragraph [ref=e134]: "0"
                  - paragraph [ref=e135]: "Distress moments: 0"
  - button "Open Next.js Dev Tools" [ref=e141] [cursor=pointer]:
    - img [ref=e142]
  - alert [ref=e145]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | const baseURL = 'http://localhost:3000';
  4  | const password = 'Password123!';
  5  | 
  6  | async function login(page, email) {
  7  |   await page.goto(`${baseURL}/login`);
  8  |   await expect(page.locator('role=button[name="Log in"]')).toBeVisible();
  9  |   await page.fill('input[type="email"]', email);
  10 |   await page.fill('input[type="password"]', password);
  11 |   const [response] = await Promise.all([
  12 |     page.waitForResponse((resp) => resp.url().endsWith('/api/auth/login') && resp.status() === 200),
  13 |     page.click('role=button[name="Log in"]'),
  14 |   ]);
  15 |   expect(response.ok()).toBeTruthy();
  16 |   await page.waitForURL('**/onboarding', { timeout: 10000 });
  17 | }
  18 | 
  19 | async function goToDashboard(page) {
  20 |   await page.goto(`${baseURL}/dashboard`);
  21 |   await expect(page).toHaveURL(/.*\/dashboard$/);
  22 | }
  23 | 
  24 | async function getCtaText(page) {
  25 |   const button = page.locator('section button:visible, section a:visible').filter({ hasText: /Start session|Open Telegram coach|Connect Telegram|Enable Guardian|Open Guardian|Complete onboarding/ });
  26 |   const count = await button.count();
  27 |   if (count === 0) return null;
  28 |   return await button.first().textContent();
  29 | }
  30 | 
  31 | async function getHandoffText(page) {
  32 |   const locator = page.locator('section p', { hasText: /Continue live coaching in Telegram|Connect Telegram now|Trade the plan/ });
  33 |   return (await locator.first().textContent())?.trim() ?? null;
  34 | }
  35 | 
  36 | test.describe('Telegram handoff after session start', () => {
  37 |   test('ready-to-trade linked user', async ({ page }) => {
  38 |     await login(page, 'ready.linked@example.com');
  39 |     await goToDashboard(page);
  40 |     await expect(page.locator('button:has-text("Start session")')).toBeVisible();
  41 |     const before = await getCtaText(page);
  42 |     await Promise.all([
  43 |       page.waitForResponse((resp) => resp.url().endsWith('/api/guardian/start-session') && resp.status() === 200),
  44 |       page.click('button:has-text("Start session")'),
  45 |     ]);
  46 |     await page.waitForLoadState('networkidle');
  47 |     await page.reload();
  48 |     const after = await getCtaText(page);
  49 |     const handoff = await getHandoffText(page);
  50 |     expect(after).toContain('Open Telegram coach');
  51 |     expect(handoff).toContain('Continue live coaching in Telegram');
  52 |     test.info().annotations.push({ type: 'before-cta', description: before ?? '' });
  53 |     test.info().annotations.push({ type: 'after-cta', description: after ?? '' });
  54 |   });
  55 | 
  56 |   test('ready-to-trade unlinked user', async ({ page }) => {
  57 |     await login(page, 'ready.unlinked@example.com');
  58 |     await goToDashboard(page);
> 59 |     await expect(page.locator('button:has-text("Start session")')).toBeVisible();
     |                                                                    ^ Error: expect(locator).toBeVisible() failed
  60 |     const before = await getCtaText(page);
  61 |     await Promise.all([
  62 |       page.waitForResponse((resp) => resp.url().endsWith('/api/guardian/start-session') && resp.status() === 200),
  63 |       page.click('button:has-text("Start session")'),
  64 |     ]);
  65 |     await page.waitForLoadState('networkidle');
  66 |     await page.reload();
  67 |     const after = await getCtaText(page);
  68 |     const handoff = await getHandoffText(page);
  69 |     expect(after).toContain('Connect Telegram');
  70 |     expect(handoff).toContain('Connect Telegram now');
  71 |     test.info().annotations.push({ type: 'before-cta', description: before ?? '' });
  72 |     test.info().annotations.push({ type: 'after-cta', description: after ?? '' });
  73 |   });
  74 | 
  75 |   test('locked user does not show start session or telegram handoff primary action', async ({ page }) => {
  76 |     await login(page, 'locked.user@example.com');
  77 |     await goToDashboard(page);
  78 |     const startVisible = await page.locator('button:has-text("Start session")').count();
  79 |     const openTelegramVisible = await page.locator('a:has-text("Open Telegram coach")').count();
  80 |     const connectTelegramVisible = await page.locator('button:has-text("Connect Telegram")').count();
  81 |     expect(startVisible).toBe(0);
  82 |     expect(openTelegramVisible).toBe(0);
  83 |     expect(connectTelegramVisible).toBe(0);
  84 |   });
  85 | 
  86 |   test('guardian disabled user does not show telegram handoff primary action', async ({ page }) => {
  87 |     await login(page, 'guardian.disabled@example.com');
  88 |     await goToDashboard(page);
  89 |     const openTelegramVisible = await page.locator('a:has-text("Open Telegram coach")').count();
  90 |     const connectTelegramVisible = await page.locator('button:has-text("Connect Telegram")').count();
  91 |     const enableGuardianVisible = await page.locator('text=Enable Guardian').count();
  92 |     expect(openTelegramVisible).toBe(0);
  93 |     expect(connectTelegramVisible).toBe(0);
  94 |     expect(enableGuardianVisible).toBeGreaterThan(0);
  95 |   });
  96 | });
  97 | 
```