# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: verify-telegram-handoff.spec.ts >> Telegram handoff after session start >> locked user does not show start session or telegram handoff primary action
- Location: verify-telegram-handoff.spec.ts:75:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 1
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
            - generic [ref=e24]: Reset pending
            - heading "Trading is locked for today." [level=2] [ref=e25]
            - paragraph [ref=e26]: Daily trade limit reached
            - generic [ref=e27]:
              - paragraph [ref=e28]: What to do next
              - paragraph [ref=e29]: Wait for the reset window before trying to start a new session.
              - link "Open Guardian" [ref=e30] [cursor=pointer]:
                - /url: /guardian
          - generic [ref=e31]:
            - generic [ref=e32]:
              - generic [ref=e33]:
                - paragraph [ref=e34]: Today status
                - paragraph [ref=e35]: Trading locked
                - paragraph [ref=e36]: "Reason: Daily trade limit reached"
              - generic [ref=e37]:
                - paragraph [ref=e38]: Next reset
                - paragraph [ref=e39]: Apr 14, 2026, 1:26 PM UTC
                - paragraph [ref=e40]: "Reset mode: Daily"
            - generic [ref=e41]:
              - generic [ref=e42]:
                - paragraph [ref=e43]: Trades
                - paragraph [ref=e44]: "10"
              - generic [ref=e45]:
                - paragraph [ref=e46]: P&L
                - paragraph [ref=e47]: "0"
              - generic [ref=e48]:
                - paragraph [ref=e49]: Loss streak
                - paragraph [ref=e50]: "0"
            - generic [ref=e51]:
              - paragraph [ref=e52]: Active limits
              - generic [ref=e53]:
                - generic [ref=e54]: "Max trades per day: 1"
                - generic [ref=e55]: "Reset mode: Daily reset"
                - generic [ref=e56]: "Reset time zone: UTC"
                - generic [ref=e57]: "Daily reset hour: 9:00"
        - generic [ref=e58]:
          - generic [ref=e59]:
            - generic [ref=e60]:
              - heading "Account" [level=2] [ref=e61]
              - paragraph [ref=e62]: Authenticated website account details.
            - generic [ref=e63]:
              - generic [ref=e64]:
                - term [ref=e65]: Email
                - definition [ref=e66]: locked.user@example.com
              - generic [ref=e67]:
                - term [ref=e68]: Role
                - definition [ref=e69]: USER
          - generic [ref=e70]:
            - generic [ref=e71]:
              - heading "Access status" [level=2] [ref=e72]
              - paragraph [ref=e73]: Trial and subscription state control website and bot availability.
            - generic [ref=e74]:
              - generic [ref=e75]:
                - term [ref=e76]: Subscription status
                - definition [ref=e77]: TRIALING
              - generic [ref=e78]:
                - term [ref=e79]: Trial started
                - definition [ref=e80]: Apr 13, 2026, 10:20 AM
              - generic [ref=e81]:
                - term [ref=e82]: Trial ends
                - definition [ref=e83]: Apr 21, 2026, 10:20 AM
              - generic [ref=e84]:
                - term [ref=e85]: Trial active
                - definition [ref=e86]: Yes, trial access is active.
          - generic [ref=e87]:
            - generic [ref=e88]:
              - heading "Onboarding status" [level=2] [ref=e89]
              - paragraph [ref=e90]: Core profile status for the coaching account.
            - paragraph [ref=e92]: Onboarding profile is in place.
          - generic [ref=e93]:
            - generic [ref=e94]:
              - heading "Telegram status" [level=2] [ref=e95]
              - paragraph [ref=e96]: Connection status for the mental coach bot.
            - generic [ref=e97]:
              - paragraph [ref=e98]: Telegram is not connected yet.
              - paragraph [ref=e99]: Use the Telegram connect flow to link the authenticated account to the bot.
          - generic [ref=e100]:
            - generic [ref=e101]:
              - heading "Trading Guardian" [level=2] [ref=e102]
              - paragraph [ref=e103]: Quick access to Guardian status and controls.
            - generic [ref=e104]:
              - generic [ref=e105]:
                - generic [ref=e106]:
                  - paragraph [ref=e107]: Guardian
                  - paragraph [ref=e108]: Active
                  - paragraph [ref=e109]: "Connection: Mock connected"
                - generic [ref=e110]:
                  - paragraph [ref=e111]: Summary
                  - paragraph [ref=e112]: Guardian has closed the session for today.
              - link "Open Guardian" [ref=e113] [cursor=pointer]:
                - /url: /guardian
          - generic [ref=e114]:
            - generic [ref=e115]:
              - heading "Live trader state" [level=2] [ref=e116]
              - paragraph [ref=e117]: Secondary context for coach replies. Guardian still decides whether trading is allowed.
            - generic [ref=e118]:
              - generic [ref=e119]:
                - paragraph [ref=e120]: Trading permission is already set by Today Session.
                - paragraph [ref=e121]: This card is only showing short-term trader context for the coach.
              - paragraph [ref=e122]: "Current state: none"
              - paragraph [ref=e123]: No live state is active right now.
              - generic [ref=e124]:
                - generic [ref=e125]:
                  - paragraph [ref=e126]: Cooldown
                  - paragraph [ref=e127]: Not active
                  - paragraph [ref=e128]: Until Not set
                - generic [ref=e129]:
                  - paragraph [ref=e130]: Recent loss streak
                  - paragraph [ref=e131]: "0"
                  - paragraph [ref=e132]: Updated Not set
                - generic [ref=e133]:
                  - paragraph [ref=e134]: Events today
                  - paragraph [ref=e135]: "0"
                  - paragraph [ref=e136]: "Distress moments: 0"
  - button "Open Next.js Dev Tools" [ref=e142] [cursor=pointer]:
    - img [ref=e143]
  - alert [ref=e146]
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
> 83 |     expect(connectTelegramVisible).toBe(0);
     |                                    ^ Error: expect(received).toBe(expected) // Object.is equality
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