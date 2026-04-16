import { test, expect } from '@playwright/test';

const baseURL = 'http://localhost:3000';
const password = 'Password123!';

async function login(page, email) {
  await page.goto(`${baseURL}/login`);
  await expect(page.locator('role=button[name="Log in"]')).toBeVisible();
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  const [response] = await Promise.all([
    page.waitForResponse((resp) => resp.url().endsWith('/api/auth/login') && resp.status() === 200),
    page.click('role=button[name="Log in"]'),
  ]);
  expect(response.ok()).toBeTruthy();
  await page.waitForURL('**/onboarding', { timeout: 10000 });
}

async function goToDashboard(page) {
  await page.goto(`${baseURL}/dashboard`);
  await expect(page).toHaveURL(/.*\/dashboard$/);
}

async function getPanel(page) {
  return page.locator('section').first();
}

async function getCtaText(page) {
  const panel = await getPanel(page);
  const button = panel.locator('button:visible, a:visible').filter({ hasText: /Start session|Open Telegram coach|Connect Telegram|Enable Guardian|Open Guardian|Complete onboarding/ });
  const count = await button.count();
  if (count === 0) return null;
  return await button.first().textContent();
}

async function getHandoffText(page) {
  const locator = page.locator('section p', { hasText: /Continue live coaching in Telegram|Connect Telegram now|Trade the plan/ });
  return (await locator.first().textContent())?.trim() ?? null;
}

test.describe('Telegram handoff after session start', () => {
  test('ready-to-trade linked user', async ({ page }) => {
    await login(page, 'ready.linked@example.com');
    await goToDashboard(page);
    await expect(page.locator('button:has-text("Start session")')).toBeVisible();
    const before = await getCtaText(page);
    await Promise.all([
      page.waitForResponse((resp) => resp.url().endsWith('/api/guardian/start-session') && resp.status() === 200),
      page.click('button:has-text("Start session")'),
    ]);
    await page.waitForLoadState('networkidle');
    await page.reload();
    const after = await getCtaText(page);
    const handoff = await getHandoffText(page);
    expect(after).toContain('Open Telegram coach');
    expect(handoff).toContain('Continue live coaching in Telegram');
    test.info().annotations.push({ type: 'before-cta', description: before ?? '' });
    test.info().annotations.push({ type: 'after-cta', description: after ?? '' });
  });

  test('ready-to-trade unlinked user', async ({ page }) => {
    await login(page, 'ready.unlinked@example.com');
    await goToDashboard(page);
    await expect(page.locator('button:has-text("Start session")')).toBeVisible();
    const before = await getCtaText(page);
    await Promise.all([
      page.waitForResponse((resp) => resp.url().endsWith('/api/guardian/start-session') && resp.status() === 200),
      page.click('button:has-text("Start session")'),
    ]);
    await page.waitForLoadState('networkidle');
    await page.reload();
    const after = await getCtaText(page);
    const handoff = await getHandoffText(page);
    expect(after).toContain('Connect Telegram');
    expect(handoff).toContain('Connect Telegram now');
    test.info().annotations.push({ type: 'before-cta', description: before ?? '' });
    test.info().annotations.push({ type: 'after-cta', description: after ?? '' });
  });

  test('locked user does not show start session or telegram handoff primary action', async ({ page }) => {
    await login(page, 'locked.user@example.com');
    await goToDashboard(page);
    const panel = await getPanel(page);
    const startVisible = await panel.locator('button:has-text("Start session")').count();
    const openTelegramVisible = await panel.locator('a:has-text("Open Telegram coach")').count();
    const connectTelegramVisible = await panel.locator('button:has-text("Connect Telegram")').count();
    expect(startVisible).toBe(0);
    expect(openTelegramVisible).toBe(0);
    expect(connectTelegramVisible).toBe(0);
  });

  test('guardian disabled user does not show telegram handoff primary action', async ({ page }) => {
    await login(page, 'guardian.disabled@example.com');
    await goToDashboard(page);
    const panel = await getPanel(page);
    const openTelegramVisible = await panel.locator('a:has-text("Open Telegram coach")').count();
    const connectTelegramVisible = await panel.locator('button:has-text("Connect Telegram")').count();
    const enableGuardianVisible = await panel.locator('text=Enable Guardian').count();
    expect(openTelegramVisible).toBe(0);
    expect(connectTelegramVisible).toBe(0);
    expect(enableGuardianVisible).toBeGreaterThan(0);
  });
});
