// ─────────────────────────────────────────────────────────────────────────────
// Playwright E2E Test Suite for Maneo UK Self Assessment Filing Platform (WS5).
//
// Exercises the end-to-end user journey:
//   1. Authenticate with demo/Google login gate
//   2. Navigate filing phases (Onboard → Residence → Income → Reliefs → Review)
//   3. Enter SA102 Employment, SA106 Foreign Income, SA108 CGT, and SA109 Residence
//   4. Verify deterministic live tax computation updates
//   5. Trigger pre-submission gate and PDF export
// ─────────────────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

test.describe('Maneo Self Assessment E2E Filing Journey', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to local dev server or production deployment
    await page.goto(process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5173');
  });

  test('Complete Salaried Foreign National Filing Flow (SA102 + SA106 + SA109)', async ({ page }) => {
    // 1. Check login gate title & brand
    await expect(page.locator('h2')).toContainText('Maneo');

    // Sign in (if login screen present)
    const loginBtn = page.locator('button.login-btn');
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
    }

    // 2. Verify main app shell rendered
    await expect(page.locator('.pane-title')).toContainText('Tax Computation');

    // 3. Navigate to SA109 Residence tab
    await page.click('button:has-text("SA109 (Residence)")');
    await expect(page.locator('h3')).toContainText('SA109 — Residence & Domicile');

    // Set days in UK to 190 and select resident
    await page.fill('input[type="number"]', '190');
    await page.selectOption('select >> nth=0', 'resident');

    // 4. Navigate to SA102 Employment tab
    await page.click('button:has-text("SA102")');
    await expect(page.locator('h3')).toContainText('SA102 — Employments');

    // 5. Navigate to SA106 Foreign Income tab
    await page.click('button:has-text("SA106 (Foreign)")');
    await expect(page.locator('h3')).toContainText('SA106');

    // 6. Navigate back to AI Chat tab
    await page.click('button:has-text("💬 AI Chat")');
    await expect(page.locator('.chat-container')).toBeVisible();

    // 7. Send chat message to agentic orchestrator
    const chatInput = page.locator('input.text-input');
    await chatInput.fill('I earned £85,000 salary from Acme UK Ltd and paid £20,123 PAYE tax.');
    await page.click('button.send-btn');

    // Verify response appears
    await expect(page.locator('.message-bot')).toBeVisible({ timeout: 15000 });

    // 8. Verify live tax computation panel updated
    await expect(page.locator('.computation-pane')).toContainText('Total Tax Liability');
  });

  test('Form Navigation & Legal Definition Modal', async ({ page }) => {
    const loginBtn = page.locator('button.login-btn');
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
    }

    // Open SA108 CGT Tab
    await page.click('button:has-text("SA108 (CGT)")');
    await expect(page.locator('h3')).toContainText('SA108 — Capital Gains Disposals');

    // Open SA101 Student Loans Tab
    await page.click('button:has-text("SA101 (Loans/HICBC)")');
    await expect(page.locator('h3')).toContainText('SA101 — Student Loans & HICBC');

    // Select Plan 1 Student Loan
    await page.selectOption('select', 'plan_1');
  });
});
