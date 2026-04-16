# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: verify-telegram-handoff.spec.ts >> Telegram handoff after session start >> guardian disabled user does not show telegram handoff primary action
- Location: verify-telegram-handoff.spec.ts:86:7

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
            - generic [ref=e24]: Guardian off
            - heading "Guardian is disabled." [level=2] [ref=e25]
            - paragraph [ref=e26]: Protection rules are not enforcing today’s session.
            - generic [ref=e27]:
              - paragraph [ref=e28]: What to do next
              - paragraph [ref=e29]: Turn Guardian back on before relying on the session boundaries.
              - link "Enable Guardian" [ref=e30] [cursor=pointer]:
                - /url: /guardian
          - generic [ref=e31]:
            - generic [ref=e32]:
              - generic [ref=e33]:
                - paragraph [ref=e34]: Today status
                - paragraph [ref=e35]: Guardian off
              - generic [ref=e36]:
                - paragraph [ref=e37]: Next reset
                - paragraph [ref=e38]: Apr 14, 2026, 9:00 AM UTC
                - paragraph [ref=e39]: "Reset mode: Daily"
            - generic [ref=e40]:
              - generic [ref=e41]:
                - paragraph [ref=e42]: Trades
                - paragraph [ref=e43]: "0"
              - generic [ref=e44]:
                - paragraph [ref=e45]: P&L
                - paragraph [ref=e46]: "0"
              - generic [ref=e47]:
                - paragraph [ref=e48]: Loss streak
                - paragraph [ref=e49]: "0"
            - generic [ref=e50]:
              - paragraph [ref=e51]: Active limits
              - generic [ref=e52]:
                - generic [ref=e53]: "Reset mode: Daily reset"
                - generic [ref=e54]: "Reset time zone: UTC"
                - generic [ref=e55]: "Daily reset hour: 9:00"
                - generic [ref=e56]: "Copy trade mode: Off"
        - generic [ref=e57]:
          - generic [ref=e58]:
            - generic [ref=e59]:
              - heading "Account" [level=2] [ref=e60]
              - paragraph [ref=e61]: Authenticated website account details.
            - generic [ref=e62]:
              - generic [ref=e63]:
                - term [ref=e64]: Email
                - definition [ref=e65]: guardian.disabled@example.com
              - generic [ref=e66]:
                - term [ref=e67]: Role
                - definition [ref=e68]: USER
          - generic [ref=e69]:
            - generic [ref=e70]:
              - heading "Access status" [level=2] [ref=e71]
              - paragraph [ref=e72]: Trial and subscription state control website and bot availability.
            - generic [ref=e73]:
              - generic [ref=e74]:
                - term [ref=e75]: Subscription status
                - definition [ref=e76]: TRIALING
              - generic [ref=e77]:
                - term [ref=e78]: Trial started
                - definition [ref=e79]: Apr 13, 2026, 10:20 AM
              - generic [ref=e80]:
                - term [ref=e81]: Trial ends
                - definition [ref=e82]: Apr 21, 2026, 10:20 AM
              - generic [ref=e83]:
                - term [ref=e84]: Trial active
                - definition [ref=e85]: Yes, trial access is active.
          - generic [ref=e86]:
            - generic [ref=e87]:
              - heading "Onboarding status" [level=2] [ref=e88]
              - paragraph [ref=e89]: Core profile status for the coaching account.
            - paragraph [ref=e91]: Onboarding profile is in place.
          - generic [ref=e92]:
            - generic [ref=e93]:
              - heading "Telegram status" [level=2] [ref=e94]
              - paragraph [ref=e95]: Connection status for the mental coach bot.
            - generic [ref=e96]:
              - paragraph [ref=e97]: Telegram is not connected yet.
              - paragraph [ref=e98]: Use the Telegram connect flow to link the authenticated account to the bot.
          - generic [ref=e99]:
            - generic [ref=e100]:
              - heading "Trading Guardian" [level=2] [ref=e101]
              - paragraph [ref=e102]: Quick access to Guardian status and controls.
            - generic [ref=e103]:
              - generic [ref=e104]:
                - generic [ref=e105]:
                  - paragraph [ref=e106]: Guardian
                  - paragraph [ref=e107]: Inactive
                  - paragraph [ref=e108]: "Connection: Mock connected"
                - generic [ref=e109]:
                  - paragraph [ref=e110]: Summary
                  - paragraph [ref=e111]: Guardian is off, so session limits are not enforcing the day.
              - link "Open Guardian" [ref=e112] [cursor=pointer]:
                - /url: /guardian
          - generic [ref=e113]:
            - generic [ref=e114]:
              - heading "Live trader state" [level=2] [ref=e115]
              - paragraph [ref=e116]: Secondary context for coach replies. Guardian still decides whether trading is allowed.
            - generic [ref=e117]:
              - paragraph [ref=e118]: "Current state: none"
              - paragraph [ref=e119]: No live state is active right now.
              - generic [ref=e120]:
                - generic [ref=e121]:
                  - paragraph [ref=e122]: Cooldown
                  - paragraph [ref=e123]: Not active
                  - paragraph [ref=e124]: Until Not set
                - generic [ref=e125]:
                  - paragraph [ref=e126]: Recent loss streak
                  - paragraph [ref=e127]: "0"
                  - paragraph [ref=e128]: Updated Not set
                - generic [ref=e129]:
                  - paragraph [ref=e130]: Events today
                  - paragraph [ref=e131]: "0"
                  - paragraph [ref=e132]: "Distress moments: 0"
  - button "Open Next.js Dev Tools" [ref=e138] [cursor=pointer]:
    - img [ref=e139]
  - alert [ref=e142]
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
> 93 |     expect(connectTelegramVisible).toBe(0);
     |                                    ^ Error: expect(received).toBe(expected) // Object.is equality
  94 |     expect(enableGuardianVisible).toBeGreaterThan(0);
  95 |   });
  96 | });
  97 | 
```