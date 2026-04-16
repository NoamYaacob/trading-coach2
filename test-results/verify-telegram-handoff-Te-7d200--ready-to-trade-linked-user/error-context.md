# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: verify-telegram-handoff.spec.ts >> Telegram handoff after session start >> ready-to-trade linked user
- Location: verify-telegram-handoff.spec.ts:37:7

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
        - button "Logout" [ref=e18]
      - generic [ref=e19]:
        - generic [ref=e21]:
          - generic [ref=e22]:
            - generic [ref=e23]: Session active
            - heading "Session is active." [level=2] [ref=e24]
            - paragraph [ref=e25]: Started at Apr 14, 2026, 7:25 AM UTC from dashboard.
            - generic [ref=e26]:
              - paragraph [ref=e27]: What to do next
              - paragraph [ref=e28]: Your session started on the dashboard. Continue live coaching in Telegram.
              - link "Open Telegram coach" [ref=e29] [cursor=pointer]:
                - /url: https://t.me/NoamCoachBot
          - generic [ref=e30]:
            - generic [ref=e31]:
              - generic [ref=e32]:
                - paragraph [ref=e33]: Today status
                - paragraph [ref=e34]: Trading open
                - paragraph [ref=e35]: Started Apr 14, 2026, 7:25 AM UTC
                - paragraph [ref=e36]: Started from dashboard.
              - generic [ref=e37]:
                - paragraph [ref=e38]: Next reset
                - paragraph [ref=e39]: Apr 14, 2026, 9:00 AM UTC
                - paragraph [ref=e40]: "Reset mode: Daily"
            - generic [ref=e41]:
              - generic [ref=e42]:
                - paragraph [ref=e43]: Trades
                - paragraph [ref=e44]: "0"
              - generic [ref=e45]:
                - paragraph [ref=e46]: P&L
                - paragraph [ref=e47]: "0"
              - generic [ref=e48]:
                - paragraph [ref=e49]: Loss streak
                - paragraph [ref=e50]: "0"
            - generic [ref=e51]:
              - paragraph [ref=e52]: Active limits
              - paragraph [ref=e53]: Started from dashboard.
              - generic [ref=e54]:
                - generic [ref=e55]: "Reset mode: Daily reset"
                - generic [ref=e56]: "Reset time zone: UTC"
                - generic [ref=e57]: "Daily reset hour: 9:00"
                - generic [ref=e58]: "Copy trade mode: Off"
        - generic [ref=e59]:
          - generic [ref=e60]:
            - generic [ref=e61]:
              - heading "Account" [level=2] [ref=e62]
              - paragraph [ref=e63]: Authenticated website account details.
            - generic [ref=e64]:
              - generic [ref=e65]:
                - term [ref=e66]: Email
                - definition [ref=e67]: ready.linked@example.com
              - generic [ref=e68]:
                - term [ref=e69]: Role
                - definition [ref=e70]: USER
          - generic [ref=e71]:
            - generic [ref=e72]:
              - heading "Access status" [level=2] [ref=e73]
              - paragraph [ref=e74]: Trial and subscription state control website and bot availability.
            - generic [ref=e75]:
              - generic [ref=e76]:
                - term [ref=e77]: Subscription status
                - definition [ref=e78]: TRIALING
              - generic [ref=e79]:
                - term [ref=e80]: Trial started
                - definition [ref=e81]: Apr 13, 2026, 10:20 AM
              - generic [ref=e82]:
                - term [ref=e83]: Trial ends
                - definition [ref=e84]: Apr 21, 2026, 10:20 AM
              - generic [ref=e85]:
                - term [ref=e86]: Trial active
                - definition [ref=e87]: Yes, trial access is active.
          - generic [ref=e88]:
            - generic [ref=e89]:
              - heading "Onboarding status" [level=2] [ref=e90]
              - paragraph [ref=e91]: Core profile status for the coaching account.
            - paragraph [ref=e93]: Onboarding profile is in place.
          - generic [ref=e94]:
            - generic [ref=e95]:
              - heading "Telegram status" [level=2] [ref=e96]
              - paragraph [ref=e97]: Connection status for the mental coach bot.
            - generic [ref=e98]:
              - paragraph [ref=e99]: Telegram is connected and bot access is active.
              - paragraph [ref=e100]: Connected as @test_trader
          - generic [ref=e101]:
            - generic [ref=e102]:
              - heading "Trading Guardian" [level=2] [ref=e103]
              - paragraph [ref=e104]: Quick access to Guardian status and controls.
            - generic [ref=e105]:
              - generic [ref=e106]:
                - generic [ref=e107]:
                  - paragraph [ref=e108]: Guardian
                  - paragraph [ref=e109]: Active
                  - paragraph [ref=e110]: "Connection: Mock connected"
                - generic [ref=e111]:
                  - paragraph [ref=e112]: Summary
                  - paragraph [ref=e113]: Session is already active and tracking from the dashboard.
              - link "Open Guardian" [ref=e114] [cursor=pointer]:
                - /url: /guardian
          - generic [ref=e115]:
            - generic [ref=e116]:
              - heading "Live trader state" [level=2] [ref=e117]
              - paragraph [ref=e118]: Secondary context for coach replies. Guardian still decides whether trading is allowed.
            - generic [ref=e119]:
              - paragraph [ref=e120]: "Current state: none"
              - paragraph [ref=e121]: No live state is active right now.
              - generic [ref=e122]:
                - generic [ref=e123]:
                  - paragraph [ref=e124]: Cooldown
                  - paragraph [ref=e125]: Not active
                  - paragraph [ref=e126]: Until Not set
                - generic [ref=e127]:
                  - paragraph [ref=e128]: Recent loss streak
                  - paragraph [ref=e129]: "0"
                  - paragraph [ref=e130]: Updated Not set
                - generic [ref=e131]:
                  - paragraph [ref=e132]: Events today
                  - paragraph [ref=e133]: "0"
                  - paragraph [ref=e134]: "Distress moments: 0"
  - button "Open Next.js Dev Tools" [ref=e140] [cursor=pointer]:
    - img [ref=e141]
  - alert [ref=e144]
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
> 40 |     await expect(page.locator('button:has-text("Start session")')).toBeVisible();
     |                                                                    ^ Error: expect(locator).toBeVisible() failed
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
  59 |     await expect(page.locator('button:has-text("Start session")')).toBeVisible();
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