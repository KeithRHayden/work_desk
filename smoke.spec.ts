import { type Locator, type Page } from '@playwright/test';
import { test, expect } from './fixtures';

const DESK_URL = '/work-desk.html';
const WORK_KEY = 'work-desk-data-work';

/** Prefer Continue offline; fall back to hiding the modal for older builds. */
async function dismissAuthModal(page: Page) {
  const modal = page.locator('#auth-modal');
  if (!(await modal.isVisible().catch(() => false))) return;
  const offline = page.locator('#auth-offline-btn');
  if (await offline.isVisible().catch(() => false)) {
    await offline.click();
  } else {
    await page.evaluate(() => {
      document.getElementById('auth-modal')?.classList.add('hidden');
    });
  }
  await expect(modal).toBeHidden();
}

/** Options settings sit behind summary rows; open the section holding `selector` (Options must already be open). */
async function openOptionsSectionFor(page: Page, selector: string) {
  const info = await page.locator(selector).first().evaluate(el => {
    const s = el.closest('.options-section');
    return s ? { id: s.getAttribute('data-options-section')!, pane: s.closest('.options-pane')!.id, open: !s.hasAttribute('hidden') } : null;
  });
  if (!info || info.open) return;
  const pane = page.locator(`#${info.pane}`);
  if (!(await pane.isVisible())) await page.locator(`.options-nav-btn[data-options-tab="${info.pane.replace('options-pane-', '')}"]`).click();
  const back = pane.locator('.options-section:not([hidden]) [data-options-back]');
  if (await back.count()) await back.click();
  await pane.locator(`[data-options-open="${info.id}"]`).click();
  await expect(page.locator(selector).first()).toBeAttached();
  await expect(pane.locator(`[data-options-section="${info.id}"]`)).toBeVisible();
}

async function openAccountMenu(page: Page) {
  if (await page.locator('#account-menu').isVisible()) return;
  await page.locator('#account-menu-btn').click();
  await expect(page.locator('#account-menu')).toBeVisible();
}

async function openDesk(page: Page) {
  // Seed only once per browser context — init scripts also run on reload,
  // so never clear localStorage here or persistence tests will fail.
  await page.addInitScript(() => {
    if (!localStorage.getItem('work-desk-list-context')) {
      localStorage.setItem('work-desk-list-context', 'work');
    }
    if (!localStorage.getItem('work-desk-data-work')) {
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: {}, deletedIds: {} }));
    }
    if (!localStorage.getItem('work-desk-data-personal')) {
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    }
  });
  await page.goto(DESK_URL);
  await dismissAuthModal(page);
  await expect(page.locator('#add-form')).toBeVisible();
}

// ── App updates & search matching ───────────────────────────────────────
test.describe('App update prompt', { tag: ['@app'] }, () => {
  const serveIndexVersion = (page: Page, version: string) =>
    page.route('**/work_desk/index.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: `<script>const APP_VERSION = '${version}';</script>` }));
  const returnToApp = (page: Page) =>
    page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  test('offers a Reload when a newer version is deployed', async ({ page }) => {
    await serveIndexVersion(page, '99.0.0');
    await openDesk(page);
    await returnToApp(page);
    const toast = page.locator('#toast');
    await expect(toast).toContainText('Work Desk 99.0.0 is available');
    const reload = toast.locator('button', { hasText: 'Reload' });
    await expect(reload).toBeVisible();
    await Promise.all([page.waitForEvent('load'), reload.click()]);
    await dismissAuthModal(page);
    await expect(page.locator('#add-form')).toBeVisible();
  });

  test('stays quiet when already on the latest version', async ({ page }) => {
    await openDesk(page);
    const current = await page.evaluate(() => (window as any).eval('APP_VERSION'));
    await serveIndexVersion(page, current);
    await returnToApp(page);
    await page.waitForTimeout(500);
    await expect(page.locator('#toast')).not.toContainText('is available');
  });
});

test.describe('Search matching', { tag: ['@search'] }, () => {
  test('matches across non-breaking spaces and line breaks', async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem('work-desk-data-work')) return;
      const d = new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      localStorage.setItem('work-desk-data-work', JSON.stringify({
        days: { [key]: { date: key, items: [{
          id: 'nbsp-1', type: 'task', completed: true, createdAt: d.toISOString(),
          content: 'Call&nbsp;vendor<div>about the renewal</div>',
        }] } },
        deletedIds: {},
      }));
    });
    await openDesk(page);
    const search = page.locator('#search-input');
    const count = page.locator('#search-overlay-count');

    await search.fill('call vendor');
    await expect(count).toHaveText('1 result');
    await search.fill('vendor about');
    await expect(count).toHaveText('1 result');
    await search.fill('vendorabout');
    await expect(count).toHaveText('No matches');
  });
});

// ── Desktop must not change when phone layouts do ─────────────────────────────
async function seedLayout(page: Page, extra: Record<string, string> = {}) {
  await page.clock.setFixedTime(new Date('2026-09-30T10:00:00'));
  await page.addInitScript((extraKeys) => {
    if (localStorage.getItem('layout-seeded')) return;
    localStorage.setItem('layout-seeded', '1');
    const t = (id: string, content: string, more = {}) => ({
      id, type: 'task', content, completed: false, shelved: false, boardColumn: 'new',
      comments: [], tags: ['ace'], createdAt: '2026-09-28T09:00:00Z', ...more,
    });
    const days = {
      '2026-09-28': { date: '2026-09-28', items: [t('done1', 'Renew vendor contract', { completed: true })] },
      '2026-09-30': { date: '2026-09-30', items: [
        t('open1', 'Review PR for IDS batching'),
        t('open2', 'Call vendor about the renewal', { boardColumn: 'active' }),
        t('done2', 'Send sprint notes', { completed: true }),
      ] },
    };
    localStorage.setItem('work-desk-list-context', 'work');
    localStorage.setItem('work-desk-data-work', JSON.stringify({ days, deletedIds: {} }));
    localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    for (const [k, v] of Object.entries(extraKeys)) localStorage.setItem(k, v);
  }, extra);
  await page.goto(DESK_URL);
  await dismissAuthModal(page);
  await expect(page.locator('#add-form')).toBeVisible();
}

test.describe('Desktop layout baselines', { tag: ['@visual'] }, () => {
  // Re-captured at 1.13.3 (page scroll on .main with a reserved scrollbar gutter). Version text is masked so bumps don't count as changes.
  const shot = (page: Page, name: string) =>
    expect(page).toHaveScreenshot(name, {
      fullPage: true,
      mask: [page.locator('#version-btn'), page.locator('#version-new-dot'), page.locator('#toast')],
    });

  for (const width of [1440, 1024, 820]) {
    test(`desk at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedLayout(page);
      await shot(page, `desk-${width}.png`);
    });
  }

  test('insights at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page);
    await page.locator('#tab-insights').click();
    await page.locator('.period-tab', { hasText: 'Week' }).click();
    await shot(page, 'insights-1440.png');
  });

  test('collapsed sidebar at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page, { 'work-desk-sidebar-collapsed': '1' });
    await shot(page, 'desk-collapsed-1440.png');
  });

  test('options panel at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page);
    await page.locator('#density-toggle').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await shot(page, 'options-1440.png');
  });

  test('export menu at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page);
    await openAccountMenu(page);
    await page.locator('#export-btn').click();
    await expect(page.locator('#export-menu')).toBeVisible();
    await shot(page, 'export-1440.png');
  });
});

test.describe('Phone layout baselines', { tag: ['@visual', '@phone'] }, () => {
  const shot = (page: Page, name: string) =>
    expect(page).toHaveScreenshot(name, {
      mask: [page.locator('#mobile-menu-version'), page.locator('#mobile-menu-new-dot'), page.locator('#toast')],
    });

  test('phone desk and menu at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLayout(page);
    await shot(page, 'phone-desk-390.png');
    await page.locator('#mobile-menu-btn').click();
    await expect(page.locator('#mobile-menu-sheet')).toBeVisible();
    await shot(page, 'phone-menu-390.png');
  });
});

test.describe('Phone menu (1.13.0)', { tag: ['@phone', '@sidebar'] }, () => {
  const sheet = (page: Page) => page.locator('#mobile-menu-sheet');
  const menuBtn = (page: Page) => page.locator('#mobile-menu-btn');

  async function openPhone(page: Page, width = 390, extra: Record<string, string> = {}) {
    await page.setViewportSize({ width, height: 844 });
    await seedLayout(page, extra);
  }

  async function openMenu(page: Page) {
    await menuBtn(page).click();
    await expect(sheet(page)).toBeVisible();
    await expect(menuBtn(page)).toHaveAttribute('aria-expanded', 'true');
  }

  async function expectMenuClosed(page: Page) {
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator('#mobile-menu-backdrop')).toBeHidden();
    await expect(menuBtn(page)).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.body.classList.contains('mobile-menu-open'))).toBe(false);
    // Account and backup are back in the sidebar, not left in the sheet
    await expect(page.locator('.sidebar #sidebar-account')).toHaveCount(1);
    await expect(page.locator('.sidebar .sidebar-backup')).toHaveCount(1);
    await expect(page.locator('#mobile-menu-moved > *')).toHaveCount(0);
  }

  const singleIds = ['export-btn', 'import-btn', 'repair-btn', 'sb-signin-btn', 'sb-signout-btn', 'density-popout', 'density-toggle', 'version-btn'];
  const expectNoDuplicates = async (page: Page) => {
    const counts = await page.evaluate((ids) => ids.map((id) => document.querySelectorAll(`#${id}`).length), singleIds);
    expect(counts).toEqual(singleIds.map(() => 1));
  };

  test('phone shows tabs, search, and a menu button; rarely used rows are tucked away', async ({ page }) => {
    await openPhone(page);
    for (const sel of ['#tab-desk', '#tab-insights', '#tab-work', '#tab-personal', '#tab-projects', '#search-input', '#help-btn', '#mobile-menu-btn', '#mobile-sync-dot']) {
      await expect(page.locator(sel)).toBeVisible();
    }
    for (const sel of ['#sidebar-account', '.sidebar-backup', '#sidebar-today-glance', '#version-btn', '#density-toggle', '#mobile-menu-sheet']) {
      await expect(page.locator(sel)).toBeHidden();
    }
    const box = await menuBtn(page).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(36);
    expect(box!.height).toBeGreaterThanOrEqual(36);
    // Tasks start well above where they did when the whole sidebar was stacked on top (~430px of sidebar)
    const firstTask = await page.locator('.item-card').first().evaluate((el) => el.getBoundingClientRect().top + scrollY);
    expect(firstTask).toBeLessThan(470);
  });

  test('menu opens over the desk with account, backup, Options, and What\'s new', async ({ page }) => {
    await openPhone(page);
    await openMenu(page);
    for (const sel of ['#account-email', '#sb-signin-btn', '#export-btn', '#import-btn', '#repair-btn', '#mobile-menu-options', '#mobile-menu-whatsnew']) {
      await expect(sheet(page).locator(sel)).toBeVisible();
    }
    const version = await page.evaluate(() => (window as any).eval('APP_VERSION'));
    await expect(page.locator('#mobile-menu-version')).toHaveText(`v${version}`);
    // Sits above the pinned add-task dock
    const hit = await page.locator('#import-btn').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id;
    });
    expect(hit).toBe('import-btn');
    await expectNoDuplicates(page);
  });

  test('menu closes with the close button, a tap outside, Esc, and the menu button', async ({ page }) => {
    await openPhone(page);
    await openMenu(page);
    await page.locator('#mobile-menu-close').click();
    await expectMenuClosed(page);

    await openMenu(page);
    await page.mouse.click(195, 60);
    await expectMenuClosed(page);

    await openMenu(page);
    await page.keyboard.press('Escape');
    await expectMenuClosed(page);

    await openMenu(page);
    await menuBtn(page).click({ force: true });
    await expectMenuClosed(page);
    await expectNoDuplicates(page);
  });

  test('swiping the sheet handle down closes it', async ({ page }) => {
    await openPhone(page);
    await openMenu(page);
    await page.locator('.mobile-menu-grab').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const touch = (y: number) => new Touch({ identifier: 1, target: el, clientX: r.left + 20, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(r.top + 4)], bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(r.top + 90)], bubbles: true }));
    });
    await expectMenuClosed(page);
  });

  test('Export and Import work from the menu and keep it open', async ({ page }) => {
    await openPhone(page);
    await openMenu(page);
    await page.locator('#export-btn').click();
    await expect(page.locator('#export-menu')).toBeVisible();
    await expect(sheet(page)).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-desk-opt').click()]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    await expect(sheet(page)).toBeVisible();

    await page.locator('#import-btn').click();
    await expect(page.locator('#import-menu')).toBeVisible();
    await expect(page.locator('#export-menu')).toBeHidden();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#import-desk-opt').click()]);
    expect(chooser).toBeTruthy();

    await page.locator('#export-btn').click();
    await page.locator('#mobile-menu-close').click();
    await expectMenuClosed(page);
    await expect(page.locator('#export-menu')).toBeHidden();
  });

  test('Repair duplicates and Sign in work from the menu', async ({ page }) => {
    await openPhone(page);
    await openMenu(page);
    await page.locator('#repair-btn').click();
    await expect(page.locator('#toast')).toBeVisible();
    await page.locator('#sb-signin-btn').click();
    await expect(page.locator('#auth-modal')).toBeVisible();
  });

  test('Options opens the settings sheet from any tab and closes on a tap outside', async ({ page }) => {
    await openPhone(page);
    await openMenu(page);
    await page.locator('#mobile-menu-options').click();
    await expect(sheet(page)).toBeHidden();
    const popout = page.locator('#density-popout');
    await expect(popout).toBeVisible();
    await expect(page.locator('#mobile-menu-backdrop')).toBeVisible();
    const box = await popout.boundingBox();
    expect(Math.round(box!.y + box!.height)).toBeLessThanOrEqual(844);
    expect(Math.round(box!.width)).toBe(390);

    // Switching tabs inside replaces content; the sheet must stay open
    for (const tab of ['appearance', 'behavior', 'themes']) {
      await page.locator(`.options-nav-btn[data-options-tab="${tab}"]`).click();
      await expect(popout).toBeVisible();
    }

    await page.mouse.click(195, 40);
    await expect(popout).toBeHidden();
    await expect(page.locator('#mobile-menu-backdrop')).toBeHidden();
    expect(await popout.evaluate((el) => el.parentElement!.classList.contains('density-wrap'))).toBe(true);

    await page.locator('#tab-insights').click();
    await openMenu(page);
    await page.locator('#mobile-menu-options').click();
    await expect(popout).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popout).toBeHidden();
    await expect(page.locator('#mobile-menu-backdrop')).toBeHidden();
    await expectNoDuplicates(page);
  });

  test('What\'s new opens the changelog and closes the menu', async ({ page }) => {
    await openPhone(page);
    await openMenu(page);
    await page.locator('#mobile-menu-whatsnew').click();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    await expectMenuClosed(page);
  });

  test('sync dot and menu alert follow sign-in and sync status', async ({ page }) => {
    await openPhone(page);
    const dot = page.locator('#mobile-sync-dot');
    await expect(dot).toHaveAttribute('data-state', 'off');
    await expect(page.locator('#mobile-menu-alert')).toBeVisible();

    await page.evaluate(() => (window as any).updateAccountChrome('signed-in', 'keith@example.com'));
    await expect(dot).toHaveAttribute('data-state', 'synced');
    await expect(page.locator('#mobile-menu-alert')).toBeHidden();

    await page.evaluate(() => (window as any).sbSetStatus('syncing'));
    await expect(dot).toHaveAttribute('data-state', 'syncing');
    await page.evaluate(() => (window as any).sbSetStatus('error'));
    await expect(dot).toHaveAttribute('data-state', 'error');

    await openMenu(page);
    await expect(sheet(page).locator('#sb-signout-btn')).toBeVisible();
    await expect(sheet(page).locator('#account-email')).toHaveText('keith@example.com');
  });

  test('768px gets the phone menu; 769px keeps the desktop sidebar', async ({ page }) => {
    await openPhone(page, 768);
    await expect(menuBtn(page)).toBeVisible();
    await expect(page.locator('.sidebar-backup')).toBeHidden();

    await page.setViewportSize({ width: 769, height: 844 });
    await expect(menuBtn(page)).toBeHidden();
    await expect(page.locator('#account-menu-btn')).toBeVisible();
    await openAccountMenu(page);
    await expect(page.locator('#account-menu .sidebar-backup')).toBeVisible();
    await expect(page.locator('#sidebar-account')).toBeVisible();
    await expect(page.locator('#density-toggle')).toBeVisible();
  });

  test('widening the window with the menu or Options open restores the desktop layout', async ({ page }) => {
    await openPhone(page);
    await openMenu(page);
    await page.setViewportSize({ width: 1024, height: 844 });
    await expectMenuClosed(page);
    await expect(page.locator('#account-menu .sidebar-backup #export-btn')).toHaveCount(1);
    await expect(page.locator('#account-menu-btn')).toBeVisible();
    await expect(page.locator('#account-menu')).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await openMenu(page);
    await page.locator('#mobile-menu-options').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(page.locator('#density-popout')).toBeHidden();
    await expect(page.locator('#mobile-menu-backdrop')).toBeHidden();
    expect(await page.locator('#density-popout').evaluate((el) => el.parentElement!.classList.contains('density-wrap'))).toBe(true);
    await page.locator('#density-toggle').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await expect(page.locator('#mobile-menu-backdrop')).toBeHidden();
    await expectNoDuplicates(page);
  });

  test('a sidebar collapsed on desktop stays usable on a phone and collapsed again on desktop', async ({ page }) => {
    await openPhone(page, 390, { 'work-desk-sidebar-collapsed': '1' });
    await expect(page.locator('#tab-desk')).toBeVisible();
    const width = await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(300);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBe(0);
    await expect(page.locator('#sidebar-toggle')).toBeVisible();
  });

  for (const width of [1440, 1024]) {
    test(`desktop at ${width}px has no phone menu and the sidebar works as before`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedLayout(page);
      for (const sel of ['#mobile-menu-btn', '#mobile-sync-dot', '#mobile-menu-sheet', '#mobile-menu-backdrop']) {
        await expect(page.locator(sel)).toBeHidden();
      }
      await expect(page.locator('#sidebar-today-glance')).toBeVisible();
      await openAccountMenu(page);
      await expect(page.locator('#version-btn')).toBeVisible();
      await page.locator('#export-btn').click();
      await expect(page.locator('.sidebar #export-menu')).toBeVisible();
      await page.locator('#density-toggle').click();
      await expect(page.locator('#density-popout')).toBeVisible();
      await expect(page.locator('#mobile-menu-backdrop')).toBeHidden();
      expect(await page.evaluate(() => document.body.classList.contains('mobile-menu-open'))).toBe(false);
      await page.keyboard.press('Escape');
      await page.locator('#sidebar-toggle').click();
      await expect.poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBe(0);
    });
  }
});

test.describe('UI audit fixes (1.12.1)', { tag: ['@board'] }, () => {
  // Wed Sep 30, 2026. One task carried from Tuesday (this week), none last week.
  async function seedAudit(page: Page) {
    await page.clock.setFixedTime(new Date('2026-09-30T10:00:00'));
    await page.addInitScript(() => {
      if (localStorage.getItem('audit-seeded')) return;
      localStorage.setItem('audit-seeded', '1');
      const t = (id: string, content: string, extra = {}) => ({
        id, type: 'task', content, completed: false, shelved: false, boardColumn: 'new',
        comments: [], tags: ['ace'], createdAt: '2026-09-28T09:00:00Z', ...extra,
      });
      const days = {
        '2026-09-28': { date: '2026-09-28', items: [t('done1', 'Renew vendor contract', { completed: true })] },
        '2026-09-30': { date: '2026-09-30', items: [
          t('open1', 'Review PR for IDS batching'),
          t('open2', 'Call vendor about the renewal', { boardColumn: 'active' }),
          t('carry1', 'Carried from Tuesday', { completed: true, carriedFrom: '2026-09-29' }),
        ] },
      };
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    });
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await expect(page.locator('#add-form')).toBeVisible();
  }

  const columnWidths = (page: Page) =>
    page.locator('.sprint-board > .board-column').evaluateAll(cols => cols.map(c => Math.round(c.getBoundingClientRect().width)));

  test('opening the tag box does not change desktop column widths', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedAudit(page);
    const before = await columnWidths(page);
    const card = page.locator('.item-card', { hasText: 'Call vendor about the renewal' });
    await card.getByRole('button', { name: 'tag', exact: true }).click();
    await expect(card.locator('.tag-input-inline')).toBeVisible();
    expect(await columnWidths(page)).toEqual(before);
  });

  test('opening the tag box on a phone keeps cards inside the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAudit(page);
    const card = page.locator('.item-card', { hasText: 'Call vendor about the renewal' });
    await card.getByRole('button', { name: 'tag', exact: true }).click();
    await expect(card.locator('.tag-input-inline')).toBeVisible();
    const overflow = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll('.item-card, .item-card .tag-chip')]
        .filter(el => el.getBoundingClientRect().right > vw + 1).length;
    });
    expect(overflow).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('week-over-week shows a carry-over increase in red and completions in green', async ({ page }) => {
    await seedAudit(page);
    await page.locator('#tab-insights').click();
    await page.locator('.period-tab', { hasText: 'Week' }).click();
    const carried = page.locator('.comparison-row', { hasText: 'Carried Over' });
    await expect(carried.locator('.change-bad')).toHaveText('+1 ↑');
    await expect(carried.locator('.change-good')).toHaveCount(0);
    const red = await carried.locator('.change-bad').evaluate(el => getComputedStyle(el).color);
    expect(red).toBe('rgb(239, 68, 68)');
  });

  test('stat tiles: 8 tiles in complete rows at desktop, tablet, and phone widths', async ({ page }) => {
    await seedAudit(page);
    await page.locator('#tab-insights').click();
    for (const [width, perRow] of [[1440, 8], [1024, 4], [390, 2]] as const) {
      await page.setViewportSize({ width, height: 900 });
      const tops = await page.locator('.stat-grid .stat-card').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
      expect(tops).toHaveLength(8);
      const rows = new Map<number, number>();
      for (const t of tops) rows.set(t, (rows.get(t) || 0) + 1);
      expect([...rows.values()].every(n => n === perRow), `width ${width}: ${[...rows.values()]}`).toBe(true);
    }
    await expect(page.locator('.stat-grid .stat-card-label', { hasText: 'Completion rate' })).toHaveCount(0);
  });

  test('year carry-over stops at the current month; streak bar has labels', async ({ page }) => {
    await seedAudit(page);
    await page.locator('#tab-insights').click();
    await page.locator('.period-tab', { hasText: 'Year' }).click();
    const months = page.locator('.carryover-trend[data-carry-trend="month"] .carryover-day-label');
    await expect(months).toHaveText(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);
    await expect(page.locator('.streak-heatmap-labels span', { hasText: 'Sep' })).toHaveCount(1);
    await expect(page.locator('.streak-hint')).toHaveText('Each block is a day — darker means more tasks');

    await page.locator('.period-tab', { hasText: 'Week' }).click();
    await expect(page.locator('.streak-heatmap-labels span')).toHaveText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    await page.locator('.period-tab', { hasText: 'Month' }).click();
    await expect(page.locator('.streak-heatmap-labels span').filter({ hasText: /\d/ })).toHaveText(['1', '8', '15', '22', '29']);
  });

  test('search results mark finished tasks as done', async ({ page }) => {
    await seedAudit(page);
    await page.locator('#search-input').click();
    await page.locator('#search-input').fill('vendor');
    const done = page.locator('.search-result', { hasText: 'Renew vendor contract' });
    await expect(done.locator('.search-result-status')).toHaveText('✓ Done');
    await expect(done).toHaveClass(/is-done/);
    const open = page.locator('.search-result', { hasText: 'Call vendor about the renewal' });
    await expect(open.locator('.search-result-status')).toHaveCount(0);
    await done.click();
    await expect(page.locator('#search-overlay')).toBeHidden();
  });

  test('no theme name is cut off in any filter', async ({ page }) => {
    await seedAudit(page);
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="themes"]').click();
    for (const filter of ['light', 'medium', 'dark']) {
      await page.locator(`[data-theme-filter="${filter}"]`).click();
      await expect(page.locator('#density-popout')).toBeVisible();
      const clipped = await page.locator('.theme-swatch-name').evaluateAll(els =>
        els.filter(e => (e as HTMLElement).offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
      expect(clipped, filter).toEqual([]);
    }
    await page.locator('[data-theme-filter="light"]').click();
    await expect(page.locator('.theme-swatch-name', { hasText: 'Mediterranean' })).toHaveClass(/long/);
  });

  test('progress bar: Done is the accent and all three segments differ', async ({ page }) => {
    await seedAudit(page);
    const colors = await page.evaluate(() => {
      const bg = (id: string) => getComputedStyle(document.getElementById(id)!).backgroundColor;
      const probe = document.createElement('div');
      probe.style.color = 'var(--accent)';
      document.body.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { accent, done: bg('progress-done'), active: bg('progress-active'), fresh: bg('progress-new') };
    });
    expect(colors.done).toBe(colors.accent);
    expect(new Set([colors.done, colors.active, colors.fresh]).size).toBe(3);
  });

  test('recurring button shows a theme-colored icon and opens the recurring dialog', async ({ page }) => {
    await seedAudit(page);
    const btn = page.locator('#recurring-btn');
    const [iconColor, textColor] = await btn.evaluate(b => [getComputedStyle(b.querySelector('svg')!).stroke, getComputedStyle(b).color]);
    expect(iconColor).toBe(textColor);
    await btn.click();
    await expect(page.locator('#recurring-modal')).toBeVisible();
    await expect(page.locator('#recurring-modal .modal-title svg.icon-repeat')).toBeVisible();
  });

  test('calendar badges for unfinished past days are amber', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-30T10:00:00'));
    await page.addInitScript(() => {
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: {
        '2026-09-22': { date: '2026-09-22', items: [{ id: 'old', type: 'task', content: 'Left open', completed: false, shelved: false, boardColumn: 'new', comments: [] }] },
      }, deletedIds: {} }));
    });
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    const badge = page.locator('.cal-day-badge').first();
    await expect(badge).toBeVisible();
    expect(await badge.evaluate(el => getComputedStyle(el).color)).toBe('rgb(251, 191, 36)');
  });

  test('touch screens: bigger controls and a tap halo around small icons', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAudit(page);
    const card = page.locator('.item-card', { hasText: 'Review PR for IDS batching' });
    await card.scrollIntoViewIfNeeded();
    expect((await card.locator('.complete-edge').boundingBox())!.width).toBeGreaterThanOrEqual(40);
    expect((await card.locator('.card-action').first().boundingBox())!.height).toBeGreaterThanOrEqual(32);
    const remove = card.locator('.tag-chip-remove').first();
    const box = (await remove.boundingBox())!;
    // Tap 7px to the left of the tiny ×; the halo should still remove the tag
    await page.mouse.click(box.x - 7, box.y + box.height / 2);
    await expect(card.locator('.tag-chip')).toHaveCount(0);
  });
});

test.describe('Delete and undo sync records', { tag: ['@sync'] }, () => {
  const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-data-work') || '{}'));

  test('delete saves a purge record; undo swaps it for a restore record', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await openDesk(page);
    await addTask(page, 'Purge me');
    const card = page.locator('.item-card', { hasText: 'Purge me' });
    const id = await page.evaluate(() => {
      const days = JSON.parse(localStorage.getItem('work-desk-data-work') || '{}').days || {};
      return Object.values<any>(days).flatMap(d => d.items).find(i => i.content.includes('Purge me'))?.id as string;
    });
    expect(id).toBeTruthy();

    await card.locator('.card-overflow-btn').click();
    await card.locator('.card-overflow-menu button', { hasText: 'Delete' }).click();
    await expect(page.locator('.item-card', { hasText: 'Purge me' })).toHaveCount(0);
    let data = await stored(page);
    expect(data.purgedIds?.[id!]).toBeTruthy();
    expect(data.deletedIds?.[id!]).toBe(data.purgedIds[id!]);

    await page.locator('.toast-undo-btn').click();
    await expect(page.locator('.item-card', { hasText: 'Purge me' })).toHaveCount(1);
    data = await stored(page);
    expect(data.purgedIds?.[id!]).toBeUndefined();
    expect(data.deletedIds?.[id!]).toBeUndefined();
    expect(data.restoredIds?.[id!]).toBeTruthy();

    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('.item-card', { hasText: 'Purge me' })).toHaveCount(1);
    expect((await stored(page)).restoredIds?.[id!]).toBeTruthy();
  });
});

async function addTask(page: Page, text: string) {
  const editor = page.locator('#add-editor-host .rich-editor');
  await editor.click();
  await editor.pressSequentially(text, { delay: 15 });
  await expect(page.locator('#add-btn')).toBeEnabled();
  await page.locator('#add-btn').click();
  // #hashtags get extracted into tag chips and stripped from the visible card
  // text — a lone hashtag (no other content) is the one exception, kept as-is.
  const visibleText = text.replace(/#[a-zA-Z0-9_-]+/g, '').replace(/\s+/g, ' ').trim() || text;
  await expect(page.locator('.item-card', { hasText: visibleText }).first()).toBeVisible();
}

test.describe('Work Desk smoke', { tag: ['@board', '@smoke'] }, () => {
  test('adds a task to New column', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'E2E smoke task');

    const card = page.locator('.board-column.new .item-card', { hasText: 'E2E smoke task' });
    await expect(card).toBeVisible();
  });

  test('add-form placeholder reflects the day being viewed, not always "today"', async ({ page }) => {
    await openDesk(page);
    const editor = page.locator('#add-editor-host .rich-editor');

    await expect(editor).toHaveAttribute('data-placeholder', 'Add a task for today…');

    await page.locator('#next-day').click();
    await expect(editor).toHaveAttribute('data-placeholder', 'Add a task for tomorrow…');

    await page.locator('#next-day').click();
    // Two days out is no longer "tomorrow" — falls back to a short date, not "today".
    await expect(editor).not.toHaveAttribute('data-placeholder', 'Add a task for today…');
    await expect(editor).not.toHaveAttribute('data-placeholder', 'Add a task for tomorrow…');

    await page.locator('#header-today-btn').click();
    await expect(editor).toHaveAttribute('data-placeholder', 'Add a task for today…');

    await page.locator('#prev-day').click();
    await expect(editor).toHaveAttribute('data-placeholder', 'Add a task for yesterday…');
  });

  test('complete then uncomplete keeps task recoverable', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Complete me');

    const card = page.locator('.item-card', { hasText: 'Complete me' }).first();
    await card.locator('.complete-edge').click();
    await expect(page.locator('.board-column.done .item.completed', { hasText: 'Complete me' })).toBeVisible();

    await page.locator('.board-column.done .item-card', { hasText: 'Complete me' }).locator('.complete-edge').click();
    await expect(page.locator('.item.completed', { hasText: 'Complete me' })).toHaveCount(0);
    await expect(page.locator('.board-column.new .item-card', { hasText: 'Complete me' })).toBeVisible();
  });

  test('task survives reload via localStorage', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Persist across refresh');

    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('.item-card', { hasText: 'Persist across refresh' })).toBeVisible();
  });

  test('export backup includes deletedIds field', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Export probe');

    // Export lives in the account menu and opens a dropdown; click the single-desk export option
    await openAccountMenu(page);
    await page.locator('#export-btn').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export-desk-opt').click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs');
    const raw = fs.readFileSync(path!, 'utf8');
    const json = JSON.parse(raw);
    expect(json).toHaveProperty('days');
    expect(json).toHaveProperty('deletedIds');
  });

  test('move task to another day strips dual-day copies', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Move me elsewhere');

    const card = page.locator('.item-card', { hasText: 'Move me elsewhere' }).first();
    await card.locator('button.card-action', { hasText: /^move$/i }).click();
    await expect(page.locator('#move-modal:not(.hidden)')).toBeVisible();

    // The move modal uses a custom calendar (not a native date input) so it can
    // honor the week-start-day setting; pick tomorrow by clicking its day cell.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayNum = String(tomorrow.getDate());
    await page.locator('#move-calendar .cal-day:not(.other-month)', { hasText: new RegExp(`^${dayNum}$`) }).click();
    await page.locator('#move-confirm').click();

    await expect(page.locator('.item-card', { hasText: 'Move me elsewhere' })).toHaveCount(0);

    const stored = await page.evaluate((key) => localStorage.getItem(key), WORK_KEY);
    const data = JSON.parse(stored || '{"days":{}}');
    const idCounts = new Map<string, number>();
    for (const day of Object.values(data.days || {}) as { items?: { id: string }[] }[]) {
      for (const item of day.items || []) {
        idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);
      }
    }
    for (const count of idCounts.values()) {
      expect(count).toBe(1);
    }
  });

  test('the move-to-date calendar honors the Monday week-start setting', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('work-desk-week-start', 'monday');
    });
    await openDesk(page);
    await addTask(page, 'Move me with Monday-first calendar');

    const card = page.locator('.item-card', { hasText: 'Move me with Monday-first calendar' }).first();
    await card.locator('button.card-action', { hasText: /^move$/i }).click();
    await expect(page.locator('#move-modal:not(.hidden)')).toBeVisible();

    const weekdayLabels = await page.locator('#move-calendar .cal-weekday').allTextContents();
    expect(weekdayLabels).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
  });
});

test.describe('Tags', { tag: ['@tags'] }, () => {
  test('typing #hashtag in the add form extracts a tag chip and strips it from content', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Follow up with vendor #ace');

    const card = page.locator('.item-card', { hasText: 'Follow up with vendor' }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.item-content')).not.toContainText('#ace');
    await expect(card.locator('.tag-chip')).toContainText('ace');
  });

  test('#ACE and #ace collapse into the same tag (case-insensitive)', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Task one #ACE');
    await addTask(page, 'Task two #ace');

    const card1 = page.locator('.item-card', { hasText: 'Task one' }).first();
    const card2 = page.locator('.item-card', { hasText: 'Task two' }).first();
    await expect(card1.locator('.tag-chip')).toContainText('ace');
    await expect(card2.locator('.tag-chip')).toContainText('ace');
  });

  test('a lone hashtag with no other content is left as visible text, not silently dropped', async ({ page }) => {
    await openDesk(page);
    await addTask(page, '#ace');

    const card = page.locator('.item-card', { hasText: '#ace' }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.tag-chip')).toHaveCount(0);
  });

  test('the action-bar "tag" button adds a tag without touching task text', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Plain task, no hashtag');

    const card = page.locator('.item-card', { hasText: 'Plain task, no hashtag' }).first();
    await card.locator('button.card-action', { hasText: /^tag$/i }).click();
    await card.locator('.tag-input-inline').fill('vendor');
    await card.locator('.tag-input-inline').press('Enter');

    await expect(card.locator('.tag-chip')).toContainText('vendor');
    await expect(card.locator('.item-content')).toHaveText('Plain task, no hashtag');
  });

  async function seedTagUsage(page: Page) {
    await openDesk(page);
    await addTask(page, 'First #ace');
    await addTask(page, 'Second #ace');
    await addTask(page, 'Third #ace');
    await addTask(page, 'Fourth #workdesk');
    await addTask(page, 'Fifth #workdesk');
    await addTask(page, 'Sixth #admin');
    await addTask(page, 'Target task');
    const card = page.locator('.item-card', { hasText: 'Target task' }).first();
    await card.locator('button.card-action', { hasText: /^tag$/i }).click();
    await expect(card.locator('.tag-input-inline')).toBeFocused();
    return card;
  }

  test('tag input offers the two most-used tags as one-click picks', async ({ page }) => {
    const card = await seedTagUsage(page);
    const picks = card.locator('.tag-suggestion');
    await expect(picks).toHaveText(['ace', 'workdesk']);
    await picks.filter({ hasText: 'workdesk' }).click();
    await expect(card.locator('.tag-input-inline')).toHaveCount(0);
    await expect(card.locator('.tag-chip-row .tag-chip-label')).toHaveText(['workdesk']);
    await expect(card.locator('.item-content')).toHaveText('Target task');

    // Reopen: the tag already on the card is skipped and the next most-used fills in
    await card.locator('button.card-action', { hasText: /^tag$/i }).click();
    await expect(card.locator('.tag-suggestion')).toHaveText(['ace', 'admin']);
    await card.locator('.tag-suggestion', { hasText: 'ace' }).click();
    await expect(card.locator('.tag-chip-row .tag-chip-label')).toHaveText(['workdesk', 'ace']);

    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('.item-card', { hasText: 'Target task' }).first().locator('.tag-chip-row .tag-chip-label')).toHaveText(['workdesk', 'ace']);
  });

  test('tag picks narrow as you type, and typing a new tag still works', async ({ page }) => {
    const card = await seedTagUsage(page);
    const input = card.locator('.tag-input-inline');
    await input.pressSequentially('a');
    await expect(card.locator('.tag-suggestion')).toHaveText(['ace', 'admin']);
    await input.pressSequentially('d');
    await expect(card.locator('.tag-suggestion')).toHaveText(['admin']);
    await input.pressSequentially('z');
    await expect(card.locator('.tag-suggestion')).toHaveCount(0);
    await expect(input).toBeFocused();

    await input.fill('brandnew');
    await input.press('Enter');
    await expect(card.locator('.tag-chip-row .tag-chip-label')).toHaveText(['brandnew']);
  });

  test('tag picks are hidden when there are no used tags, and Escape closes the input', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Lonely task');
    const card = page.locator('.item-card', { hasText: 'Lonely task' }).first();
    await card.locator('button.card-action', { hasText: /^tag$/i }).click();
    await expect(card.locator('.tag-input-inline')).toBeVisible();
    await expect(card.locator('.tag-suggestion')).toHaveCount(0);
    await expect(card.locator('.tag-suggestions')).toBeHidden();
    await card.locator('.tag-input-inline').press('Escape');
    await expect(card.locator('.tag-input-inline')).toHaveCount(0);
  });

  async function expectTagBoxStaysOpen(page, card) {
    await card.locator('button.card-action', { hasText: /^tag$/i }).click();
    const input = card.locator('.tag-input-inline');
    await page.waitForTimeout(600);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(card.locator('.tag-suggestion').first()).toBeVisible();
    await page.keyboard.type('kept');
    await expect(input).toHaveValue('kept');
  }

  test('tag box stays open and focused while another card has an unsent comment draft', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Draft holder #ace');
    await addTask(page, 'Tag target');
    const holder = page.locator('.item-card', { hasText: 'Draft holder' }).first();
    await holder.locator('.card-action').filter({ hasText: /comment/ }).first().click();
    const trigger = holder.locator('.add-comment-trigger');
    if (await trigger.count()) await trigger.click();
    await holder.locator('.add-comment-form .comment-input').click();
    await page.keyboard.type('unsent draft');

    await expectTagBoxStaysOpen(page, page.locator('.item-card', { hasText: 'Tag target' }).first());
    await expect(holder.locator('.add-comment-form .comment-input')).toHaveText('unsent draft');
  });

  test('tag box stays open and focused while a column add box is open', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Seed #ace');
    await addTask(page, 'Tag target');
    await page.locator('.board-column button').filter({ hasText: /add/i }).first().click();
    await expect(page.locator('.col-inline-input')).toBeVisible();

    await expectTagBoxStaysOpen(page, page.locator('.item-card', { hasText: 'Tag target' }).first());
  });

  test('tag box closes on an outside click and moves when tagging another card', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Card one #ace');
    await addTask(page, 'Card two');
    const one = page.locator('.item-card', { hasText: 'Card one' }).first();
    const two = page.locator('.item-card', { hasText: 'Card two' }).first();

    await two.locator('button.card-action', { hasText: /^tag$/i }).click();
    await two.locator('.tag-input-inline').click();
    await expect(two.locator('.tag-input-inline')).toBeVisible();

    await one.locator('button.card-action', { hasText: /^tag$/i }).click();
    await expect(page.locator('.tag-input-inline')).toHaveCount(1);
    await expect(one.locator('.tag-input-inline')).toBeFocused();

    await page.locator('#date-title').click();
    await expect(page.locator('.tag-input-inline')).toHaveCount(0);
    await expect(two.locator('button.card-action', { hasText: /^tag$/i })).toBeVisible();
  });

  test('tag picks work on notes too', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Tagged #ace');
    await page.locator('.type-btn[data-type="note"]').click();
    await addTask(page, 'Meeting note');
    const card = page.locator('.item-card', { hasText: 'Meeting note' }).first();
    await card.locator('button.card-action', { hasText: /^tag$/i }).click();
    await card.locator('.tag-suggestion', { hasText: 'ace' }).click();
    await expect(card.locator('.tag-chip-row .tag-chip-label')).toHaveText(['ace']);
  });

  test('removing a tag chip clears it from the card', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Task with tag #vendor');

    const card = page.locator('.item-card', { hasText: 'Task with tag' }).first();
    await expect(card.locator('.tag-chip')).toHaveCount(1);
    await card.locator('.tag-chip-remove').click();
    await expect(card.locator('.tag-chip')).toHaveCount(0);
  });
});

// ── Font family persistence ────────────────────────────────────────────
test.describe('Font family persistence', { tag: ['@options'] }, () => {
  const bodyFont = (page: Page) => page.evaluate(() => getComputedStyle(document.body).fontFamily);

  async function pickThemeAndFont(page: Page) {
    await openDesk(page);
    await page.locator('#density-toggle').click();
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="monokai"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai');
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await openOptionsSectionFor(page, '#font-family-select');
    await page.locator('#font-family-select').selectOption('jetbrains');
    await expect.poll(() => bodyFont(page)).toContain('JetBrains Mono');
  }

  test('chosen font survives a reload when a theme is saved', async ({ page }) => {
    await pickThemeAndFont(page);
    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai');
    // applyTheme clears inline vars two animation frames after load; give it time
    await page.waitForTimeout(700);
    expect(await bodyFont(page)).toContain('JetBrains Mono');
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(page.locator('#font-family-select')).toHaveValue('jetbrains');
  });

  test('switching themes keeps the chosen font', async ({ page }) => {
    await pickThemeAndFont(page);
    await page.locator('.options-nav-btn[data-options-tab="themes"]').click();
    await page.locator('.theme-filter-btn[data-theme-filter="light"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="retro"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
    await page.waitForTimeout(700);
    expect(await bodyFont(page)).toContain('JetBrains Mono');
  });

  test('a light preset after a theme switch has no leftover inline color-scheme', async ({ page }) => {
    await pickThemeAndFont(page);
    await page.evaluate(() => document.documentElement.style.setProperty('color-scheme', 'dark'));
    await page.locator('.options-nav-btn[data-options-tab="themes"]').click();
    await page.locator('.theme-filter-btn[data-theme-filter="light"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="retro"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('color-scheme'))).toBe('');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  });
});

// ── Tag colors ─────────────────────────────────────────────────────────
test.describe('Tag colors', { tag: ['@tags', '@options'] }, () => {
  const slot = (tag: string) => {
    let h = 0;
    for (const ch of tag) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
    return h % 8;
  };
  // Two tags guaranteed to land on different palette slots
  const TAG_A = 'ace';
  const TAG_B = ['urgent', 'ids', 'oms', 'bug', 'ops', 'kt', 'p1'].find((t) => slot(t) !== slot(TAG_A))!;

  const chipOn = (page: Page, text: string) => page.locator('.item-card', { hasText: text }).first().locator('.tag-chip');
  const colorOf = (loc: ReturnType<Page['locator']>) => loc.evaluate((el) => getComputedStyle(el).color);
  const accentColor = (page: Page) => page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });

  async function setupTwoTaggedTasks(page: Page) {
    await openDesk(page);
    await addTask(page, `Alpha task #${TAG_A}`);
    await addTask(page, `Bravo task #${TAG_B}`);
    await expect(chipOn(page, 'Alpha task')).toHaveCount(1);
    await expect(chipOn(page, 'Bravo task')).toHaveCount(1);
  }

  async function openAppearance(page: Page) {
    await page.locator('#density-toggle').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await openOptionsSectionFor(page, '#tag-color-mode-select');
    await expect(page.locator('#tag-color-mode-select')).toBeVisible();
  }

  test('defaults to Theme color: every chip uses the accent', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await expect(page.locator('html')).toHaveAttribute('data-tag-colors', 'theme');
    const accent = await accentColor(page);
    await expect.poll(() => colorOf(chipOn(page, 'Alpha task'))).toBe(accent);
    await expect.poll(() => colorOf(chipOn(page, 'Bravo task'))).toBe(accent);
    await openAppearance(page);
    await expect(page.locator('#tag-color-mode-select')).toHaveValue('theme');
  });

  test('Palette gives tags different on-theme colors, persists, and switches back', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await openAppearance(page);
    await page.locator('#tag-color-mode-select').selectOption('palette');
    await expect(page.locator('html')).toHaveAttribute('data-tag-colors', 'palette');
    await expect(page.locator('#density-popout')).toBeVisible();

    const accent = await accentColor(page);
    const a = await colorOf(chipOn(page, 'Alpha task'));
    const b = await colorOf(chipOn(page, 'Bravo task'));
    expect(a).not.toBe(b);
    expect([a, b].some((c) => c !== accent)).toBe(true);

    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('html')).toHaveAttribute('data-tag-colors', 'palette');
    expect(await page.evaluate(() => localStorage.getItem('work-desk-tag-color-mode'))).toBe('palette');

    await openAppearance(page);
    await page.locator('#tag-color-mode-select').selectOption('theme');
    await expect.poll(() => colorOf(chipOn(page, 'Alpha task'))).toBe(accent);
    await expect.poll(() => colorOf(chipOn(page, 'Bravo task'))).toBe(accent);
  });

  test('clicking a card chip opens the color popover; picking a swatch pins the color and persists', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    const chip = chipOn(page, 'Alpha task');
    const before = await colorOf(chip);
    await chip.click();
    const pop = page.locator('#tag-color-popover');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.tag-color-swatch')).toHaveCount(12);
    await expect(pop.locator('.tag-color-reset')).toBeDisabled();

    // Clicking inside the popover (non-control) keeps it open
    await pop.locator('.tag-color-popover-title').click();
    await expect(pop).toBeVisible();

    await pop.locator('.tag-color-swatch[data-color="#ef4444"]').click();
    await expect(pop).toHaveCount(0);
    await expect(chip).toHaveClass(/tag-custom/);
    await expect.poll(() => colorOf(chip)).not.toBe(before);
    await expect(chipOn(page, 'Bravo task')).not.toHaveClass(/tag-custom/);

    await page.reload();
    await dismissAuthModal(page);
    await expect(chipOn(page, 'Alpha task')).toHaveClass(/tag-custom/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-tag-colors') || '{}'))).toEqual({ [TAG_A]: '#ef4444' });

    // Reopen: the chosen swatch is marked, and Reset to auto clears it
    await chipOn(page, 'Alpha task').click();
    await expect(page.locator('#tag-color-popover .tag-color-swatch[data-color="#ef4444"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#tag-color-popover .tag-color-reset').click();
    await expect(page.locator('#tag-color-popover')).toHaveCount(0);
    await expect(chipOn(page, 'Alpha task')).not.toHaveClass(/tag-custom/);
    expect(await page.evaluate(() => localStorage.getItem('work-desk-tag-colors'))).toBe('{}');
  });

  test('custom picker in the popover applies live and keeps the popover open', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await chipOn(page, 'Bravo task').click();
    const pop = page.locator('#tag-color-popover');
    await pop.locator('.tag-color-custom-input').fill('#123abc');
    await expect(pop).toBeVisible();
    await expect(chipOn(page, 'Bravo task')).toHaveClass(/tag-custom/);
    expect(await chipOn(page, 'Bravo task').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--tag-custom'))).toBe('#123abc');
    await expect(pop.locator('.tag-color-popover-title .tag-chip')).toHaveClass(/tag-custom/);
  });

  test('popover closes on outside click, Escape, and re-clicking the same chip', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    const chip = chipOn(page, 'Alpha task');
    const pop = page.locator('#tag-color-popover');

    await chip.click();
    await expect(pop).toBeVisible();
    await page.locator('#desk-view').click({ position: { x: 5, y: 5 } });
    await expect(pop).toHaveCount(0);

    await chip.click();
    await expect(pop).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);

    await chip.click();
    await expect(pop).toBeVisible();
    await chip.click();
    await expect(pop).toHaveCount(0);

    // Each chip opens the popover for its own tag
    await chipOn(page, 'Bravo task').click();
    await expect(pop).toBeVisible();
    await expect(pop.locator('.tag-color-popover-title .tag-chip')).toHaveText(TAG_B);
  });

  // Resolve any CSS color in the page to [r, g, b] and hue (0–360)
  const rgbOf = (page: Page, color: string) => page.evaluate((c) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  }, color);
  const hueOf = ([r, g, b]: number[]) => {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
    if (d === 0) return 0;
    const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const toHex = ([r, g, b]: number[]) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');

  // Blank space between the chip's letters (text-colored pixels) and the pill's edges, in CSS pixels.
  // Corners are squared off for the capture so the pill's rounded ends aren't mistaken for text, and
  // gaps are measured against the pill itself because element screenshots round out to whole pixels.
  async function inkGaps(page: Page, chip: ReturnType<Page['locator']>) {
    await chip.evaluate((el: HTMLElement) => { el.style.borderRadius = '0'; el.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(300);
    const png = (await chip.screenshot({ animations: 'disabled' })).toString('base64');
    await chip.evaluate((el: HTMLElement) => { el.style.borderRadius = ''; });
    const box = (await chip.boundingBox())!;
    const labelBox = (await chip.locator('.tag-chip-label').boundingBox())!;
    const fg = await rgbOf(page, await colorOf(chip));
    return page.evaluate(async ({ png, fg, labelEnd }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      const px = (x: number, y: number) => [0, 1, 2].map((i) => data[(y * img.width + x) * 4 + i]);
      const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const scale = devicePixelRatio;
      const probeX = Math.round(4 * scale);
      const pill = px(probeX, Math.floor(img.height / 2));
      const isPill = (x: number, y: number) => dist(px(x, y), pill) < 16;
      let pillTop = 0, pillBottom = img.height - 1;
      while (pillTop < img.height && !isPill(probeX, pillTop)) pillTop++;
      while (pillBottom > 0 && !isPill(probeX, pillBottom)) pillBottom--;
      const probeY = pillTop + Math.round(scale);
      let pillLeft = 0, pillRight = img.width - 1;
      while (pillLeft < img.width && !isPill(pillLeft, probeY)) pillLeft++;
      while (pillRight > 0 && !isPill(pillRight, probeY)) pillRight--;
      const limit = Math.min(pillRight, Math.round(labelEnd * scale));
      const rowInk = new Array(img.height).fill(0);
      const colInk = new Array(img.width).fill(0);
      for (let y = pillTop; y <= pillBottom; y++) {
        for (let x = pillLeft; x <= limit; x++) {
          const p = px(x, y);
          if (dist(p, pill) > dist(pill, fg) * 0.3 && dist(p, fg) < dist(pill, fg)) { rowInk[y]++; colInk[x]++; }
        }
      }
      // Skip faint anti-aliased fringe rows/columns
      const span = (counts: number[]) => {
        const min = Math.max(...counts) * 0.15;
        return [counts.findIndex((n) => n > min), counts.length - 1 - [...counts].reverse().findIndex((n) => n > min)];
      };
      const [top, bottom] = span(rowInk);
      const [left, right] = span(colInk);
      const r = (n: number) => Math.round((n / scale) * 10) / 10;
      return { top: r(top - pillTop), bottom: r(pillBottom - bottom), left: r(left - pillLeft), right: r(pillRight - right) };
    }, { png, fg, labelEnd: labelBox.x + labelBox.width - Math.floor(box.x) + 1 });
  }

  test.describe('pill text centering', () => {
    test.use({ deviceScaleFactor: 4 });

    test('tag text is centered in the pill for every font', async ({ page }) => {
      await setupTwoTaggedTasks(page);
      for (const font of ['system', 'inter', 'nunito', 'jetbrains', 'merriweather']) {
        await openAppearance(page);
        await openOptionsSectionFor(page, '#font-family-select');
        await page.locator('#font-family-select').selectOption(font);
        await openOptionsSectionFor(page, '#tag-color-list');
        await page.evaluate(() => document.fonts.ready);
        const g = await inkGaps(page, page.locator(`#tag-color-list .tag-color-row[data-tag-row="${TAG_A}"] .tag-chip`));
        expect.soft(Math.abs(g.top - g.bottom), `${font}: vertical ${JSON.stringify(g)}`).toBeLessThanOrEqual(1.5);
        expect.soft(Math.abs(g.left - g.right), `${font}: horizontal ${JSON.stringify(g)}`).toBeLessThanOrEqual(1.5);
        await page.locator('#density-toggle').click();
        await expect(page.locator('#density-popout')).toBeHidden();
        const card = await inkGaps(page, chipOn(page, 'Alpha task'));        expect.soft(Math.abs(card.top - card.bottom), `${font}: card chip ${JSON.stringify(card)}`).toBeLessThanOrEqual(1.5);
      }
    });
  });

  test('Shades of accent gives tags clearly different colors, most-used tag first, and survives reload', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await addTask(page, `Charlie task #${TAG_A}`);
    await openAppearance(page);
    await page.locator('#tag-color-mode-select').selectOption('analogous');
    await expect(page.locator('html')).toHaveAttribute('data-tag-colors', 'analogous');
    await expect(page.locator('#density-popout')).toBeVisible();

    // TAG_A has two uses, so it gets slot 0 (the accent) and TAG_B the next, most distinct color
    await expect(chipOn(page, 'Alpha task')).toHaveAttribute('data-shade-slot', '0');
    await expect(chipOn(page, 'Bravo task')).toHaveAttribute('data-shade-slot', '1');
    const accent = toHex(await rgbOf(page, await accentColor(page)));
    await expect.poll(async () => toHex(await rgbOf(page, await colorOf(chipOn(page, 'Alpha task'))))).toBe(accent);
    const a = await rgbOf(page, await colorOf(chipOn(page, 'Alpha task')));
    const b = await rgbOf(page, await colorOf(chipOn(page, 'Bravo task')));
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(60);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-tag-shade-slots') || '{}')))
      .toEqual({ [TAG_A]: 0, [TAG_B]: 1 });

    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('html')).toHaveAttribute('data-tag-colors', 'analogous');
    await expect(chipOn(page, 'Bravo task')).toHaveAttribute('data-shade-slot', '1');
  });

  test('Shades of accent follows the theme: Monokai uses its own colors, other themes a wide two-tone spread', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await openAppearance(page);
    await page.locator('#tag-color-mode-select').selectOption('analogous');
    const shades = () => page.evaluate(() => Array.from({ length: 8 }, (_, i) =>
      getComputedStyle(document.documentElement).getPropertyValue(`--tag-shade-${i}`).trim()));

    await page.locator('.options-nav-btn[data-options-tab="themes"]').click();
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="monokai"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai');
    await expect.poll(async () => (await shades())[1]).toBe('#a6e22e');
    expect((await shades()).slice(0, 4)).toEqual(['#f92672', '#a6e22e', '#66d9ef', '#fd971f']);
    await expect.poll(async () => toHex(await rgbOf(page, await colorOf(chipOn(page, 'Bravo task'))))).toBe('#a6e22e');
    await expect(page.locator('#tag-shade-vars')).toHaveCount(1);

    await page.locator('#density-toggle').click();
    await page.locator('.theme-filter-btn[data-theme-filter="light"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="seafoam"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'seafoam');
    await expect.poll(async () => (await shades())[0]).toBe('#0d9488');
    const hues = (await Promise.all((await shades()).map((c) => rgbOf(page, c)))).map(hueOf);
    expect(Math.max(...hues.map((h) => hueGap(h, hues[0])))).toBeGreaterThan(60);
    expect(new Set(await shades()).size).toBe(8);
    await expect(page.locator('#tag-shade-vars')).toHaveCount(1);
  });

  test('Shades of accent works with a custom theme and updates when it is edited', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('work-desk-custom-themes', JSON.stringify([
        { id: 'custom-test1', name: 'Mine', dark: true, bg: '#101418', surface: '#1c2228', sidebar: '#0a0e12', accent: '#e0b040', text: '#e8ecf3' },
      ]));
      localStorage.setItem('work-desk-theme', 'custom-test1');
      localStorage.setItem('work-desk-tag-color-mode', 'analogous');
    });
    await setupTwoTaggedTasks(page);
    const shade0 = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tag-shade-0').trim());
    await expect.poll(shade0).toBe('#e0b040');
    await page.evaluate(() => document.documentElement.style.setProperty('--accent', '#40a0e0'));
    await expect.poll(shade0).toBe('#40a0e0');
  });

  test('a pinned color still beats Shades of accent on every slot', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await openAppearance(page);
    await page.locator('#tag-color-mode-select').selectOption('analogous');
    await page.keyboard.press('Escape');
    await page.locator('#desk-view').click({ position: { x: 5, y: 5 } });
    const chip = chipOn(page, 'Bravo task');
    await expect(chip).toHaveAttribute('data-shade-slot', /[1-7]/);
    await chip.click();
    await page.locator('#tag-color-popover .tag-color-swatch[data-color="#ef4444"]').click();
    await expect(chip).toHaveClass(/tag-custom/);
    const pinned = await rgbOf(page, await colorOf(chip));
    expect(pinned[0]).toBeGreaterThan(pinned[1] + 60);
  });

  test('Single color and Multi-color chips carry no shade slot', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await expect(chipOn(page, 'Alpha task')).not.toHaveAttribute('data-shade-slot');
    await openAppearance(page);
    await page.locator('#tag-color-mode-select').selectOption('analogous');
    await expect(chipOn(page, 'Alpha task')).toHaveAttribute('data-shade-slot', /\d/);
    await page.locator('#tag-color-mode-select').selectOption('palette');
    await expect(chipOn(page, 'Alpha task')).not.toHaveAttribute('data-shade-slot');
  });

  test('Options color boxes show each tag\'s displayed color in every mode', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await openAppearance(page);
    const rowA = page.locator(`#tag-color-list .tag-color-row[data-tag-row="${TAG_A}"]`);
    const rowB = page.locator(`#tag-color-list .tag-color-row[data-tag-row="${TAG_B}"]`);

    const accentHex = toHex(await rgbOf(page, await accentColor(page)));
    await expect(rowA.locator('.tag-color-input')).toHaveValue(accentHex);
    await expect(rowB.locator('.tag-color-input')).toHaveValue(accentHex);

    for (const mode of ['analogous', 'palette']) {
      await page.locator('#tag-color-mode-select').selectOption(mode);
      for (const tag of [TAG_A, TAG_B]) {
        const row = page.locator(`#tag-color-list .tag-color-row[data-tag-row="${tag}"]`);
        const shown = toHex(await rgbOf(page, await colorOf(row.locator('.tag-chip'))));
        await expect(row.locator('.tag-color-input')).toHaveValue(shown);
      }
    }
    await expect(page.locator('#tag-color-mode-select option')).toHaveText([
      'Single color (accent)', 'Shades of accent', 'Multi-color',
    ]);
  });

  test('custom color overrides Palette mode', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await openAppearance(page);
    await page.locator('#tag-color-mode-select').selectOption('palette');
    await page.keyboard.press('Escape');
    await page.locator('#desk-view').click({ position: { x: 5, y: 5 } });
    const chip = chipOn(page, 'Alpha task');
    const paletteColor = await colorOf(chip);
    await chip.click();
    await page.locator('#tag-color-popover .tag-color-swatch[data-color="#22c55e"]').click();
    await expect.poll(() => colorOf(chip)).not.toBe(paletteColor);
    await expect(chip).toHaveClass(/tag-custom/);
  });

  test('Options tag list: empty state, then rows with counts, live picker, and auto reset', async ({ page }) => {
    await openDesk(page);
    await openAppearance(page);
    await expect(page.locator('#tag-color-list .tag-color-empty')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#desk-view').click({ position: { x: 5, y: 5 } });

    await addTask(page, `Alpha task #${TAG_A}`);
    await addTask(page, `Charlie task #${TAG_A}`);
    await addTask(page, `Bravo task #${TAG_B}`);
    await openAppearance(page);

    const rows = page.locator('#tag-color-list .tag-color-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('.tag-chip')).toHaveText(TAG_A);
    await expect(rows.first().locator('.tag-color-count')).toHaveText('2 uses');
    await expect(rows.nth(1).locator('.tag-color-count')).toHaveText('1 use');

    const rowB = page.locator(`#tag-color-list .tag-color-row[data-tag-row="${TAG_B}"]`);
    await expect(rowB.locator('.tag-color-row-reset')).toBeDisabled();
    await rowB.locator('.tag-color-input').fill('#8b5cf6');
    await expect(page.locator('#density-popout')).toBeVisible();
    await expect(rowB).toHaveClass(/has-custom/);
    await expect(rowB.locator('.tag-color-row-reset')).toBeEnabled();
    await expect(chipOn(page, 'Bravo task')).toHaveClass(/tag-custom/);

    await rowB.locator('.tag-color-row-reset').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await expect(rowB).not.toHaveClass(/has-custom/);
    await expect(rowB.locator('.tag-color-row-reset')).toBeDisabled();
    await expect(chipOn(page, 'Bravo task')).not.toHaveClass(/tag-custom/);
  });
});

test.describe('Search overlay', { tag: ['@search'] }, () => {
  test('typing in the sidebar search shows a floating overlay with a result count', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Findable search target');

    await page.locator('#search-input').fill('Findable');
    const overlay = page.locator('#search-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).not.toHaveClass(/hidden/);
    await expect(page.locator('#search-overlay-count')).toContainText('1 result');
    await expect(page.locator('.search-result')).toContainText('Findable search target');
  });

  test('#tagname search filters to tagged items only', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Tagged item #urgent');
    await addTask(page, 'Untagged item');

    await page.locator('#search-input').fill('#urgent');
    await expect(page.locator('.search-result')).toHaveCount(1);
    await expect(page.locator('.search-result')).toContainText('Tagged item');
  });

  test('the #tag token can appear anywhere in the query, and extra words narrow by text regardless of order', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Set up another backlog grooming #ace');
    await addTask(page, 'Update the ACE dashboard #ace');
    await addTask(page, 'Unrelated task, no tag here');

    // "#ace" alone: both tagged items match.
    await page.locator('#search-input').fill('#ace');
    await expect(page.locator('.search-result')).toHaveCount(2);

    // Tag first, text after — must keep matching, not fall back to
    // "No items with that tag" just because the query now has more words.
    await page.locator('#search-input').fill('#ace set up');
    await expect(page.locator('.search-result')).toHaveCount(1);
    await expect(page.locator('.search-result')).toContainText('Set up another backlog grooming');

    // Text first, tag at the end — same result, tag position shouldn't matter.
    await page.locator('#search-input').fill('set up #ace');
    await expect(page.locator('.search-result')).toHaveCount(1);
    await expect(page.locator('.search-result')).toContainText('Set up another backlog grooming');

    // Tag in the middle, with words out of order relative to the task text
    // ("dashboard" appears after "ACE" in the content, not before).
    await page.locator('#search-input').fill('dashboard #ace update');
    await expect(page.locator('.search-result')).toHaveCount(1);
    await expect(page.locator('.search-result')).toContainText('Update the ACE dashboard');

    // Text that matches no tagged item narrows to zero, not an error state.
    await page.locator('#search-input').fill('#ace nonexistent-phrase');
    await expect(page.locator('.search-empty')).toContainText('No items with that tag');
  });

  test('the close button clears the query and hides the overlay', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Closable search result');

    await page.locator('#search-input').fill('Closable');
    await expect(page.locator('#search-overlay')).toBeVisible();

    await page.locator('#search-overlay-close').click();
    await expect(page.locator('#search-overlay')).toBeHidden();
    await expect(page.locator('#search-input')).toHaveValue('');
  });

  test('clicking outside the overlay closes it', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Outside click target');

    await page.locator('#search-input').fill('Outside');
    await expect(page.locator('#search-overlay')).toBeVisible();

    await page.locator('#desk-view').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#search-overlay')).toBeHidden();
  });
});

test.describe('Projects', { tag: ['@projects'] }, () => {
  async function openNewProject(page: Page, name: string) {
    await openDesk(page);
    await page.locator('#tab-projects').click();
    page.once('dialog', dialog => dialog.accept(name));
    await page.locator('#new-project-btn').click();
    await expect(page.locator('#project-title')).toHaveText(name);
    // Projects default to Notes tab; switch to Tasks for task-focused tests
    await page.locator('.project-tab-btn[data-project-tab="tasks"]').click();
  }

  test('typing a new task is preserved if an unrelated render fires mid-edit', async ({ page }) => {
    await openNewProject(page, 'Regression Project A');

    // Bystander task, saved first, used only to trigger a fresh
    // renderProjectDetail() call while the *other* task below is mid-edit.
    await page.locator('#project-add-task-btn').click();
    await page.locator('#project-tasks-list .project-item-editor').click();
    await page.locator('#project-tasks-list .project-item-editor').pressSequentially('Bystander task', { delay: 15 });
    await page.locator('#project-tasks-list button', { hasText: 'Save' }).click();

    // Start a second task and type into it, but don't save yet.
    await page.locator('#project-add-task-btn').click();
    const editor = page.locator('#project-tasks-list .project-item-editor');
    await editor.click();
    await editor.pressSequentially('Do the important thing', { delay: 15 });

    // Trigger renderProjectDetail() while the editor is active, without
    // archiving the bystander (completing moves it to the archive section
    // which is collapsed/hidden). Re-clicking the Tasks tab re-renders.
    await page.locator('.project-tab-btn[data-project-tab="tasks"]').click();

    await expect(page.locator('#project-tasks-list .project-item-editor')).toHaveText('Do the important thing');

    await page.locator('#project-tasks-list button', { hasText: 'Save' }).click();
    await expect(page.locator('.project-item-card', { hasText: 'Do the important thing' })).toBeVisible();
  });

  test('saving a task with no text removes the empty shell instead of leaving a blank card', async ({ page }) => {
    await openNewProject(page, 'Regression Project B');

    await page.locator('#project-add-task-btn').click();
    await page.locator('#project-tasks-list button', { hasText: 'Save' }).click();

    await expect(page.locator('#project-tasks-list .project-items-empty')).toBeVisible();
    await expect(page.locator('#project-tasks-list .project-item-card')).toHaveCount(0);
  });

  test('cancelling an edit reverts to the saved content, discarding any in-progress typing', async ({ page }) => {
    await openNewProject(page, 'Regression Project C');

    await page.locator('#project-add-task-btn').click();
    const editor = page.locator('#project-tasks-list .project-item-editor');
    await editor.click();
    await editor.pressSequentially('Original saved text', { delay: 15 });
    await page.locator('#project-tasks-list button', { hasText: 'Save' }).click();
    await expect(page.locator('.project-task-text')).toHaveText('Original saved text');

    await page.locator('#project-tasks-list button', { hasText: 'edit' }).click();
    const editEditor = page.locator('#project-tasks-list .project-item-editor');
    await editEditor.click();
    await editEditor.pressSequentially(' plus more', { delay: 15 });
    await page.locator('#project-tasks-list button', { hasText: 'Cancel' }).click();

    await expect(page.locator('.project-task-text')).toHaveText('Original saved text');
  });

  test('deleting a task records a tombstone, so a later cloud sync cannot resurrect it', async ({ page }) => {
    await openNewProject(page, 'Regression Project D');

    await page.locator('#project-add-task-btn').click();
    const editor = page.locator('#project-tasks-list .project-item-editor');
    await editor.click();
    await editor.pressSequentially('Task to be deleted', { delay: 15 });
    await page.locator('#project-tasks-list button', { hasText: 'Save' }).click();
    await expect(page.locator('.project-task-text')).toHaveText('Task to be deleted');

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#project-tasks-list button', { hasText: 'delete' }).click();
    await expect(page.locator('#project-tasks-list .project-items-empty')).toBeVisible();

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-projects') || '{}'));
    expect(stored.projects[0].tasks).toHaveLength(0);
    expect(Object.keys(stored.deletedIds || {}).length).toBeGreaterThan(0);
  });

  test('a numbered/bulleted list inside a note stays within the card, not flush against the border', async ({ page }) => {
    // A real <ol>/<li> list only ends up in note.content when pasted from a
    // source that already has list markup (Word/Docs/Confluence/etc — see
    // sanitizeHtml's LIST_ALLOWED handling); typing "1) " manually stays
    // plain text. Seed that shape directly so this test exercises the real
    // render path (createProjectNoteCard → .project-item-content) without
    // depending on flaky synthetic-clipboard paste emulation.
    await openDesk(page);
    await page.evaluate(() => {
      localStorage.setItem('work-desk-projects', JSON.stringify({
        projects: [{
          id: 'proj-list-test',
          name: 'List Regression Project',
          notes: [{
            id: 'note-list-test',
            type: 'note',
            content: '<p>Report Management will be split into 6 phases.</p><ol><li>First step</li><li>Second step</li></ol>',
            createdAt: new Date().toISOString(),
            comments: [],
          }],
          tasks: [],
        }],
        deletedIds: {},
      }));
    });
    await page.reload();
    await dismissAuthModal(page);
    await page.locator('#tab-projects').click();
    await page.locator('.projects-list li', { hasText: 'List Regression Project' }).click();
    await expect(page.locator('#project-title')).toHaveText('List Regression Project');

    const list = page.locator('#project-notes-list .project-item-content ol');
    await expect(list).toBeVisible();
    await expect(list.locator('li')).toHaveCount(2);

    // The global `* { margin:0; padding:0 }` reset used to leave this at 0,
    // which pushed the outside list marker past the card's left edge.
    const paddingLeft = await list.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(paddingLeft).toBeGreaterThan(8);

    // The list's left edge should stay within the card's padded content
    // area, not bleed out to (or past) the card's own border.
    const cardBox = await page.locator('#project-notes-list .project-item-card').boundingBox();
    const listBox = await list.boundingBox();
    expect(listBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
  });

  test('double-clicking a task\'s text opens the editor', async ({ page }) => {
    await openNewProject(page, 'Regression Project E');

    await page.locator('#project-add-task-btn').click();
    const editor = page.locator('#project-tasks-list .project-item-editor');
    await editor.click();
    await editor.pressSequentially('Double-click me', { delay: 15 });
    await page.locator('#project-tasks-list button', { hasText: 'Save' }).click();
    await expect(page.locator('.project-task-text')).toHaveText('Double-click me');
    await expect(page.locator('#project-tasks-list .project-item-editor')).toHaveCount(0);

    await page.locator('.project-task-text').dblclick();

    await expect(page.locator('#project-tasks-list .project-item-editor')).toHaveText('Double-click me');
    await expect(page.locator('#project-tasks-list button', { hasText: 'Save' })).toBeVisible();
  });
});

// ── Settings popout — 3-tab split ──────────────────────────────────────
test.describe('Settings popout tabs', { tag: ['@options'] }, () => {
  async function openSettings(page: Page) {
    await openDesk(page);
    await page.locator('#density-toggle').click();
    await expect(page.locator('#density-popout')).toBeVisible();
  }

  test('settings popout opens with three nav tabs visible', async ({ page }) => {
    await openSettings(page);
    const tabs = page.locator('.options-nav-btn');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveText('Themes');
    await expect(tabs.nth(1)).toHaveText('Appearance');
    await expect(tabs.nth(2)).toHaveText('Behavior');
  });

  test('Themes tab is active by default and its pane is visible', async ({ page }) => {
    await openSettings(page);
    const themesBtn = page.locator('.options-nav-btn[data-options-tab="themes"]');
    await expect(themesBtn).toHaveClass(/active/);
    await expect(page.locator('#options-pane-themes')).toBeVisible();
    await expect(page.locator('#options-pane-appearance')).toBeHidden();
    await expect(page.locator('#options-pane-behavior')).toBeHidden();
  });

  test('clicking Appearance tab shows appearance pane and hides themes pane', async ({ page }) => {
    await openSettings(page);
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(page.locator('#options-pane-appearance')).toBeVisible();
    await expect(page.locator('#options-pane-themes')).toBeHidden();
    await expect(page.locator('#options-pane-behavior')).toBeHidden();
    await expect(page.locator('.options-nav-btn[data-options-tab="appearance"]')).toHaveClass(/active/);
    await expect(page.locator('.options-nav-btn[data-options-tab="themes"]')).not.toHaveClass(/active/);
  });

  test('clicking Behavior tab shows behavior pane', async ({ page }) => {
    await openSettings(page);
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await expect(page.locator('#options-pane-behavior')).toBeVisible();
    await expect(page.locator('#options-pane-themes')).toBeHidden();
    await expect(page.locator('#options-pane-appearance')).toBeHidden();
    await expect(page.locator('.options-nav-btn[data-options-tab="behavior"]')).toHaveClass(/active/);
  });

  test('switching from Behavior back to Themes re-shows theme grid', async ({ page }) => {
    await openSettings(page);
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await expect(page.locator('#options-pane-themes')).toBeHidden();

    await page.locator('.options-nav-btn[data-options-tab="themes"]').click();
    await expect(page.locator('#options-pane-themes')).toBeVisible();
    await expect(page.locator('#customize-theme-grid')).toBeVisible();
  });

  test('themes pane contains theme filter buttons and grid', async ({ page }) => {
    await openSettings(page);
    await expect(page.locator('#options-pane-themes .theme-filter-btn')).toHaveCount(4);
    await expect(page.locator('#options-pane-themes #customize-theme-grid')).toBeVisible();
  });

  test('appearance pane contains card layout and typography controls', async ({ page }) => {
    await openSettings(page);
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(page.locator('#options-pane-appearance .density-option')).not.toHaveCount(0);
  });

  test('behavior pane contains auto-carry toggle', async ({ page }) => {
    await openSettings(page);
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await page.locator('#options-pane-behavior [data-options-open="tasks"]').click();
    await expect(page.locator('#options-pane-behavior #auto-carry-toggle-popout')).toBeVisible();
  });

  test('settings popout does NOT close when clicking inside it', async ({ page }) => {
    await openSettings(page);
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await page.locator('.options-nav-btn[data-options-tab="themes"]').click();
    await expect(page.locator('#density-popout')).toBeVisible();
  });
});

// ── Theme filter buttons ───────────────────────────────────────────────
test.describe('Theme filter buttons', { tag: ['@options', '@themes'] }, () => {
  async function openThemesTab(page: Page) {
    await openDesk(page);
    await page.locator('#density-toggle').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await expect(page.locator('#options-pane-themes')).toBeVisible();
  }

  test('Light filter is active by default and shows theme swatches', async ({ page }) => {
    await openThemesTab(page);
    await expect(page.locator('.theme-filter-btn[data-theme-filter="light"]')).toHaveClass(/active/);
    const swatches = page.locator('#customize-theme-grid .theme-swatch');
    await expect(swatches.first()).toBeVisible();
    const count = await swatches.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking Dark filter shows only dark themes', async ({ page }) => {
    await openThemesTab(page);
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await expect(page.locator('.theme-filter-btn[data-theme-filter="dark"]')).toHaveClass(/active/);
    await expect(page.locator('.theme-filter-btn[data-theme-filter="light"]')).not.toHaveClass(/active/);
    await expect(page.locator('#customize-theme-grid .theme-swatch').first()).toBeVisible();
  });

  test('clicking Med filter shows medium theme swatches', async ({ page }) => {
    await openThemesTab(page);
    await page.locator('.theme-filter-btn[data-theme-filter="medium"]').click();
    await expect(page.locator('.theme-filter-btn[data-theme-filter="medium"]')).toHaveClass(/active/);
    await expect(page.locator('.theme-filter-btn[data-theme-filter="light"]')).not.toHaveClass(/active/);
    const swatches = page.locator('#customize-theme-grid .theme-swatch');
    await expect(swatches.first()).toBeVisible();
    const count = await swatches.count();
    expect(count).toBe(36);
  });

  test('Light and Dark filters each show 36 swatches, the same as Medium, filling the 4-column grid', async ({ page }) => {
    await openThemesTab(page);
    await expect(page.locator('#customize-theme-grid .theme-swatch')).toHaveCount(36);
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await expect(page.locator('#customize-theme-grid .theme-swatch')).toHaveCount(36);
  });

  test('each new v1.21.0 theme swatch applies, persists across reload, and reads well', async ({ page }) => {
    await openDesk(page);
    const NEW_121: Array<[string, 'light' | 'medium' | 'dark', string]> = [
      ['gruvbox-light', 'light', 'Gruvbox Light'], ['rose-pine-dawn', 'light', 'Rosé Pine Dawn'], ['catppuccin-latte', 'light', 'Catppuccin Latte'], ['everforest-light', 'light', 'Everforest'],
      ['catppuccin-frappe', 'medium', 'Catppuccin Frappé'], ['gruvbox-mid', 'medium', 'Gruvbox Mid'], ['solarized-mid', 'medium', 'Solarized Mid'], ['rosewood', 'medium', 'Rosewood'],
      ['kanagawa', 'dark', 'Kanagawa'], ['monokai-pro', 'dark', 'Monokai Pro'], ['rose-pine-moon', 'dark', 'Rosé Pine Moon'], ['everforest-dark', 'dark', 'Everforest'],
    ];
    for (const [id, tier, name] of NEW_121) {
      await page.locator('#density-toggle').click();
      await expect(page.locator('#options-pane-themes')).toBeVisible();
      await page.locator(`.theme-filter-btn[data-theme-filter="${tier}"]`).click();
      const swatch = page.locator(`#customize-theme-grid .theme-swatch[data-theme-id="${id}"]`);
      await expect(swatch).toBeVisible();
      await expect(swatch).toContainText(name);
      await swatch.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', id);
      await expect(page.locator('#density-popout')).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem('work-desk-theme'))).toBe(id);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(tier === 'light' ? 'light' : 'dark');
    }
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'everforest-dark');
    // Light-accent themes put dark text on the Add button
    const addBtn = page.locator('.add-btn').first();
    await expect.poll(() => addBtn.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(45, 53, 59)');
  });

  const NEW_THEMES: Array<[string, 'light' | 'medium' | 'dark']> = [
    ['retro', 'light'], ['seafoam', 'light'], ['mediterranean', 'light'], ['citrus', 'light'],
    ['dot-matrix', 'medium'], ['denim', 'medium'], ['terracotta', 'medium'], ['merlot', 'medium'],
    ['monokai', 'dark'], ['one-dark', 'dark'], ['phosphor', 'dark'], ['rose-pine', 'dark'],
  ];

  test('each new v1.8.0 theme swatch applies and persists its theme', async ({ page }) => {
    await openDesk(page);
    for (const [id, tier] of NEW_THEMES) {
      await page.locator('#density-toggle').click();
      await expect(page.locator('#options-pane-themes')).toBeVisible();
      await page.locator(`.theme-filter-btn[data-theme-filter="${tier}"]`).click();
      const swatch = page.locator(`#customize-theme-grid .theme-swatch[data-theme-id="${id}"]`);
      await expect(swatch).toBeVisible();
      await swatch.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', id);
      await expect(page.locator('#density-popout')).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem('work-desk-theme'))).toBe(id);
    }
  });

  test('active swatch is highlighted in the tier the new theme belongs to', async ({ page }) => {
    await openThemesTab(page);
    await page.locator('.theme-filter-btn[data-theme-filter="medium"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="dot-matrix"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dot-matrix');
    await page.locator('#density-toggle').click();
    await expect(page.locator('.theme-filter-btn[data-theme-filter="medium"]')).toHaveClass(/active/);
    await expect(page.locator('#customize-theme-grid .theme-swatch[data-theme-id="dot-matrix"]')).toHaveClass(/active/);
  });

  test('Retro theme shows the SNES controller stripe and survives reload', async ({ page }) => {
    await openThemesTab(page);
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="retro"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
    const stripe = await page.locator('.desk-sticky').first().evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(stripe).toContain('linear-gradient');
    expect(stripe).toContain('rgb(208, 43, 43)');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
  });

  test('Phosphor theme uses dark text on the Add button', async ({ page }) => {
    await openThemesTab(page);
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="phosphor"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'phosphor');
    const addBtn = page.locator('.add-btn').first();
    await expect.poll(() => addBtn.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(3, 20, 10)');
  });

  const UNIT_STRIPE_LEAD: Record<string, string> = {
    zero: 'rgb(47, 111, 184)', one: 'rgb(107, 63, 160)', two: 'rgb(215, 38, 61)', eight: 'rgb(232, 85, 154)',
  };
  const UNIT_TIERS: Array<['light' | 'medium' | 'dark', string]> = [['light', '-light'], ['medium', '-mid'], ['dark', '']];

  test('every Unit swatch in every tier applies its theme, draws the header stripe, and persists', async ({ page }) => {
    await openDesk(page);
    for (const [tier, suffix] of UNIT_TIERS) {
      for (const unit of Object.keys(UNIT_STRIPE_LEAD)) {
        const id = `unit-${unit}${suffix}`;
        await page.locator('#density-toggle').click();
        await expect(page.locator('#options-pane-themes')).toBeVisible();
        await page.locator(`.theme-filter-btn[data-theme-filter="${tier}"]`).click();
        await expect(page.locator('#density-popout')).toBeVisible();
        const swatch = page.locator(`#customize-theme-grid .theme-swatch[data-theme-id="${id}"]`);
        await swatch.scrollIntoViewIfNeeded();
        await expect(swatch).toBeVisible();
        await swatch.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', id);
        await expect(page.locator('#density-popout')).toBeHidden();
        expect(await page.evaluate(() => localStorage.getItem('work-desk-theme'))).toBe(id);
        const stripe = await page.locator('.desk-sticky').first().evaluate((el) => getComputedStyle(el).backgroundImage);
        expect(stripe, id).toContain(UNIT_STRIPE_LEAD[unit]);
      }
    }
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'unit-eight');
  });

  test('Unit themes keep the same names in each tier and show as active when reopened', async ({ page }) => {
    await openThemesTab(page);
    for (const [tier, suffix] of UNIT_TIERS) {
      await page.locator(`.theme-filter-btn[data-theme-filter="${tier}"]`).click();
      for (const [unit, name] of [['zero', 'Unit Zero'], ['one', 'Unit One'], ['two', 'Unit Two'], ['eight', 'Unit Eight']]) {
        await expect(page.locator(`#customize-theme-grid .theme-swatch[data-theme-id="unit-${unit}${suffix}"]`)).toContainText(name);
      }
    }
    await page.locator('.theme-filter-btn[data-theme-filter="medium"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="unit-one-mid"]').click();
    await page.locator('#density-toggle').click();
    await expect(page.locator('.theme-filter-btn[data-theme-filter="medium"]')).toHaveClass(/active/);
    await expect(page.locator('#customize-theme-grid .theme-swatch[data-theme-id="unit-one-mid"]')).toHaveClass(/active/);
  });

  test('bright Unit accents use dark text on the Add button', async ({ page }) => {
    await openThemesTab(page);
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="unit-one"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'unit-one');
    const addBtn = page.locator('.add-btn').first();
    await expect.poll(() => addBtn.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(16, 10, 28)');
  });

  test('a saved gameboy theme loads as Dot Matrix and is rewritten in storage', async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('rename-seeded')) {
        localStorage.setItem('rename-seeded', '1');
        localStorage.setItem('work-desk-theme', 'gameboy');
      }
    });
    await openDesk(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dot-matrix');
    expect(await page.evaluate(() => localStorage.getItem('work-desk-theme'))).toBe('dot-matrix');
    await page.locator('#density-toggle').click();
    await expect(page.locator('.theme-filter-btn[data-theme-filter="medium"]')).toHaveClass(/active/);
    const swatch = page.locator('#customize-theme-grid .theme-swatch[data-theme-id="dot-matrix"]');
    await expect(swatch).toHaveClass(/active/);
    await expect(swatch).toContainText('Dot Matrix');
    await expect(page.locator('#customize-theme-grid')).not.toContainText('Game Boy');
  });

  test('switching between all four filters keeps popout open', async ({ page }) => {
    await openThemesTab(page);
    await page.locator('.theme-filter-btn[data-theme-filter="medium"]').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await page.locator('.theme-filter-btn[data-theme-filter="custom"]').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await page.locator('.theme-filter-btn[data-theme-filter="light"]').click();
    await expect(page.locator('#density-popout')).toBeVisible();
  });

  test('clicking a theme swatch applies the theme', async ({ page }) => {
    await openThemesTab(page);
    const secondSwatch = page.locator('#customize-theme-grid .theme-swatch').nth(1);
    const themeId = await secondSwatch.getAttribute('data-theme-id');
    expect(themeId).toBeTruthy();
    await secondSwatch.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', themeId!);
  });

  test('clicking Custom filter hides preset grid and shows custom panel', async ({ page }) => {
    await openThemesTab(page);
    await page.locator('.theme-filter-btn[data-theme-filter="custom"]').click();
    await expect(page.locator('.theme-filter-btn[data-theme-filter="custom"]')).toHaveClass(/active/);
    await expect(page.locator('#custom-theme-panel')).toBeVisible();
  });

  test('switching from Custom back to Light restores the preset grid', async ({ page }) => {
    await openThemesTab(page);
    await page.locator('.theme-filter-btn[data-theme-filter="custom"]').click();
    await expect(page.locator('#custom-theme-panel')).toBeVisible();

    await page.locator('.theme-filter-btn[data-theme-filter="light"]').click();
    await expect(page.locator('#customize-theme-grid .theme-swatch').first()).toBeVisible();
  });
});

// ── Custom theme builder (E2E) ─────────────────────────────────────────
test.describe('Custom theme builder', { tag: ['@themes'] }, () => {
  async function openCustomPanel(page: Page) {
    await openDesk(page);
    await page.locator('#density-toggle').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await page.locator('.theme-filter-btn[data-theme-filter="custom"]').click();
    await expect(page.locator('#custom-theme-panel')).toBeVisible();
  }

  test('custom panel shows add-tile when no custom themes exist', async ({ page }) => {
    await openCustomPanel(page);
    await expect(page.locator('.custom-add-tile')).toBeVisible();
  });

  test('clicking add-tile does NOT close settings popout (DOM detach guard)', async ({ page }) => {
    await openCustomPanel(page);
    await page.locator('.custom-add-tile').click();
    await expect(page.locator('#density-popout')).toBeVisible();
  });

  test('clicking add-tile opens the custom theme editor', async ({ page }) => {
    await openCustomPanel(page);
    await page.locator('.custom-add-tile').click();
    await expect(page.locator('.custom-editor')).toBeVisible();
  });

  test('custom editor has 5 color pickers and a light/dark mode toggle', async ({ page }) => {
    await openCustomPanel(page);
    await page.locator('.custom-add-tile').click();
    await expect(page.locator('.custom-editor')).toBeVisible();

    const colorInputs = page.locator('.custom-editor input[type="color"]');
    await expect(colorInputs).toHaveCount(5);

    const modeButtons = page.locator('.custom-mode-btn');
    await expect(modeButtons).toHaveCount(2);
    await expect(modeButtons.nth(0)).toHaveText('Light');
    await expect(modeButtons.nth(1)).toHaveText('Dark');
    await expect(modeButtons.nth(0)).toHaveClass(/active/);
  });

  test('custom editor has a live preview panel', async ({ page }) => {
    await openCustomPanel(page);
    await page.locator('.custom-add-tile').click();
    await expect(page.locator('.custom-preview-app')).toBeVisible();
  });

  test('saving a custom theme creates a swatch in the browse view', async ({ page }) => {
    await openCustomPanel(page);
    await page.locator('.custom-add-tile').click();
    await expect(page.locator('.custom-editor')).toBeVisible();

    const nameInput = page.locator('.custom-editor-name');
    await nameInput.fill('Test Theme');

    const saveBtn = page.locator('.custom-btn-primary');
    await saveBtn.click();

    await expect(page.locator('.custom-swatch-wrap')).toBeVisible();
    await expect(page.locator('#density-popout')).toBeVisible();
  });

  test('full round-trip: create → apply → edit → delete', async ({ page }) => {
    await openCustomPanel(page);

    // Create
    await page.locator('.custom-add-tile').click();
    const nameInput = page.locator('.custom-editor-name');
    await nameInput.fill('Round Trip Theme');
    await page.locator('.custom-btn-primary').click();
    await expect(page.locator('.custom-swatch-wrap')).toBeVisible();

    // Apply — click the theme swatch inside the wrap
    await page.locator('.custom-swatch-wrap .theme-swatch').first().click();
    await page.waitForFunction(() => (localStorage.getItem('work-desk-theme') || '').startsWith('custom-'));
    const appliedTheme = await page.evaluate(() => localStorage.getItem('work-desk-theme'));
    expect(appliedTheme).toMatch(/^custom-/);

    // Edit — hover to reveal delete, then right-click swatch to edit
    await page.locator('.custom-swatch-wrap .theme-swatch').first().click({ button: 'right' });

    // If we got into the editor, confirm it's visible
    const editorVisible = await page.locator('.custom-editor').isVisible().catch(() => false);
    if (editorVisible) {
      const editorName = page.locator('.custom-editor-name');
      await editorName.fill('Renamed Theme');
      await page.locator('.custom-btn-primary').click();
    }

    // Delete — hover the wrap to reveal the × button
    await expect(page.locator('#density-popout')).toBeVisible();
    await page.locator('.custom-swatch-wrap').first().hover();
    const deleteBtn = page.locator('.custom-swatch-delete').first();
    await deleteBtn.click();
    await expect(page.locator('.custom-swatch-wrap')).toHaveCount(0);
  });

  test('custom theme persists across page reload', async ({ page }) => {
    await openCustomPanel(page);
    await page.locator('.custom-add-tile').click();
    const nameInput = page.locator('.custom-editor-name');
    await nameInput.fill('Persistent Theme');
    await page.locator('.custom-btn-primary').click();
    await expect(page.locator('.custom-swatch-wrap')).toBeVisible();

    // Apply the custom theme
    await page.locator('.custom-swatch-wrap .theme-swatch').first().click();
    await page.waitForFunction(() => (localStorage.getItem('work-desk-theme') || '').startsWith('custom-'));
    const themeId = await page.evaluate(() => localStorage.getItem('work-desk-theme'));
    expect(themeId).toMatch(/^custom-/);

    // Reload and verify persistence
    await page.reload();
    await dismissAuthModal(page);
    const themeAfterReload = await page.evaluate(() => localStorage.getItem('work-desk-theme'));
    expect(themeAfterReload).toBe(themeId);
  });

  test('max 5 custom themes enforced — add tile disappears at limit', async ({ page }) => {
    await openCustomPanel(page);

    for (let i = 1; i <= 5; i++) {
      await page.locator('.custom-add-tile').click();
      await page.locator('.custom-editor-name').fill(`Theme ${i}`);
      await page.locator('.custom-btn-primary').click();
      await expect(page.locator('#density-popout')).toBeVisible();
    }

    const addTile = page.locator('.custom-add-tile');
    await expect(addTile).toHaveCount(0);
    const swatches = page.locator('.custom-swatch-wrap');
    expect(await swatches.count()).toBe(5);
  });
});

// ── Comments system ────────────────────────────────────────────────────
test.describe('Comments', { tag: ['@board'] }, () => {
  async function addCommentToTask(page: Page, taskText: string, commentText: string) {
    const card = page.locator('.item-card', { hasText: taskText }).first();
    await card.locator('.card-action', { hasText: /^comment/i }).click();
    await expect(card.locator('.comments-panel')).toBeVisible();

    const trigger = card.locator('.add-comment-trigger');
    if (await trigger.isVisible()) await trigger.click();

    const editor = card.locator('.add-comment-form .comment-input');
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.pressSequentially(commentText, { delay: 15 });

    await card.locator('.comment-add-btn').click();
  }

  test('adding a comment shows it in the comments panel', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Commentable task');
    await addCommentToTask(page, 'Commentable task', 'First comment here');
    await expect(page.locator('.comment', { hasText: 'First comment here' })).toBeVisible();
  });

  async function openCommentEditor(page: Page, taskText: string, action: RegExp = /^comment/i) {
    const card = page.locator('.item-card', { hasText: taskText }).first();
    await card.locator('.card-action', { hasText: action }).click();
    const trigger = card.locator('.add-comment-trigger');
    if (await trigger.isVisible()) await trigger.click();
    const editor = card.locator('.add-comment-form .comment-input');
    await expect(editor).toBeVisible();
    await editor.click();
    return { card, editor };
  }

  test('Ctrl+Enter adds a comment without clicking Add', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Shortcut task');
    const { card, editor } = await openCommentEditor(page, 'Shortcut task');
    await editor.pressSequentially('Via keyboard', { delay: 15 });
    await editor.press('Control+Enter');
    await expect(card.locator('.comment', { hasText: 'Via keyboard' })).toHaveCount(1);
    await expect(card.locator('.card-action.has-comments')).toContainText('comments (1)');
    await expect(page.locator('.item-card', { hasText: 'Shortcut task' })).toHaveCount(1);
  });

  test('Cmd+Enter adds a comment too, and adds the next one after it', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Mac shortcut task');
    const { card, editor } = await openCommentEditor(page, 'Mac shortcut task');
    await editor.pressSequentially('First', { delay: 15 });
    await editor.press('Meta+Enter');
    await expect(card.locator('.comment', { hasText: 'First' })).toBeVisible();
    const trigger = card.locator('.add-comment-trigger');
    if (await trigger.isVisible()) await trigger.click();
    const next = card.locator('.add-comment-form .comment-input');
    await next.click();
    await next.pressSequentially('Second', { delay: 15 });
    await next.press('Control+Enter');
    await expect(card.locator('.comment')).toHaveCount(2);
  });

  test('Ctrl+Enter in an empty comment box adds nothing and keeps the box open', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Empty shortcut task');
    const { card, editor } = await openCommentEditor(page, 'Empty shortcut task');
    await expect(card.locator('.comment-add-btn')).toBeDisabled();
    await editor.press('Control+Enter');
    await expect(card.locator('.comment')).toHaveCount(0);
    await expect(card.locator('.add-comment-form .comment-input')).toBeVisible();
    await expect(page.locator('.item-card', { hasText: 'Empty shortcut task' })).toHaveCount(1);
  });

  test('Ctrl+Enter adds an update to a note', async ({ page }) => {
    await openDesk(page);
    await page.locator('.type-btn[data-type="note"]').click();
    await addTask(page, 'Shortcut note');
    const { card, editor } = await openCommentEditor(page, 'Shortcut note', /add update/i);
    await editor.pressSequentially('Note update', { delay: 15 });
    await editor.press('Control+Enter');
    await expect(card.locator('.comment', { hasText: 'Note update' })).toBeVisible();
    await expect(card.locator('.card-action', { hasText: 'updates (1)' })).toBeVisible();
  });

  test('comment count badge increments after adding a comment', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Badge counter task');
    await addCommentToTask(page, 'Badge counter task', 'Badge test');
    const card = page.locator('.item-card', { hasText: 'Badge counter task' }).first();
    await expect(card.locator('.card-action.has-comments')).toContainText('comments (1)');
  });

  test('deleting a comment removes it and shows undo toast', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Delete comment task');
    await addCommentToTask(page, 'Delete comment task', 'Will be deleted');
    await expect(page.locator('.comment', { hasText: 'Will be deleted' })).toBeVisible();

    const comment = page.locator('.comment', { hasText: 'Will be deleted' });
    await comment.hover();
    await comment.locator('.comment-action-delete').click();
    await expect(page.locator('.comment', { hasText: 'Will be deleted' })).toHaveCount(0);
    await expect(page.locator('#toast')).toBeVisible();
  });

  test('editing a comment updates its content', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Edit comment task');
    await addCommentToTask(page, 'Edit comment task', 'Original comment');
    await expect(page.locator('.comment', { hasText: 'Original comment' })).toBeVisible();

    const comment = page.locator('.comment', { hasText: 'Original comment' });
    await comment.hover();
    await comment.locator('.comment-action-edit').click();
    const editEditor = page.locator('.comment-edit-wrap .comment-input');
    await expect(editEditor).toBeVisible();
    await editEditor.click();
    await editEditor.press('Control+a');
    await editEditor.pressSequentially('Updated comment', { delay: 15 });
    await page.locator('.comment-edit-wrap .edit-save-btn').click();

    await expect(page.locator('.comment', { hasText: 'Updated comment' })).toBeVisible();
  });

  test('collapsing and re-expanding comments preserves the thread', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Toggle comments task');
    await addCommentToTask(page, 'Toggle comments task', 'Persistent comment');
    await expect(page.locator('.comment', { hasText: 'Persistent comment' })).toBeVisible();

    const card = page.locator('.item-card', { hasText: 'Toggle comments task' }).first();
    await card.locator('.card-action', { hasText: /^comment/i }).click();
    await expect(card.locator('.comments-panel')).toHaveCount(0);

    await card.locator('.card-action', { hasText: /^comment/i }).click();
    await expect(page.locator('.comment', { hasText: 'Persistent comment' })).toBeVisible();
  });

  test('splitting a comment to a task creates a new task card on the same day', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Split source task');
    await addCommentToTask(page, 'Split source task', 'This should become its own task');

    const comment = page.locator('.comment', { hasText: 'This should become its own task' });
    await expect(comment).toBeVisible();
    await comment.hover();

    const splitBtn = comment.locator('.comment-split-btn.split-task');
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();

    await expect(page.locator('.item-card', { hasText: 'This should become its own task' })).toHaveCount(2);

    const newCard = page.locator('.item-card', { hasText: 'This should become its own task' }).last();
    await expect(newCard).toBeVisible();
  });

  test('split task gets a breadcrumb comment linking back to the source', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Breadcrumb parent');
    await addCommentToTask(page, 'Breadcrumb parent', 'Spin this off');

    const comment = page.locator('.comment', { hasText: 'Spin this off' });
    await comment.hover();
    await comment.locator('.comment-split-btn.split-task').click();

    const newCard = page.locator('.item-card', { hasText: 'Spin this off' }).last();
    await newCard.hover();
    await newCard.locator('.card-action', { hasText: /^comment/i }).click();
    await expect(newCard.locator('.comment', { hasText: 'Split from: Breadcrumb parent' })).toBeVisible();
  });

  test('original comment is annotated after split', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Annotate test');
    await addCommentToTask(page, 'Annotate test', 'Will be annotated');

    const comment = page.locator('.comment', { hasText: 'Will be annotated' });
    await comment.hover();
    await comment.locator('.comment-split-btn.split-task').click();

    await expect(page.locator('.comment-text', { hasText: 'moved to task' })).toBeVisible();
  });

  test('splitting a comment to a note creates a note card', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Note split source');
    await addCommentToTask(page, 'Note split source', 'Becomes a note');

    const comment = page.locator('.comment', { hasText: 'Becomes a note' });
    await expect(comment).toBeVisible();
    await comment.hover();

    const splitBtn = comment.locator('.comment-split-btn.split-note');
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();

    const noteCards = page.locator('.item-card', { hasText: 'Becomes a note' });
    await expect(noteCards).toHaveCount(2);
  });

  test('undo toast reverses the split', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Undo split test');
    await addCommentToTask(page, 'Undo split test', 'Undo me');

    const comment = page.locator('.comment', { hasText: 'Undo me' });
    await comment.hover();
    await comment.locator('.comment-split-btn.split-task').click();

    await expect(page.locator('.item-card', { hasText: 'Undo me' })).toHaveCount(2);

    const undoBtn = page.locator('.toast-undo-btn');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    await expect(page.locator('.item-card', { hasText: 'Undo me' })).toHaveCount(1);
  });

  test('comment hover actions are plain text links in a single consistent style', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Action label task');
    await addCommentToTask(page, 'Action label task', 'Label check');

    const comment = page.locator('.comment', { hasText: 'Label check' });
    await comment.hover();
    const actions = comment.locator('.comment-actions .comment-split-btn');
    await expect(actions).toHaveText(['edit', 'delete', '→ task', '→ note']);
    await expect(comment.locator('.comment-actions svg')).toHaveCount(0);

    // Neither split link should be highlighted at rest
    const colors = await actions.evaluateAll(els => els.map(el => getComputedStyle(el).color));
    expect(colors[2]).toBe(colors[3]);
  });
});

// ── Recurring templates ────────────────────────────────────────────────
test.describe('Recurring templates', { tag: ['@recurring'] }, () => {
  test('recurring button opens the modal', async ({ page }) => {
    await openDesk(page);
    await page.locator('#recurring-btn').click();
    await expect(page.locator('#recurring-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('.recurring-modal-header')).toBeVisible();
  });

  test('close button dismisses the recurring modal', async ({ page }) => {
    await openDesk(page);
    await page.locator('#recurring-btn').click();
    await expect(page.locator('#recurring-modal')).not.toHaveClass(/hidden/);
    await page.locator('#recurring-close').click();
    await expect(page.locator('#recurring-modal')).toHaveClass(/hidden/);
  });

  test('adding a recurring template shows it in the list', async ({ page }) => {
    await openDesk(page);
    await page.locator('#recurring-btn').click();
    await expect(page.locator('#recurring-modal')).not.toHaveClass(/hidden/);

    const editor = page.locator('#recurring-modal .rich-editor');
    await editor.click();
    await editor.pressSequentially('Daily standup', { delay: 15 });

    await page.locator('#recurring-modal .modal-btn.primary').click();

    await expect(page.locator('.recurring-template-item', { hasText: 'Daily standup' })).toBeVisible();
    await expect(page.locator('.recurring-rule-badge')).toBeVisible();
  });

  test('editing a recurring template updates its content', async ({ page }) => {
    await openDesk(page);
    await page.locator('#recurring-btn').click();

    const editor = page.locator('#recurring-modal .rich-editor').first();
    await editor.click();
    await editor.pressSequentially('Original recurring', { delay: 15 });
    await page.locator('#recurring-modal .modal-btn.primary').click();
    await expect(page.locator('.recurring-template-item', { hasText: 'Original recurring' })).toBeVisible();

    await page.locator('.recurring-action-link', { hasText: 'edit' }).first().click();
    const editEditor = page.locator('.recurring-template-item .rich-editor').first();
    await expect(editEditor).toBeVisible();
    await editEditor.click();
    await editEditor.press('Control+a');
    await editEditor.pressSequentially('Updated recurring', { delay: 15 });
    await page.locator('.recurring-template-item .modal-btn.primary').first().click();

    await expect(page.locator('.recurring-template-item', { hasText: 'Updated recurring' })).toBeVisible();
  });

  test('deleting a recurring template removes it from the list', async ({ page }) => {
    await openDesk(page);
    await page.locator('#recurring-btn').click();

    const editor = page.locator('#recurring-modal .rich-editor').first();
    await editor.click();
    await editor.pressSequentially('To be deleted', { delay: 15 });
    await page.locator('#recurring-modal .modal-btn.primary').click();
    await expect(page.locator('.recurring-template-item', { hasText: 'To be deleted' })).toBeVisible();

    await page.locator('.recurring-action-link.danger', { hasText: 'delete' }).first().click();
    await expect(page.locator('.recurring-template-item', { hasText: 'To be deleted' })).toHaveCount(0);
  });

  test('recurring templates persist across modal close/reopen', async ({ page }) => {
    await openDesk(page);
    await page.locator('#recurring-btn').click();

    const editor = page.locator('#recurring-modal .rich-editor').first();
    await editor.click();
    await editor.pressSequentially('Persistent template', { delay: 15 });
    await page.locator('#recurring-modal .modal-btn.primary').click();
    await expect(page.locator('.recurring-template-item', { hasText: 'Persistent template' })).toBeVisible();

    await page.locator('#recurring-close').click();
    await page.locator('#recurring-btn').click();

    await expect(page.locator('.recurring-template-item', { hasText: 'Persistent template' })).toBeVisible();
  });
});

test.describe('Recurring schedules 1.21.0', { tag: ['@recurring'] }, () => {
  const modal = (page: Page) => page.locator('#recurring-modal');
  const addForm = (page: Page) => page.locator('#recurring-modal .recurring-add-form');
  const storedTemplates = (page: Page) =>
    page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-recurring-work') || '{"templates":[]}').templates);

  async function openRecurring(page: Page, text: string) {
    await openDesk(page);
    await page.locator('#recurring-btn').click();
    await expect(modal(page)).not.toHaveClass(/hidden/);
    const editor = addForm(page).locator('.rich-editor');
    await editor.click();
    await editor.pressSequentially(text, { delay: 10 });
  }

  test('every rule button selects, and its options stay inside the open modal', async ({ page }) => {
    await openRecurring(page, 'Rule tour');
    const form = addForm(page);
    for (const rule of ['daily', 'weekdays', 'weekly', 'custom', 'biweekly', 'monthly', 'quarterly']) {
      await form.locator(`.rule-btn[data-rule="${rule}"]`).click();
      await expect(form.locator(`.rule-btn[data-rule="${rule}"]`)).toHaveClass(/active/);
      await expect(form.locator('.recurring-rule-btns .rule-btn.active')).toHaveCount(1);
      await expect(modal(page)).not.toHaveClass(/hidden/);
    }
    await expect(form.locator('.recurring-quarter-months .quarter-btn')).toHaveCount(3);
    await form.locator('.rule-btn[data-rule="weekly"]').click();
    await expect(form.locator('.day-picker .day-btn')).toHaveCount(7);
    await form.locator('.rule-btn[data-rule="daily"]').click();
    await expect(form.locator('.day-picker')).toHaveCount(0);
  });

  test('monthly on the 3rd Thursday: weekday mode, adds with a readable label, and every option click keeps the modal open', async ({ page }) => {
    await openRecurring(page, '1-1 with Laura');
    const form = addForm(page);
    await form.locator('.rule-btn[data-rule="monthly"]').click();
    await form.locator('.month-by-btn', { hasText: 'Day of week' }).click();
    await expect(form.locator('.month-by-btn', { hasText: 'Day of week' })).toHaveClass(/active/);
    await expect(modal(page)).not.toHaveClass(/hidden/);

    await form.locator('.modal-btn.primary').click();
    await expect(page.locator('#toast')).toContainText('Please choose a week and a day');
    expect(await storedTemplates(page)).toHaveLength(0);

    await form.locator('.month-week-btn', { hasText: '3rd' }).click();
    await expect(form.locator('.month-week-btn', { hasText: '3rd' })).toHaveClass(/active/);
    await expect(modal(page)).not.toHaveClass(/hidden/);
    await form.locator('.day-picker .day-btn[title="Thursday"], .day-picker .day-btn[title="Thu"]').click();
    await expect(form.locator('.day-picker .day-btn.active')).toHaveCount(1);
    await expect(modal(page)).not.toHaveClass(/hidden/);

    await form.locator('.modal-btn.primary').click();
    const item = page.locator('.recurring-template-item', { hasText: '1-1 with Laura' });
    await expect(item.locator('.recurring-rule-badge').first()).toHaveText('Monthly on the 3rd Thu');
    const [t] = await storedTemplates(page);
    expect(t).toMatchObject({ rule: 'monthly', monthBy: 'weekday', weeks: [3], days: [4] });
  });

  test('twice a month by date (1st and 15th), Last day, and the empty-date guard', async ({ page }) => {
    await openRecurring(page, 'Twice monthly by date');
    const form = addForm(page);
    await form.locator('.rule-btn[data-rule="monthly"]').click();
    await expect(form.locator('.month-by-btn', { hasText: 'Day of month' })).toHaveClass(/active/);
    await expect(form.locator('.month-day-grid .month-day-btn')).toHaveCount(32);
    await form.locator('.modal-btn.primary').click();
    await expect(page.locator('#toast')).toContainText('Please choose at least one day of the month');

    const day = (label: string) => form.locator('.month-day-grid .month-day-btn').getByText(label, { exact: true });
    await day('15').click();
    await day('1').click();
    await day('Last').click();
    await expect(modal(page)).not.toHaveClass(/hidden/);
    await day('Last').click();
    await expect(form.locator('.month-day-btn.active')).toHaveCount(2);
    await form.locator('.modal-btn.primary').click();
    await expect(page.locator('.recurring-template-item', { hasText: 'Twice monthly by date' }).locator('.recurring-rule-badge').first())
      .toHaveText('Monthly on the 1st & 15th');
    expect((await storedTemplates(page))[0]).toMatchObject({ rule: 'monthly', monthBy: 'date', monthDays: [1, 15] });
  });

  test('every 2 weeks takes its weekday from the start date', async ({ page }) => {
    await openRecurring(page, '1-1 with Sara');
    const form = addForm(page);
    await form.locator('.rule-btn[data-rule="biweekly"]').click();
    const input = form.locator('.recurring-start-date');
    await expect(input).toBeVisible();
    await input.fill('2026-10-06');
    await expect(form.locator('.recurring-schedule-hint')).toContainText('Every other Tuesday, starting Oct 6');
    await expect(modal(page)).not.toHaveClass(/hidden/);
    await form.locator('.modal-btn.primary').click();
    await expect(page.locator('.recurring-template-item', { hasText: '1-1 with Sara' }).locator('.recurring-rule-badge').first())
      .toHaveText('Every other Tue');
    expect((await storedTemplates(page))[0]).toMatchObject({ rule: 'biweekly', startDate: '2026-10-06', days: [2] });
  });

  test('quarterly: pick a month set; edit round trip switches to monthly and back, then delete', async ({ page }) => {
    await openRecurring(page, 'Quarterly review');
    let form = addForm(page);
    await form.locator('.rule-btn[data-rule="quarterly"]').click();
    await form.locator('.month-day-grid .month-day-btn').getByText('1', { exact: true }).click();
    for (const label of ['Jan · Apr · Jul · Oct', 'Mar · Jun · Sep · Dec', 'Feb · May · Aug · Nov']) {
      await form.locator('.quarter-btn', { hasText: label }).click();
      await expect(form.locator('.quarter-btn.active')).toHaveText(label);
      await expect(modal(page)).not.toHaveClass(/hidden/);
    }
    await form.locator('.modal-btn.primary').click();
    const item = () => page.locator('.recurring-template-item', { hasText: 'Quarterly review' });
    await expect(item().locator('.recurring-rule-badge').first()).toHaveText('Quarterly on the 1st (Feb, May, Aug, Nov)');

    // Edit: the picker opens on the saved schedule
    await item().locator('.recurring-action-link', { hasText: 'edit' }).click();
    form = page.locator('.recurring-template-item').first();
    await expect(form.locator('.rule-btn[data-rule="quarterly"]')).toHaveClass(/active/);
    await expect(form.locator('.quarter-btn.active')).toHaveText('Feb · May · Aug · Nov');
    await expect(form.locator('.month-day-btn.active')).toHaveText('1');
    // Monthly keeps the picked dates; switch to weekday mode, 1st and 3rd Tuesday
    await form.locator('.rule-btn[data-rule="monthly"]').click();
    await expect(form.locator('.month-day-btn.active')).toHaveText('1');
    await form.locator('.month-by-btn', { hasText: 'Day of week' }).click();
    await form.locator('.month-week-btn', { hasText: '1st' }).click();
    await form.locator('.month-week-btn', { hasText: '3rd' }).click();
    await form.locator('.day-picker .day-btn[title="Tuesday"], .day-picker .day-btn[title="Tue"]').click();
    await expect(modal(page)).not.toHaveClass(/hidden/);
    await form.locator('.modal-btn.primary').click();
    await expect(item().locator('.recurring-rule-badge').first()).toHaveText('Monthly on the 1st & 3rd Tue');
    const [t] = await storedTemplates(page);
    expect(t).toMatchObject({ rule: 'monthly', monthBy: 'weekday', weeks: [1, 3], days: [2] });
    expect(t.startMonth).toBeUndefined();
    expect(t.monthDays).toBeUndefined();

    // Cancel leaves it alone
    await item().locator('.recurring-action-link', { hasText: 'edit' }).click();
    await page.locator('.recurring-template-item').first().locator('.rule-btn[data-rule="daily"]').click();
    await page.locator('.recurring-template-item').first().locator('.modal-btn', { hasText: 'Cancel' }).click();
    await expect(item().locator('.recurring-rule-badge').first()).toHaveText('Monthly on the 1st & 3rd Tue');

    await item().locator('.recurring-action-link.danger', { hasText: 'delete' }).click();
    await expect(item()).toHaveCount(0);
    expect(await storedTemplates(page)).toHaveLength(0);
  });

  test('a monthly template due today lands on the desk; one in another quarter does not', async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem('work-desk-recurring-work')) return;
      const now = new Date();
      localStorage.setItem('work-desk-recurring-work', JSON.stringify({
        templates: [
          { id: 'tpl-due', content: 'Due on this date', rule: 'monthly', monthBy: 'date', monthDays: [now.getDate()], days: null, createdAt: now.toISOString(), lastInjectedDate: null },
          { id: 'tpl-later', content: 'Due next quarter month', rule: 'quarterly', monthBy: 'date', monthDays: [now.getDate()], startMonth: (now.getMonth() + 1) % 3, createdAt: now.toISOString(), lastInjectedDate: null },
        ],
        deletedIds: {},
      }));
    });
    await openDesk(page);
    await expect(page.locator('.item-card', { hasText: 'Due on this date' })).toHaveCount(1);
    await expect(page.locator('.item-card', { hasText: 'Due next quarter month' })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.item-card', { hasText: 'Due on this date' })).toHaveCount(1);
  });

  test('Ctrl+Enter adds a recurring task and saves an edit', async ({ page }) => {
    await openRecurring(page, 'Keyboard template');
    await page.keyboard.press('Control+Enter');
    const item = () => page.locator('.recurring-template-item', { hasText: 'Keyboard' });
    await expect(item()).toHaveCount(1);
    await item().locator('.recurring-action-link', { hasText: 'edit' }).click();
    const editor = page.locator('.recurring-template-item .rich-editor').first();
    await editor.click();
    await editor.press('Control+a');
    await editor.pressSequentially('Keyboard edited', { delay: 10 });
    await editor.press('Control+Enter');
    await expect(page.locator('.recurring-template-item', { hasText: 'Keyboard edited' }).locator('.recurring-rule-badge').first()).toBeVisible();
    expect((await storedTemplates(page))[0].content).toContain('Keyboard edited');
  });
});

test.describe('Ctrl+Enter saves desk edits 1.21.0', { tag: ['@board'] }, () => {
  test('editing a task: Ctrl+Enter saves, Esc still cancels', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Ctrl enter task');
    const card = () => page.locator('.item-card', { hasText: 'Ctrl enter task' }).first();
    await card().locator('.item-content').dblclick();
    const editor = page.locator('.edit-input');
    await expect(editor).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.type(' saved');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.edit-input')).toHaveCount(0);
    await expect(page.locator('.item-card', { hasText: 'Ctrl enter task saved' })).toHaveCount(1);

    await page.locator('.item-card', { hasText: 'Ctrl enter task saved' }).locator('.item-content').dblclick();
    await expect(page.locator('.edit-input')).toBeFocused();
    await page.keyboard.type(' nope');
    await page.keyboard.press('Escape');
    await expect(page.locator('.edit-input')).toHaveCount(0);
    await expect(page.locator('.item-card', { hasText: 'nope' })).toHaveCount(0);
  });

  test('editing a comment: Ctrl+Enter saves it', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Comment ctrl task');
    const card = page.locator('.item-card', { hasText: 'Comment ctrl task' }).first();
    await card.locator('.card-action', { hasText: /^comment/i }).click();
    const trigger = card.locator('.add-comment-trigger');
    if (await trigger.isVisible()) await trigger.click();
    await card.locator('.add-comment-form .comment-input').click();
    await page.keyboard.type('First words');
    await card.locator('.comment-add-btn').click();
    const comment = page.locator('.comment', { hasText: 'First words' });
    await comment.hover();
    await comment.locator('.comment-action-edit').click();
    const editor = page.locator('.comment-edit-wrap .comment-input');
    await expect(editor).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Second words');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.comment-edit-wrap')).toHaveCount(0);
    await expect(page.locator('.comment', { hasText: 'Second words' })).toBeVisible();
  });
});

// ── Insights tab ───────────────────────────────────────────────────────
test.describe('Insights tab', { tag: ['@insights'] }, () => {
  async function seedAndOpenInsights(page: Page) {
    await page.addInitScript(() => {
      const today = new Date();
      const days: Record<string, { items: any[] }> = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        days[key] = {
          items: [
            { id: `task-${i}-1`, type: 'task', content: `Task A day ${i}`, completed: true, shelved: false, boardColumn: 'active', comments: [], createdAt: d.toISOString() },
            { id: `task-${i}-2`, type: 'task', content: `Task B day ${i}`, completed: false, shelved: false, boardColumn: 'new', comments: [], createdAt: d.toISOString() },
            { id: `note-${i}`, type: 'note', content: `Note day ${i}`, comments: [], createdAt: d.toISOString() },
          ],
        };
      }
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    });
    await page.goto('/work-desk.html');
    await dismissAuthModal(page);
    await page.locator('#tab-insights').click();
    await expect(page.locator('#insights-view')).toBeVisible();
  }

  test('clicking the Insights tab shows the insights view', async ({ page }) => {
    await seedAndOpenInsights(page);
    await expect(page.locator('#insights-view')).not.toHaveClass(/hidden/);
  });

  test('insights view shows period selector (Week/Month/Year)', async ({ page }) => {
    await seedAndOpenInsights(page);
    await expect(page.locator('.period-tab', { hasText: 'Week' })).toBeVisible();
    await expect(page.locator('.period-tab', { hasText: 'Month' })).toBeVisible();
    await expect(page.locator('.period-tab', { hasText: 'Year' })).toBeVisible();
  });

  test('insights view renders productivity summary card', async ({ page }) => {
    await seedAndOpenInsights(page);
    await expect(page.locator('.productivity-metrics-card')).toBeVisible();
  });

  test('switching to Month period re-renders insights', async ({ page }) => {
    await seedAndOpenInsights(page);
    await page.locator('.period-tab', { hasText: 'Month' }).click();
    await expect(page.locator('.period-tab.active', { hasText: 'Month' })).toBeVisible();
    await expect(page.locator('.productivity-metrics-card')).toBeVisible();
  });

  test('switching to Year period re-renders insights', async ({ page }) => {
    await seedAndOpenInsights(page);
    await page.locator('.period-tab', { hasText: 'Year' }).click();
    await expect(page.locator('.period-tab.active', { hasText: 'Year' })).toBeVisible();
  });

  test('navigation arrows exist and prev arrow updates the stored anchor', async ({ page }) => {
    await seedAndOpenInsights(page);
    const insightsNav = page.locator('#insights-view .insights-nav');
    await expect(insightsNav.locator('.nav-arrow').first()).toBeVisible();
    await expect(insightsNav.locator('.nav-arrow').last()).toBeVisible();

    const anchorBefore = await page.evaluate(() => localStorage.getItem('work-desk-insights-anchor'));
    await insightsNav.locator('.nav-arrow').first().click();
    const anchorAfter = await page.evaluate(() => localStorage.getItem('work-desk-insights-anchor'));
    expect(anchorAfter).not.toBe(anchorBefore);
  });

  test('insights chart container is rendered', async ({ page }) => {
    await seedAndOpenInsights(page);
    const chart = page.locator('#insights-view').locator('.insight-bars, .line-chart-wrap, .stacked-chart-wrap, .pie-chart-wrap');
    await expect(chart.first()).toBeVisible();
  });

  test('returning to Desk tab hides insights view', async ({ page }) => {
    await seedAndOpenInsights(page);
    await page.locator('.app-tab', { hasText: 'Desk' }).click();
    await expect(page.locator('#insights-view')).toBeHidden();
  });

  test('day-by-day table labels rows with real dates and marks today as "(Today)"', async ({ page }) => {
    await seedAndOpenInsights(page);
    await page.locator('.period-tab', { hasText: 'Month' }).click();
    const firstCells = page.locator('.insight-table tbody tr td:first-child');
    await expect(firstCells.first()).toBeVisible();

    const expectedToday = await page.evaluate(() =>
      new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' (Today)');
    const labels = await firstCells.allTextContents();
    expect(labels).toContain(expectedToday);
    expect(labels).not.toContain('Today');
    expect(labels).not.toContain('Yesterday');
  });
});

// ── Local-date seeding helpers (browser side) ──────────────────────────
function seedWorkDays(page: Page, build: string) {
  // `build` is a function body that receives (localKey, today) and returns a days map
  return page.addInitScript((body) => {
    const localKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const days = new Function('localKey', 'today', body)(localKey, new Date());
    localStorage.setItem('work-desk-list-context', 'work');
    localStorage.setItem('work-desk-data-work', JSON.stringify({ days, deletedIds: {} }));
    localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
  }, build);
}

async function openSettingsBehavior(page: Page) {
  await page.locator('#density-toggle').click();
  await expect(page.locator('#density-popout')).toBeVisible();
  await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
}

// ── Carry-Over Analysis ────────────────────────────────────────────────
test.describe('Carry-Over Analysis', { tag: ['@insights'] }, () => {
  // Left unfinished Wed Mar 5, Wed Sep 10 (x2), and Wed Sep 24, 2025; each lands the next day
  async function openCarryInsights(page: Page, period: 'week' | 'month' | 'year', anchor: string) {
    // Pin "today" so the fixed 2025 dates stay inside the 12-month retention window
    await page.clock.setFixedTime(new Date('2025-12-15T10:00:00'));
    await page.addInitScript(([p, a]) => {
      const carried = (id: string, from: string) => ({
        // Completed so startup auto-carry leaves them where they landed
        id, type: 'task', content: `Carried ${id}`, completed: true, shelved: false,
        boardColumn: 'active', comments: [], createdAt: `${from}T09:00:00Z`, carriedFrom: from,
      });
      const days = {
        '2025-03-06': { items: [carried('m', '2025-03-05')] },
        '2025-09-11': { items: [carried('a', '2025-09-10'), carried('b', '2025-09-10')] },
        '2025-09-25': { items: [carried('c', '2025-09-24')] },
      };
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-insights-period', p);
      localStorage.setItem('work-desk-insights-anchor', a);
    }, [period, anchor]);
    await page.goto('/work-desk.html');
    await dismissAuthModal(page);
    await page.locator('#tab-insights').click();
    await expect(page.locator('.carryover-card')).toBeVisible();
  }

  const row = (page: Page, scope: string, label: string) =>
    page.locator(`${scope} .carryover-day-row`).filter({ has: page.locator('.carryover-day-label', { hasText: new RegExp(`^${label}$`) }) });

  test('Month view shows a by-week trend and the dates behind each weekday', async ({ page }) => {
    await openCarryInsights(page, 'month', '2025-09-15');
    const card = page.locator('.carryover-card');
    await expect(card.locator('.carryover-summary')).toHaveText('3 tasks left unfinished and carried forward this period');

    const trend = card.locator('.carryover-trend[data-carry-trend="week"]');
    await expect(trend.locator('.carryover-subtitle')).toHaveText('Carry-Over by Week');
    await expect(trend.locator('.carryover-day-label')).toHaveText(['Sep 1–7', 'Sep 8–14', 'Sep 15–21', 'Sep 22–28', 'Sep 29–30']);
    await expect(trend.locator('.carryover-day-count')).toHaveText(['0', '2', '0', '1', '0']);

    await expect(row(page, '.carryover-by-day', 'Wed').locator('.carryover-day-count')).toHaveText('3');
    await expect(row(page, '.carryover-by-day', 'Thu').locator('.carryover-day-count')).toHaveText('0');
    await expect(card.locator('.carryover-day-dates[data-weekday="Wed"]')).toHaveText('Sep 10 (2) · Sep 24 (1)');
    await expect(card.locator('.carryover-day-dates')).toHaveCount(1);

    // Dates sit inside their bar's track, and the full list is in the row's tooltip
    const wed = row(page, '.carryover-by-day', 'Wed');
    await expect(wed.locator('.carryover-day-bar .carryover-day-dates')).toHaveCount(1);
    await expect(wed).toHaveAttribute('title', 'Sep 10 (2), Sep 24 (1)');
    const rowBox = (await wed.boundingBox())!;
    const barBox = (await wed.locator('.carryover-day-bar').boundingBox())!;
    const datesBox = (await wed.locator('.carryover-day-dates').boundingBox())!;
    expect(rowBox.height).toBeLessThan(24);
    expect(datesBox.y).toBeGreaterThanOrEqual(barBox.y);
    expect(datesBox.y + datesBox.height).toBeLessThanOrEqual(barBox.y + barBox.height + 0.5);
    expect(datesBox.x + datesBox.width).toBeLessThanOrEqual(barBox.x + barBox.width);

    // Wed holds every carry-over (100% fill), so its dates go inside the fill
    await expect(wed.locator('.carryover-day-dates')).toHaveClass(/inside/);

    // Weekday bars stretch to the same width as the by-week bars
    const weekBar = (await trend.locator('.carryover-day-bar').first().boundingBox())!;
    const monBar = (await row(page, '.carryover-by-day', 'Mon').locator('.carryover-day-bar').boundingBox())!;
    expect(Math.abs(monBar.x - weekBar.x)).toBeLessThan(1);
    expect(Math.abs(monBar.width - weekBar.width)).toBeLessThan(1);
    expect(Math.abs(barBox.width - weekBar.width)).toBeLessThan(1);
  });

  test('Year view shows a 12-month trend and dates across the year', async ({ page }) => {
    await openCarryInsights(page, 'year', '2025-06-01');
    const card = page.locator('.carryover-card');
    await expect(card.locator('.carryover-summary')).toContainText('4 tasks');
    const trend = card.locator('.carryover-trend[data-carry-trend="month"]');
    await expect(trend.locator('.carryover-subtitle')).toHaveText('Carry-Over by Month');
    await expect(trend.locator('.carryover-day-row')).toHaveCount(12);
    await expect(row(page, '.carryover-trend', 'Mar').locator('.carryover-day-count')).toHaveText('1');
    await expect(row(page, '.carryover-trend', 'Sep').locator('.carryover-day-count')).toHaveText('3');
    await expect(card.locator('.carryover-day-dates[data-weekday="Wed"]')).toHaveText('Mar 5 (1) · Sep 10 (2) · Sep 24 (1)');
  });

  test('Week view keeps the weekday chart only (no trend, no date lists)', async ({ page }) => {
    await openCarryInsights(page, 'week', '2025-09-10');
    const card = page.locator('.carryover-card');
    await expect(card.locator('.carryover-trend')).toHaveCount(0);
    await expect(card.locator('.carryover-day-dates')).toHaveCount(0);
    await expect(row(page, '.carryover-by-day', 'Wed').locator('.carryover-day-count')).toHaveText('2');
  });

  test('period arrows re-render the card: hidden for a month with no carry-overs, back on return', async ({ page }) => {
    await openCarryInsights(page, 'month', '2025-09-15');
    const nav = page.locator('#insights-view .insights-nav');
    await nav.locator('.nav-arrow').first().click();
    await expect(nav.locator('.insights-nav-label')).toHaveText('August 2025');
    await expect(page.locator('.carryover-card')).toHaveCount(0);
    await nav.locator('.nav-arrow').last().click();
    await expect(nav.locator('.insights-nav-label')).toHaveText('September 2025');
    await expect(page.locator('.carryover-trend .carryover-day-row')).toHaveCount(5);
  });
});

async function readStreaks(page: Page) {
  await page.locator('#tab-insights').click();
  const values = page.locator('.streak-card .streak-value');
  await expect(values.first()).toBeVisible();
  const [current, longest] = (await values.allTextContents()).map(Number);
  await page.locator('#tab-desk').click();
  return { current, longest };
}

// ── Streaks: weekend handling ──────────────────────────────────────────
test.describe('Streak weekend handling', { tag: ['@insights'] }, () => {
  // Weekdays only across the last 11 calendar days (always spans at least one weekend)
  const WEEKDAYS_ONLY = `
    const days = {};
    for (let i = 0; i <= 10; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const key = localKey(d);
      days[key] = { date: key, items: [{ id: 'streak-' + i, type: 'task', content: 'Streak ' + i, completed: true, shelved: false, boardColumn: 'active', createdAt: d.toISOString() }] };
    }
    return days;
  `;

  test('toggle is on by default in Behavior settings', async ({ page }) => {
    await openDesk(page);
    await openSettingsBehavior(page);
    await expect(page.locator('#streak-skip-weekends-toggle')).toBeChecked();
  });

  test('with the toggle on, an idle weekend does not break the streak; turning it off does', async ({ page }) => {
    await seedWorkDays(page, WEEKDAYS_ONLY);
    await page.goto(DESK_URL);
    await dismissAuthModal(page);

    const on = await readStreaks(page);
    expect(on.current).toBeGreaterThanOrEqual(6);
    expect(on.longest).toBe(on.current);

    await openSettingsBehavior(page);
    await openOptionsSectionFor(page, '#streak-skip-weekends-toggle');
    await page.locator('#streak-skip-weekends-toggle').click();
    await expect(page.locator('#streak-skip-weekends-toggle')).not.toBeChecked();

    const off = await readStreaks(page);
    expect(off.longest).toBeLessThanOrEqual(5);
    expect(off.longest).toBeLessThan(on.longest);
  });

  test('toggle choice persists across reload', async ({ page }) => {
    await openDesk(page);
    await openSettingsBehavior(page);
    await openOptionsSectionFor(page, '#streak-skip-weekends-toggle');
    await page.locator('#streak-skip-weekends-toggle').click();
    expect(await page.evaluate(() => localStorage.getItem('work-desk-streak-skip-weekends'))).toBe('false');

    await page.reload();
    await dismissAuthModal(page);
    await openSettingsBehavior(page);
    await expect(page.locator('#streak-skip-weekends-toggle')).not.toBeChecked();
  });
});

// ── Desk vs Projects separation ────────────────────────────────────────
test.describe('Desk vs Projects separation', { tag: ['@projects'] }, () => {
  async function createProject(page: Page, name: string) {
    page.once('dialog', dialog => dialog.accept(name));
    await page.locator('#new-project-btn').click();
    await expect(page.locator('#project-title')).toHaveText(name);
  }

  test('switching to Projects hides the daily desk and shows the projects view', async ({ page }) => {
    await openDesk(page);
    await page.locator('#tab-projects').click();
    await expect(page.locator('#desk-view')).toBeHidden();
    await expect(page.locator('#add-form')).toBeHidden();
    await expect(page.locator('#date-title')).toBeHidden();
    await expect(page.locator('#projects-view')).toBeVisible();
  });

  test('clicking between projects keeps the daily desk hidden', async ({ page }) => {
    await openDesk(page);
    await page.locator('#tab-projects').click();
    await createProject(page, 'Separation Alpha');
    await createProject(page, 'Separation Beta');

    for (const name of ['Separation Alpha', 'Separation Beta', 'Separation Alpha']) {
      await page.locator('.project-list-item', { hasText: name }).click();
      await expect(page.locator('#project-title')).toHaveText(name);
      await expect(page.locator('#desk-view')).toBeHidden();
    }
  });

  test('returning to Work from Projects shows the desk again', async ({ page }) => {
    await openDesk(page);
    await page.locator('#tab-projects').click();
    await expect(page.locator('#desk-view')).toBeHidden();
    await page.locator('#tab-work').click();
    await expect(page.locator('#desk-view')).toBeVisible();
    await expect(page.locator('#projects-view')).toBeHidden();
  });

  test('Insights hides the desk and the projects view', async ({ page }) => {
    await openDesk(page);
    await page.locator('#tab-insights').click();
    await expect(page.locator('#desk-view')).toBeHidden();
    await expect(page.locator('#projects-view')).toBeHidden();
    await expect(page.locator('#insights-view')).toBeVisible();
  });
});

// ── Project lifecycle ──────────────────────────────────────────────────
test.describe('Project lifecycle', { tag: ['@projects'] }, () => {
  async function openProjects(page: Page, name: string) {
    await openDesk(page);
    await page.locator('#tab-projects').click();
    page.once('dialog', dialog => dialog.accept(name));
    await page.locator('#new-project-btn').click();
    await expect(page.locator('#project-title')).toHaveText(name);
  }

  test('empty state prompts to select or create a project', async ({ page }) => {
    await openDesk(page);
    await page.locator('#tab-projects').click();
    await expect(page.locator('#project-empty')).toBeVisible();
    await expect(page.locator('.project-list-empty')).toHaveText('No projects yet');
  });

  test('rename updates the title and the sidebar list', async ({ page }) => {
    await openProjects(page, 'Before Rename');
    page.once('dialog', dialog => dialog.accept('After Rename'));
    await page.locator('#project-rename-btn').click();
    await expect(page.locator('#project-title')).toHaveText('After Rename');
    await expect(page.locator('.project-list-item', { hasText: 'After Rename' })).toBeVisible();
    await expect(page.locator('.project-list-item', { hasText: 'Before Rename' })).toHaveCount(0);
  });

  test('dismissing the delete confirm keeps the project', async ({ page }) => {
    await openProjects(page, 'Keep Me');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#project-delete-btn').click();
    await expect(page.locator('#project-title')).toHaveText('Keep Me');
  });

  test('confirming delete removes the project and returns to the empty state', async ({ page }) => {
    await openProjects(page, 'Delete Me');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#project-delete-btn').click();
    await expect(page.locator('.project-list-item', { hasText: 'Delete Me' })).toHaveCount(0);
    await expect(page.locator('#project-empty')).toBeVisible();
  });

  test('adding a project note shows it in the Notes tab and updates the sidebar count', async ({ page }) => {
    await openProjects(page, 'Notes Project');
    await page.locator('#project-add-note-btn').click();
    const editor = page.locator('#project-notes-list .project-item-editor');
    await editor.click();
    await editor.pressSequentially('A project note', { delay: 15 });
    await page.locator('#project-notes-list button', { hasText: 'Save' }).click();

    await expect(page.locator('#project-notes-list .project-item-card', { hasText: 'A project note' })).toBeVisible();
    await expect(page.locator('.project-list-item', { hasText: 'Notes Project' })).toContainText('1 note');
  });

  test('Notes and Tasks tabs switch panes', async ({ page }) => {
    await openProjects(page, 'Tabs Project');
    await page.locator('.project-tab-btn[data-project-tab="tasks"]').click();
    await expect(page.locator('#project-pane-tasks')).toBeVisible();
    await expect(page.locator('#project-pane-notes')).toBeHidden();
    await page.locator('.project-tab-btn[data-project-tab="notes"]').click();
    await expect(page.locator('#project-pane-notes')).toBeVisible();
  });

  test('projects persist across reload', async ({ page }) => {
    await openProjects(page, 'Persistent Project');
    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('.project-list-item', { hasText: 'Persistent Project' })).toBeVisible();
  });
});

// ── Work / Personal contexts ───────────────────────────────────────────
test.describe('Work / Personal contexts', { tag: ['@sidebar'] }, () => {
  test('tasks stay in their own context and the badge follows the tab', async ({ page }) => {
    await openDesk(page);
    await addTask(page, 'Work-only task');
    await expect(page.locator('#context-badge')).toHaveText('Work');

    await page.locator('#tab-personal').click();
    await expect(page.locator('#context-badge')).toHaveText('Personal');
    await expect(page.locator('.item-card', { hasText: 'Work-only task' })).toHaveCount(0);

    await addTask(page, 'Personal-only task');
    await page.locator('#tab-work').click();
    await expect(page.locator('.item-card', { hasText: 'Work-only task' })).toBeVisible();
    await expect(page.locator('.item-card', { hasText: 'Personal-only task' })).toHaveCount(0);
  });
});

// ── Day navigation & notes ─────────────────────────────────────────────
test.describe('Day navigation', { tag: ['@calendar'] }, () => {
  test('next arrow leaves today and "Back to today" returns', async ({ page }) => {
    await openDesk(page);
    const todayTitle = await page.locator('#date-title').textContent();
    await expect(page.locator('#header-today-btn')).toBeHidden();

    await page.locator('#next-day').click();
    await expect(page.locator('#date-title')).not.toHaveText(todayTitle || '');
    await expect(page.locator('#header-today-btn')).toBeVisible();

    await page.locator('#header-today-btn').click();
    await expect(page.locator('#date-title')).toHaveText(todayTitle || '');
    await expect(page.locator('#header-today-btn')).toBeHidden();
  });

  test('prev arrow moves back one day', async ({ page }) => {
    await openDesk(page);
    const expected = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    });
    await page.locator('#prev-day').click();
    await expect(page.locator('#date-title')).toHaveText(expected);
  });
});

test.describe('Notes on the desk', { tag: ['@board'] }, () => {
  test('Note type adds a note item, not a task', async ({ page }) => {
    await openDesk(page);
    await page.locator('.type-btn[data-type="note"]').click();
    await expect(page.locator('.type-btn[data-type="note"]')).toHaveClass(/active/);
    await addTask(page, 'Desk note entry');

    const types = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('work-desk-data-work') || '{}');
      return Object.values<any>(data.days || {}).flatMap((d: any) => d.items)
        .filter((i: any) => i.content.includes('Desk note entry')).map((i: any) => i.type);
    });
    expect(types).toEqual(['note']);
  });
});

// ── Carry forward ──────────────────────────────────────────────────────
test.describe('Carry forward', { tag: ['@board'] }, () => {
  test('button moves yesterday\'s unfinished task to today and stamps carriedFrom', async ({ page }) => {
    await seedWorkDays(page, `
      const y = new Date(today); y.setDate(y.getDate() - 1);
      const key = localKey(y);
      return { [key]: { date: key, items: [
        { id: 'carry-me', type: 'task', content: 'Carry me forward', completed: false, shelved: false, boardColumn: 'active', createdAt: y.toISOString() },
        { id: 'done-stays', type: 'task', content: 'Done stays put', completed: true, shelved: false, boardColumn: 'active', createdAt: y.toISOString() },
      ] } };
    `);
    await page.goto(DESK_URL);
    await dismissAuthModal(page);

    await expect(page.locator('#carry-forward-btn')).toBeVisible();
    await page.locator('#carry-forward-btn').click();
    await expect(page.locator('.item-card', { hasText: 'Carry me forward' })).toBeVisible();

    const result = await page.evaluate(() => {
      const d = new Date();
      const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      const y = new Date(d); y.setDate(y.getDate() - 1);
      const data = JSON.parse(localStorage.getItem('work-desk-data-work') || '{}');
      const todayItems = data.days[key(d)]?.items || [];
      const yItems = data.days[key(y)]?.items || [];
      return {
        carried: todayItems.find((i: any) => i.id === 'carry-me')?.carriedFrom,
        yesterdayKey: key(y),
        leftBehind: yItems.map((i: any) => i.id),
      };
    });
    expect(result.carried).toBe(result.yesterdayKey);
    expect(result.leftBehind).toEqual(['done-stays']);
  });
});

test.describe('Auto carry toggle', { tag: ['@board', '@options'] }, () => {
  const YESTERDAY_UNFINISHED = `
    const y = new Date(today); y.setDate(y.getDate() - 1);
    const key = localKey(y);
    return { [key]: { date: key, items: [
      { id: 'left-open', type: 'task', content: 'Left open yesterday', completed: false, shelved: false, boardColumn: 'active', createdAt: y.toISOString() },
    ] } };
  `;

  async function itemLocation(page: Page) {
    return page.evaluate(() => {
      const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      const t = new Date();
      const y = new Date(); y.setDate(y.getDate() - 1);
      const data = JSON.parse(localStorage.getItem('work-desk-data-work') || '{}');
      const has = (k: string) => (data.days[k]?.items || []).some((i: any) => i.id === 'left-open');
      return { onToday: has(key(t)), onYesterday: has(key(y)) };
    });
  }

  test('with Auto carry off, yesterday\'s unfinished tasks stay put and the manual button is offered', async ({ page }) => {
    await seedWorkDays(page, YESTERDAY_UNFINISHED);
    await page.addInitScript(() => localStorage.setItem('work-desk-auto-carry-forward', 'false'));
    await page.goto(DESK_URL);
    await dismissAuthModal(page);

    await expect(page.locator('#carry-forward-btn')).toBeVisible();
    await expect(page.locator('.item-card', { hasText: 'Left open yesterday' })).toHaveCount(0);
    expect(await itemLocation(page)).toEqual({ onToday: false, onYesterday: true });

    await page.reload();
    await dismissAuthModal(page);
    expect(await itemLocation(page)).toEqual({ onToday: false, onYesterday: true });
  });

  test('with Auto carry on, yesterday\'s unfinished tasks move to today on load', async ({ page }) => {
    await seedWorkDays(page, YESTERDAY_UNFINISHED);
    await page.addInitScript(() => localStorage.setItem('work-desk-auto-carry-forward', 'true'));
    await page.goto(DESK_URL);
    await dismissAuthModal(page);

    await expect(page.locator('.item-card', { hasText: 'Left open yesterday' })).toBeVisible();
    expect(await itemLocation(page)).toEqual({ onToday: true, onYesterday: false });
  });

  test('turning Auto carry off in Behavior settings persists', async ({ page }) => {
    await openDesk(page);
    await openSettingsBehavior(page);
    await openOptionsSectionFor(page, '#auto-carry-toggle-popout');
    const toggle = page.locator('#auto-carry-toggle-popout');
    if (!(await toggle.isChecked())) await toggle.click();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('work-desk-auto-carry-forward'))).toBe('false');
  });
});

// ── Character encoding ─────────────────────────────────────────────────
test.describe('Rendered text has no mojibake', { tag: ['@docs'] }, () => {
  const MOJIBAKE = /â€|â†|Ã[\u0080-\u00BF\u0152-\u2122]|Â[\u00A0-\u00BF]|ðŸ|ï¸|\uFFFD/;

  async function expectClean(page: Page, selector: string) {
    const text = await page.locator(selector).innerText();
    const m = text.match(MOJIBAKE);
    expect(m, m ? `${selector}: …${text.slice(Math.max(0, m.index! - 30), m.index! + 30)}…` : '').toBeNull();
  }

  test('What\'s New, Help, Options, and the desk render real characters', async ({ page }) => {
    await openDesk(page);
    await expectClean(page, 'body');

    await openAccountMenu(page);
    await expectClean(page, '#account-menu');
    await page.locator('#version-btn').click();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    await expect(page.locator('#changelog-body')).toContainText('Rosé Pine Dawn');
    await expect(page.locator('#changelog-body')).toContainText('Options → Appearance → Card layout');
    await expect(page.locator('#changelog-body')).toContainText('Back is now just ‹ Back');
    await expectClean(page, '#changelog-body');
    await page.locator('#changelog-modal-dismiss').click();

    await page.locator('#help-btn').click();
    await expect(page.locator('#help-modal')).toBeVisible();
    await expect(page.locator('#help-modal')).toContainText('→');
    await expect(page.locator('#help-modal')).toContainText('Sep 9 (2) · Sep 23 (1)');
    await expectClean(page, '#help-modal');
    await page.locator('#help-modal-close').click();

    await page.locator('#density-toggle').click();
    for (const tab of ['themes', 'appearance', 'behavior']) {
      await page.locator(`.options-nav-btn[data-options-tab="${tab}"]`).click();
      await expectClean(page, '#density-popout');
    }
    await page.locator('.options-nav-btn[data-options-tab="themes"]').click();
    for (const tier of ['light', 'medium', 'dark']) {
      await page.locator(`.theme-filter-btn[data-theme-filter="${tier}"]`).click();
      await expectClean(page, '#customize-theme-grid');
    }
    await expect(page.locator('#customize-theme-grid')).toContainText('Rosé Pine');
  });
});

// ── Help & What's New modals ───────────────────────────────────────────
test.describe('Help and What\'s New modals', { tag: ['@docs'] }, () => {
  test('help button opens the help modal and the close button dismisses it', async ({ page }) => {
    await openDesk(page);
    await page.locator('#help-btn').click();
    await expect(page.locator('#help-modal')).toBeVisible();
    await expect(page.locator('#help-modal')).toContainText('Weekends don\'t break streaks');
    await page.locator('#help-modal-close').click();
    await expect(page.locator('#help-modal')).toBeHidden();
  });

  test('clicking the help backdrop closes it', async ({ page }) => {
    await openDesk(page);
    await page.locator('#help-btn').click();
    await page.locator('#help-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#help-modal')).toBeHidden();
  });

  test('version button opens What\'s New for the current version and marks it seen', async ({ page }) => {
    await openDesk(page);
    const label = (await page.locator('#version-btn').textContent())?.trim() || '';
    expect(label).toMatch(/^v\d+\.\d+\.\d+$/);

    await openAccountMenu(page);
    await page.locator('#version-btn').click();
    await expect(page.locator('#account-menu')).toBeHidden();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    await expect(page.locator('#changelog-body')).toContainText(label.slice(1));

    await page.locator('#changelog-modal-dismiss').click();
    await expect(page.locator('#changelog-modal')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('work-desk-last-seen-version'))).toBe(label.slice(1));
    await expect(page.locator('#whats-new-link')).toBeHidden();
    await expect(page.locator('#version-new-dot')).toBeHidden();
  });
});

// ── What's new link + version footer (1.13.2) ──────────────────────────
test.describe('What\'s new link and version footer (1.13.2)', { tag: ['@docs', '@sidebar'] }, () => {
  const headerHeight = (page: Page) =>
    page.evaluate(() => Math.round(document.querySelector('.sidebar-header')!.getBoundingClientRect().height));
  const box = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())!;

  test('unseen update: link sits under the subtitle; opening keeps it, closing removes it and restores the header height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page);
    const link = page.locator('#whats-new-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveText("What's new");
    await expect(page.locator('#version-new-dot')).toBeVisible();
    const sub = await box(page, '#logo-sub');
    const linkBox = await box(page, '#whats-new-link');
    expect(linkBox.y).toBeGreaterThanOrEqual(sub.y + sub.height - 1);
    expect(Math.abs(linkBox.x - sub.x)).toBeLessThan(2);
    await expect(page.locator('#logo-sub #version-btn')).toHaveCount(0);
    const tallHeader = await headerHeight(page);

    await link.click();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    await expect(link).toBeVisible();

    await page.locator('#changelog-modal-close').click();
    await expect(page.locator('#changelog-modal')).toBeHidden();
    await expect(link).toBeHidden();
    const normalHeader = await headerHeight(page);
    expect(normalHeader).toBeLessThan(tallHeader);
    expect(normalHeader).toBe(50);
    await expect(page.locator('#sidebar-today-glance')).toBeVisible();

    await page.reload();
    await dismissAuthModal(page);
    await expect(link).toBeHidden();
    expect(await headerHeight(page)).toBe(normalHeader);
  });

  for (const how of ['Got it', 'backdrop', 'Escape'] as const) {
    test(`closing the changelog with ${how} also removes the link`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await seedLayout(page);
      await page.locator('#whats-new-link').click();
      await expect(page.locator('#changelog-modal')).toBeVisible();
      if (how === 'Got it') await page.locator('#changelog-modal-dismiss').click();
      else if (how === 'backdrop') await page.locator('#changelog-modal').click({ position: { x: 5, y: 5 } });
      else await page.keyboard.press('Escape');
      await expect(page.locator('#changelog-modal')).toBeHidden();
      await expect(page.locator('#whats-new-link')).toBeHidden();
    });
  }

  test('version button sits at the bottom of the account menu and opens the changelog any time', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page);
    const ver = page.locator('#account-menu > .sidebar-version > #version-btn');
    await expect(ver).toBeHidden();
    await openAccountMenu(page);
    await expect(ver).toBeVisible();
    await expect(ver).toHaveText(/^v\d+\.\d+\.\d+$/);
    const verBox = await box(page, '#version-btn');
    const signIn = await box(page, '#sb-signin-btn');
    expect(verBox.y).toBeGreaterThanOrEqual(signIn.y + signIn.height - 1);
    const menu = await box(page, '#account-menu');
    const btn = await box(page, '#account-menu-btn');
    expect(menu.y + menu.height).toBeLessThanOrEqual(btn.y);

    // Version click while the link is showing: closing still clears the link
    await ver.click();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    await page.locator('#changelog-modal-dismiss').click();
    await expect(page.locator('#whats-new-link')).toBeHidden();

    // Already seen: it still opens the changelog, link never comes back
    await openAccountMenu(page);
    await ver.click();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    await expect(page.locator('#changelog-body')).toContainText((await ver.textContent())!.slice(1));
    await page.locator('#changelog-modal-close').click();
    await expect(page.locator('#whats-new-link')).toBeHidden();
  });

  test('when the current version was already seen, no link shows and the header is normal height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page);
    const version = (await page.locator('#version-btn').textContent())!.slice(1);
    await page.evaluate((v) => localStorage.setItem('work-desk-last-seen-version', v), version);
    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('#whats-new-link')).toBeHidden();
    expect(await headerHeight(page)).toBe(50);
    await expect(page.locator('#account-menu-btn-dot')).toBeHidden();
    await openAccountMenu(page);
    await expect(page.locator('#version-btn')).toBeVisible();
    await expect(page.locator('#account-menu-new-dot')).toBeHidden();
  });

  test('collapsed sidebar hides both; expanding brings them back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page);
    await page.locator('#sidebar-toggle').click();
    await expect.poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBe(0);
    await expect(page.locator('#whats-new-link')).not.toBeInViewport();
    await expect(page.locator('#account-menu-btn')).not.toBeInViewport();
    await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#whats-new-link')).toBeInViewport();
    await expect(page.locator('#account-menu-btn')).toBeInViewport();
    await page.locator('#whats-new-link').click();
    await expect(page.locator('#changelog-modal')).toBeVisible();
  });

  test('phone: link and footer stay hidden; the menu dot clears after closing What\'s new', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLayout(page);
    await expect(page.locator('#whats-new-link')).toBeHidden();
    await expect(page.locator('.sidebar-version')).toBeHidden();
    await page.locator('#mobile-menu-btn').click();
    await expect(page.locator('#mobile-menu-new-dot')).toBeVisible();
    await page.locator('#mobile-menu-whatsnew').click();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    await page.locator('#changelog-modal-dismiss').click();
    await page.locator('#mobile-menu-btn').click();
    await expect(page.locator('#mobile-menu-sheet')).toBeVisible();
    await expect(page.locator('#mobile-menu-new-dot')).toBeHidden();
    await expect(page.locator('#whats-new-link')).toBeHidden();
  });
});

// ── Insights 1.15.0 additions ──────────────────────────────────────────
// Fixed "today" of Tue Oct 6, 2026 (week Mon Oct 5 – Sun Oct 11)
test.describe('Insights 1.15.0 additions', { tag: ['@insights'] }, () => {
  async function openInsights(page: Page, period: 'week' | 'month' | 'year' = 'week', anchor = '2026-10-06') {
    await page.clock.setFixedTime(new Date('2026-10-06T10:00:00'));
    await page.addInitScript(([p, a]) => {
      if (localStorage.getItem('qol-seeded')) return;
      localStorage.setItem('qol-seeded', '1');
      const t = (id: string, content: string, extra: Record<string, unknown> = {}) => ({
        id, type: 'task', content, completed: false, shelved: false, boardColumn: 'new',
        comments: [], tags: [], createdAt: '2026-10-06T09:00:00', ...extra,
      });
      const days: Record<string, { date: string; items: any[] }> = {
        '2026-09-02': { date: '2026-09-02', items: [t('sep1', 'Early September win', { completed: true, createdAt: '2026-09-02T09:00:00' })] },
        '2026-09-14': { date: '2026-09-14', items: [t('s-old', 'Old cache spike', { shelved: true, tags: ['ids'], createdAt: '2026-09-14T09:00:00' })] },
        '2026-10-01': { date: '2026-10-01', items: [
          t('d1', 'Renew vendor contract', { completed: true, tags: ['ace'] }),
          t('d2', 'Review IDS batching', { completed: true, tags: ['ids'] }),
          t('s1', 'Draft Postgres migration plan', { shelved: true, tags: ['ace', 'postgres'], createdAt: '2026-10-01T09:00:00' }),
        ] },
        '2026-10-02': { date: '2026-10-02', items: Array.from({ length: 8 }, (_, i) =>
          t(`tg${i}`, `Tagged ${i}`, { completed: true, tags: [`tag${i}`] })) },
        '2026-10-03': { date: '2026-10-03', items: Array.from({ length: 8 }, (_, i) =>
          t(`sh${i}`, `Parked ${i}`, { shelved: true, createdAt: '2026-10-03T09:00:00' })) },
        '2026-10-05': { date: '2026-10-05', items: [
          t('s2', 'Look into flaky test', { shelved: true, createdAt: '2026-10-05T09:00:00' }),
          t('d3', 'Send sprint notes', { completed: true }),
        ] },
        '2026-10-06': { date: '2026-10-06', items: [
          t('o1', 'Follow up on silver layer', { tags: ['databricks'], carriedFrom: '2026-10-05', createdAt: '2026-09-17T09:00:00' }),
          t('o2', 'Write KT notes', { boardColumn: 'active', carriedFrom: '2026-10-05', createdAt: '2026-09-28T09:00:00' }),
          t('d4', 'Standup', { completed: true, tags: ['ace'] }),
        ] },
      };
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-auto-carry-forward', 'false');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-insights-period', p);
      localStorage.setItem('work-desk-insights-anchor', a);
    }, [period, anchor]);
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await page.locator('#tab-insights').click();
    await expect(page.locator('#insights-view')).toBeVisible();
  }

  const expectDeskOn = async (page: Page, title: string, key: string) => {
    await expect(page.locator('#insights-view')).toBeHidden();
    await expect(page.locator('#date-title')).toHaveText(title);
    expect(await page.evaluate(() => localStorage.getItem('work-desk-selected-date'))).toBe(key);
  };
  const workDay = (page: Page, key: string) =>
    page.evaluate((k) => JSON.parse(localStorage.getItem('work-desk-data-work')!).days[k]?.items ?? null, key);

  test('clicking a Day-by-day row opens that day on the desk', async ({ page }) => {
    await openInsights(page, 'month');
    await page.locator('.insight-table .insight-day-link[data-open-day="2026-10-01"]').click();
    await expectDeskOn(page, 'Thursday, October 1, 2026', '2026-10-01');
    await expect(page.locator('#item-d1')).toBeVisible();
  });

  test('clicking a breakdown bar opens that day; Enter on a focused bar does too', async ({ page }) => {
    await openInsights(page, 'week');
    const bar = page.locator('.insight-bar-row[data-open-day="2026-10-05"]');
    await expect(bar).toHaveAttribute('role', 'button');
    await bar.click();
    await expectDeskOn(page, 'Monday, October 5, 2026', '2026-10-05');

    await page.locator('#tab-insights').click();
    await page.locator('.insight-bar-row[data-open-day="2026-10-06"]').focus();
    await page.keyboard.press('Enter');
    await expectDeskOn(page, 'Tuesday, October 6, 2026', '2026-10-06');
  });

  test('clicking a streak-strip square opens that day', async ({ page }) => {
    await openInsights(page, 'month');
    await page.locator('.streak-heatmap .heatmap-cell[data-open-day="2026-10-03"]').click();
    await expectDeskOn(page, 'Saturday, October 3, 2026', '2026-10-03');
  });

  test('Year view: a month bar opens that month in Insights, and a heatmap square opens the day', async ({ page }) => {
    await openInsights(page, 'year');
    await page.locator('.insight-bar-row[data-open-month="2026-09-01"]').click();
    await expect(page.locator('#insights-view')).toBeVisible();
    await expect(page.locator('.period-tab.active')).toHaveText('Month');
    await expect(page.locator('.insights-nav-label')).toHaveText('September 2026');
    expect(await page.evaluate(() => localStorage.getItem('work-desk-insights-period'))).toBe('month');

    await page.locator('.period-tab', { hasText: 'Year' }).click();
    await page.locator('.heatmap-wrap .heatmap-cell[data-open-day="2026-09-14"]').click();
    await expectDeskOn(page, 'Monday, September 14, 2026', '2026-09-14');
    await expect(page.locator('.heatmap-wrap .heatmap-cell.out-of-range[data-open-day]')).toHaveCount(0);
  });

  test('"This week" appears only away from the current week and returns to it, even from an empty week', async ({ page }) => {
    await openInsights(page, 'week');
    const btn = page.locator('.insights-current-btn');
    await expect(btn).toHaveCount(0);
    const label = page.locator('.insights-nav-label');
    const current = await label.textContent();

    for (let i = 0; i < 6; i++) await page.locator('.insights-nav .nav-arrow').first().click();
    await expect(page.locator('.insight-empty')).toBeVisible();
    await expect(btn).toHaveText('This week');
    await btn.click();
    await expect(page.locator('#insights-view')).toBeVisible();
    await expect(label).toHaveText(current!);
    await expect(btn).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('work-desk-insights-anchor'))).toBe('2026-10-06');

    await page.locator('.insights-nav .nav-arrow').last().click();
    await btn.click();
    await expect(label).toHaveText(current!);
  });

  test('"This month" and "This year" follow the period', async ({ page }) => {
    await openInsights(page, 'month');
    await page.locator('.insights-nav .nav-arrow').first().click();
    await expect(page.locator('.insights-current-btn')).toHaveText('This month');
    await page.locator('.insights-current-btn').click();
    await expect(page.locator('.insights-nav-label')).toHaveText('October 2026');
    await page.locator('.period-tab', { hasText: 'Year' }).click();
    await page.locator('.insights-nav .nav-arrow').first().click();
    await expect(page.locator('.insights-current-btn')).toHaveText('This year');
    await page.locator('.insights-current-btn').click();
    await expect(page.locator('.insights-nav-label')).toHaveText('2026');
  });

  test('comparison card: Week, Month to date, a finished Month, and Year', async ({ page }) => {
    await openInsights(page, 'week');
    await expect(page.locator('.comparison-card[data-comparison="week"] .comparison-title')).toHaveText('Week-over-Week');
    await expect(page.locator('.comparison-card .comparison-hint')).toHaveCount(0);

    await page.locator('.period-tab', { hasText: 'Month' }).click();
    const month = page.locator('.comparison-card[data-comparison="month"]');
    await expect(month.locator('.comparison-title')).toHaveText('Month-over-Month');
    await expect(month.locator('.comparison-hint')).toHaveText('So far this month, compared with Sep 1 – Sep 6');
    await expect(month.locator('.comparison-row').first().locator('.comp-current')).toHaveText('12');
    await expect(month.locator('.comparison-row').first().locator('.comp-previous')).toHaveText('(1 by this point last month)');
    await expect(month.locator('.comparison-row').first().locator('.change-good')).toHaveText('+11 ↑');

    await page.locator('.insights-nav .nav-arrow').first().click();
    const sept = page.locator('.comparison-card[data-comparison="month"]');
    await expect(sept.locator('.comparison-hint')).toHaveCount(0);
    await expect(sept.locator('.comparison-row').first().locator('.comp-previous')).toHaveText('(0 last month)');

    await page.locator('.period-tab', { hasText: 'Year' }).click();
    await expect(page.locator('.comparison-card[data-comparison="year"] .comparison-title')).toHaveText('Year-over-Year');
  });

  test('Tasks by Tag: counts per tag, No tag row, and Show all / Show fewer keep Insights open', async ({ page }) => {
    await openInsights(page, 'month');
    const card = page.locator('.tags-card');
    await expect(card.locator('.insight-card-title')).toHaveText('Tasks by Tag');
    const rows = card.locator('.tag-breakdown-row');
    await expect(rows).toHaveCount(9);
    await expect(rows.first()).toHaveAttribute('data-tag', 'ace');
    await expect(rows.first().locator('.tag-breakdown-counts')).toHaveText('2 done · 0 open · 1 shelved');
    await expect(card.locator('.tag-breakdown-row[data-tag=""] .tag-breakdown-name')).toHaveText('No tag');
    await expect(card.locator('.tag-breakdown-row[data-tag="databricks"] .tag-breakdown-counts')).toHaveText('0 done · 1 open · 1 carried');

    const toggle = card.locator('.insight-show-all');
    await expect(toggle).toHaveText('Show all (12)');
    await toggle.click();
    await expect(page.locator('#insights-view')).toBeVisible();
    await expect(page.locator('.tags-card .tag-breakdown-row')).toHaveCount(13);
    await expect(page.locator('.tags-card .insight-show-all')).toHaveText('Show fewer');
    await expect(page.locator('.tags-card .insight-show-all')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.tags-card .insight-show-all').click();
    await expect(page.locator('.tags-card .tag-breakdown-row')).toHaveCount(9);
  });

  test('Tasks by Tag hides the Show all link when there are 8 tags or fewer', async ({ page }) => {
    await openInsights(page, 'week');
    await expect(page.locator('.tags-card .tag-breakdown-row[data-tag="ace"]')).toBeVisible();
    await expect(page.locator('.tags-card .insight-show-all')).toHaveCount(0);
  });

  test('Lingering Tasks lists the oldest open tasks and Open jumps to the highlighted card', async ({ page }) => {
    await openInsights(page, 'week');
    const card = page.locator('.lingering-card');
    const rows = card.locator('.insight-task-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute('data-item-id', 'o1');
    await expect(rows.first().locator('.insight-task-meta')).toHaveText('Open 19 days · created Sep 17 · last carried from Oct 5');
    await expect(rows.nth(1).locator('.insight-task-text')).toHaveText('Write KT notes');
    await rows.first().locator('.insight-task-btn.open').click();
    await expectDeskOn(page, 'Tuesday, October 6, 2026', '2026-10-06');
    await expect(page.locator('#item-o1')).toHaveClass(/search-highlight/);
  });

  test('Lingering Tasks ignores the period; Shelved Review hides when the period has no shelved tasks', async ({ page }) => {
    await openInsights(page, 'week', '2026-09-02');
    await expect(page.locator('.lingering-card .insight-task-row')).toHaveCount(2);
    await expect(page.locator('.shelved-card')).toHaveCount(0);
  });

  test('Shelved Review: list, Show all, footer, and Open', async ({ page }) => {
    await openInsights(page, 'month');
    const card = page.locator('.shelved-card');
    await expect(card.locator('.carryover-hint')).toHaveText('10 shelved tasks sitting on days in this period');
    await expect(card.locator('.insight-task-row')).toHaveCount(8);
    await expect(card.locator('.insight-task-row').first()).toHaveAttribute('data-item-id', 's1');
    await expect(card.locator('.insight-task-row').first().locator('.insight-task-meta')).toHaveText('On Oct 1 · 5 days ago');
    await expect(card.locator('.insight-card-foot')).toHaveText('All time: 11 shelved, oldest from Sep 14, 2026');

    await card.locator('.insight-show-all').click();
    await expect(page.locator('#insights-view')).toBeVisible();
    await expect(page.locator('.shelved-card .insight-task-row')).toHaveCount(10);
    await page.locator('.shelved-card .insight-show-all').click();
    await expect(page.locator('.shelved-card .insight-task-row')).toHaveCount(8);

    await page.locator('.shelved-card .insight-show-all').click();
    await page.locator('.shelved-card .insight-task-row[data-item-id="s2"] .insight-task-btn.open').click();
    await expectDeskOn(page, 'Monday, October 5, 2026', '2026-10-05');
    await expect(page.locator('#item-s2')).toHaveClass(/search-highlight/);
  });

  test('Bring back moves a shelved task to today\'s Active column and keeps Insights open', async ({ page }) => {
    await openInsights(page, 'month');
    const row = page.locator('.shelved-card .insight-task-row[data-item-id="s1"]');
    await row.locator('.insight-task-btn.bring-back').click();
    await expect(page.locator('#toast')).toContainText('Task brought back to today');
    await expect(page.locator('#insights-view')).toBeVisible();
    await expect(page.locator('.shelved-card .insight-task-row[data-item-id="s1"]')).toHaveCount(0);
    await expect(page.locator('.shelved-card .carryover-hint')).toHaveText('9 shelved tasks sitting on days in this period');
    await expect(page.locator('.lingering-card')).toBeVisible();

    const oct1 = await workDay(page, '2026-10-01');
    expect(oct1.map((i: any) => i.id)).not.toContain('s1');
    const today = await workDay(page, '2026-10-06');
    const s1 = today.find((i: any) => i.id === 's1');
    expect(s1).toMatchObject({ shelved: false, boardColumn: 'active', tags: ['ace', 'postgres'] });
    expect(s1.carriedFrom).toBeUndefined();

    await page.locator('#tab-desk').click();
    await expect(page.locator('#date-title')).toHaveText('Tuesday, October 6, 2026');
    await expect(page.locator('.board-column.active #item-s1')).toBeVisible();
  });

  test('bringing back the last shelved task in a period hides the card', async ({ page }) => {
    await openInsights(page, 'week', '2026-09-14');
    await expect(page.locator('.shelved-card .insight-task-row')).toHaveCount(1);
    await page.locator('.shelved-card .insight-task-btn.bring-back').click();
    await expect(page.locator('.shelved-card')).toHaveCount(0);
    await expect(page.locator('.insight-empty')).toBeVisible();
    await expect(page.locator('.insights-current-btn')).toHaveText('This week');
  });
});

// ── Options menu 1.15.1 polish ──────────────────────────────────────────
test.describe('Options menu 1.15.1 polish', { tag: ['@options'] }, () => {
  type Seed = { theme?: string; holidays?: { date: string; label: string }[]; tags?: boolean };
  const DEFAULT_HOLIDAYS = [
    { date: '2026-10-06', label: 'National Taco Day' },
    { date: '2026-10-31', label: 'Halloween' },
    { date: '2026-12-24', label: '<b>Eve</b>' },
  ];

  async function openOptions(page: Page, tab: 'themes' | 'appearance' | 'behavior', seed: Seed = {}, section?: string) {
    await page.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
    await page.addInitScript((s) => {
      if (localStorage.getItem('opts-seeded')) return;
      localStorage.setItem('opts-seeded', '1');
      const items: any[] = [];
      if (s.tags) {
        for (let i = 0; i < 10; i++) {
          for (let n = 0; n < 10 - i; n++) {
            items.push({ id: `k${i}-${n}`, type: 'task', content: `Tagged ${i}.${n}`, completed: false, shelved: false,
              boardColumn: 'new', comments: [], tags: [`k${i}`], createdAt: '2026-10-13T09:00:00' });
          }
        }
      }
      const days = items.length ? { '2026-10-13': { date: '2026-10-13', items } } : {};
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
      if (s.theme) localStorage.setItem('work-desk-theme', s.theme);
      if (s.holidays) localStorage.setItem('work-desk-custom-holidays', JSON.stringify(s.holidays));
    }, seed);
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await page.locator('#density-toggle').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await page.locator(`.options-nav-btn[data-options-tab="${tab}"]`).click();
    if (section) await page.locator(`#options-pane-${tab} [data-options-open="${section}"]`).click();
  }
  const backToList = (page: Page) => page.locator('.options-pane:not(.hidden) .options-section:not([hidden]) [data-options-back]').click();

  const popout = (page: Page) => page.locator('#density-popout');
  const holidayRows = (page: Page) => page.locator('#custom-holidays-list .custom-holiday-item');

  const controlSnapshot = (page: Page) => page.evaluate(() => {
    const out: Record<string, string | boolean> = {};
    document.querySelectorAll<HTMLInputElement>('#options-pane-appearance input[type=checkbox], #options-pane-behavior input[type=checkbox]')
      .forEach(el => { out[el.id] = el.checked; });
    document.querySelectorAll<HTMLSelectElement>('#options-pane-appearance select, #options-pane-behavior select')
      .forEach(el => { out[el.id] = el.value; });
    out.density = document.getElementById('desk-view')!.dataset.density || 'comfortable';
    return out;
  });

  test('Themes: the current theme is named, and Show jumps back to its group', async ({ page }) => {
    await openOptions(page, 'themes', { theme: 'monokai' });
    const current = page.locator('#current-theme-btn');
    await expect(current).toHaveText('Current: Monokai · Dark');
    await expect(current.locator('.current-theme-jump')).toHaveCount(0);

    await page.locator('.theme-filter-btn[data-theme-filter="light"]').click();
    await expect(current).toHaveText('Current: Monokai · DarkShow');
    await current.locator('.current-theme-jump').click();
    await expect(popout(page)).toBeVisible();
    await expect(page.locator('.theme-filter-btn[data-theme-filter="dark"]')).toHaveClass(/active/);
    await expect(page.locator('.theme-swatch.active')).toHaveAttribute('data-theme-id', 'monokai');
    await expect(current.locator('.current-theme-jump')).toHaveCount(0);

    await current.click();
    await expect(popout(page)).toBeVisible();
    await expect(page.locator('.theme-filter-btn[data-theme-filter="dark"]')).toHaveClass(/active/);
  });

  test('Themes: a new install names Default · Light, and picking a theme updates the line', async ({ page }) => {
    await openOptions(page, 'themes');
    await expect(page.locator('#current-theme-btn')).toHaveText('Current: Default · Light');
    await page.locator('.theme-filter-btn[data-theme-filter="medium"]').click();
    await page.locator('.theme-swatch').first().click();
    await page.locator('#density-toggle').click();
    await expect(page.locator('#current-theme-btn')).toHaveText(/^Current: .+ · Medium$/);
  });

  test('Appearance: tag list shows 8 tags, Show all / Show fewer keep the menu open', async ({ page }) => {
    await openOptions(page, 'appearance', { tags: true }, 'tags');
    const rows = page.locator('#tag-color-list .tag-color-row');
    await expect(rows).toHaveCount(10);
    await expect(page.locator('#tag-color-list .tag-color-row:visible')).toHaveCount(8);
    await expect(rows.first()).toHaveAttribute('data-tag-row', 'k0');
    await expect(page.locator('#tag-color-list .tag-color-row[data-tag-row="k8"]')).toBeHidden();

    const more = page.locator('#tag-color-list .tag-color-more-btn');
    await expect(more).toHaveText('Show all (10)');
    await more.click();
    await expect(popout(page)).toBeVisible();
    await expect(page.locator('#tag-color-list .tag-color-row:visible')).toHaveCount(10);
    await expect(more).toHaveText('Show fewer');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await more.click();
    await expect(popout(page)).toBeVisible();
    await expect(page.locator('#tag-color-list .tag-color-row:visible')).toHaveCount(8);
    expect(await page.locator('#tag-color-list').evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');
  });

  test('Appearance: Reset only shows on a tag with a pinned color', async ({ page }) => {
    await openOptions(page, 'appearance', { tags: true }, 'tags');
    const row = page.locator('#tag-color-list .tag-color-row[data-tag-row="k1"]');
    const reset = row.locator('.tag-color-row-reset');
    await expect(reset).toBeHidden();
    await row.locator('.tag-color-input').fill('#22c55e');
    await expect(reset).toBeVisible();
    await expect(reset).toHaveText('Reset');
    await reset.click();
    await expect(popout(page)).toBeVisible();
    await expect(reset).toBeHidden();
    await expect(row).not.toHaveClass(/has-custom/);
  });

  test('Appearance: no Show all link with 8 tags or fewer', async ({ page }) => {
    await openOptions(page, 'appearance', {}, 'tags');
    await expect(page.locator('#tag-color-list .tag-color-empty')).toBeVisible();
    await expect(page.locator('#tag-color-list .tag-color-more-btn')).toHaveCount(0);
  });

  test('Behavior: Confirm before delete lives under Tasks and still saves', async ({ page }) => {
    await openOptions(page, 'behavior', {}, 'tasks');
    await expect(page.locator('[data-options-section="tasks"] #confirm-delete-toggle')).toBeVisible();
    await page.locator('label:has(#confirm-delete-toggle)').click();
    await expect(page.locator('#confirm-delete-toggle')).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('work-desk-confirm-delete'))).toBe('true');
  });

  test('Behavior: holidays list readable dates, plain-text labels, and Show past / Hide past', async ({ page }) => {
    await openOptions(page, 'behavior', { holidays: DEFAULT_HOLIDAYS }, 'holidays');
    await expect(holidayRows(page)).toHaveCount(2);
    await expect(holidayRows(page).first().locator('.holiday-date')).toHaveText('Sat, Oct 31, 2026');
    await expect(holidayRows(page).first().locator('.holiday-label')).toHaveText('Halloween');
    await expect(holidayRows(page).nth(1).locator('.holiday-label')).toHaveText('<b>Eve</b>');
    await expect(holidayRows(page).nth(1).locator('.holiday-label')).toHaveAttribute('title', '<b>Eve</b>');
    await expect(holidayRows(page).nth(1).locator('b')).toHaveCount(0);

    const past = page.locator('#custom-holidays-list .custom-holidays-past-btn');
    await expect(past).toHaveText('Show past (1)');
    await past.click();
    await expect(popout(page)).toBeVisible();
    await expect(holidayRows(page)).toHaveCount(3);
    await expect(holidayRows(page).first()).toHaveClass(/is-past/);
    await expect(holidayRows(page).first().locator('.holiday-label')).toHaveText('National Taco Day');
    await expect(page.locator('#custom-holidays-list .custom-holidays-past-btn')).toHaveText('Hide past');
    await page.locator('#custom-holidays-list .custom-holidays-past-btn').click();
    await expect(popout(page)).toBeVisible();
    await expect(holidayRows(page)).toHaveCount(2);
  });

  test('Behavior: removing a past holiday and adding past and upcoming ones keep the menu open', async ({ page }) => {
    await openOptions(page, 'behavior', { holidays: DEFAULT_HOLIDAYS }, 'holidays');
    await page.locator('#custom-holidays-list .custom-holidays-past-btn').click();
    await holidayRows(page).first().locator('.holiday-remove').click();
    await expect(popout(page)).toBeVisible();
    await expect(holidayRows(page)).toHaveCount(2);
    await expect(page.locator('#custom-holidays-list .custom-holidays-past-btn')).toHaveCount(0);

    await page.locator('#custom-holiday-label').fill('Team offsite');
    await page.locator('#custom-holiday-date').fill('2026-10-01');
    await page.locator('#custom-holiday-add-btn').click();
    await expect(popout(page)).toBeVisible();
    await expect(holidayRows(page)).toHaveCount(3);
    await expect(holidayRows(page).first().locator('.holiday-label')).toHaveText('Team offsite');
    await expect(holidayRows(page).first()).toHaveClass(/is-past/);

    await page.locator('#custom-holiday-date').fill('2026-11-27');
    await page.locator('#custom-holiday-add-btn').click();
    await expect(holidayRows(page)).toHaveCount(4);
    await expect(holidayRows(page).nth(2).locator('.holiday-label')).toHaveText('(no label)');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-custom-holidays')!).map((h: any) => h.date));
    expect(saved).toEqual(['2026-10-01', '2026-10-31', '2026-11-27', '2026-12-24']);
  });

  test('Behavior: only past holidays shows "No upcoming holidays" with Show past', async ({ page }) => {
    await openOptions(page, 'behavior', { holidays: [{ date: '2026-10-06', label: 'National Taco Day' }] }, 'holidays');
    await expect(page.locator('#custom-holidays-list .custom-holidays-empty')).toHaveText('No upcoming holidays');
    await expect(holidayRows(page)).toHaveCount(0);
    await page.locator('#custom-holidays-list .custom-holidays-past-btn').click();
    await expect(holidayRows(page)).toHaveCount(1);
    await expect(page.locator('#custom-holidays-list .custom-holidays-empty')).toHaveCount(0);
  });

  test('Behavior: the label box gets its own full-width line', async ({ page }) => {
    await openOptions(page, 'behavior', {}, 'holidays');
    const label = await page.locator('#custom-holiday-label').boundingBox();
    const date = await page.locator('#custom-holiday-date').boundingBox();
    const row = await page.locator('.custom-holiday-add-row').boundingBox();
    expect(label!.width).toBeGreaterThan(row!.width - 2);
    expect(date!.y).toBeGreaterThan(label!.y + label!.height - 1);
  });

  test('Reset Behavior: cancel changes nothing; confirm restores defaults and keeps custom holidays', async ({ page }) => {
    await openOptions(page, 'behavior', { holidays: DEFAULT_HOLIDAYS });
    const fresh = await controlSnapshot(page);
    for (const sel of ['#confirm-delete-toggle', '#confetti-toggle', '#us-federal-holidays-toggle']) {
      await openOptionsSectionFor(page, sel);
      await page.locator(`label:has(${sel})`).click();
    }
    await openOptionsSectionFor(page, '#week-start-select');
    await page.locator('#week-start-select').selectOption('monday');
    await page.locator('#startup-view-select').selectOption('today');
    await page.locator('#quiet-weekends-select').selectOption('both');
    await openOptionsSectionFor(page, '#auto-collapse-completed-at');
    await page.locator('#auto-collapse-completed-at').selectOption('10');
    await backToList(page);
    const changed = await controlSnapshot(page);
    expect(changed).not.toEqual(fresh);

    page.once('dialog', d => d.dismiss());
    await page.locator('[data-options-reset="behavior"]').click();
    expect(await controlSnapshot(page)).toEqual(changed);

    page.once('dialog', d => { expect(d.message()).toContain('Custom holidays are kept'); d.accept(); });
    await page.locator('[data-options-reset="behavior"]').click();
    await expect(page.locator('#toast')).toContainText('Behavior reset to defaults');
    await expect(popout(page)).toBeVisible();
    expect(await controlSnapshot(page)).toEqual(fresh);
    const stored = await page.evaluate(() => ({
      confirm: localStorage.getItem('work-desk-confirm-delete'),
      week: localStorage.getItem('work-desk-week-start'),
      holidays: JSON.parse(localStorage.getItem('work-desk-custom-holidays')!).length,
    }));
    expect(stored).toEqual({ confirm: 'false', week: 'sunday', holidays: 3 });

    page.once('dialog', d => d.accept());
    await page.locator('[data-options-reset="behavior"]').click();
    await expect(page.locator('#toast')).toContainText('Behavior is already on the defaults');
  });

  test('Reset Appearance: restores defaults, survives reload, keeps theme and pinned tag colors', async ({ page }) => {
    await openOptions(page, 'appearance', { theme: 'monokai', tags: true });
    const fresh = await controlSnapshot(page);
    await openOptionsSectionFor(page, '#font-size-select');
    await page.locator('#font-size-select').selectOption('large');
    await page.locator('#font-family-select').selectOption('jetbrains');
    await openOptionsSectionFor(page, '#sidebar-position-select');
    await page.locator('#sidebar-position-select').selectOption('right');
    await openOptionsSectionFor(page, '#tag-color-mode-select');
    await page.locator('#tag-color-mode-select').selectOption('palette');
    await page.locator('#tag-color-list .tag-color-row[data-tag-row="k0"] .tag-color-input').fill('#22c55e');
    await openOptionsSectionFor(page, '#card-glow-toggle');
    await page.locator('label:has(#card-glow-toggle)').click();
    await openOptionsSectionFor(page, '.density-option[data-density="compact"]');
    await page.locator('.density-option[data-density="compact"]').click();
    await expect(popout(page)).toBeVisible();
    await backToList(page);
    expect((await controlSnapshot(page)).density).toBe('compact');

    page.once('dialog', d => { expect(d.message()).toContain('Pinned tag colors are kept'); d.accept(); });
    await page.locator('[data-options-reset="appearance"]').click();
    await expect(page.locator('#toast')).toContainText('Appearance reset to defaults');
    await expect(popout(page)).toBeVisible();
    expect(await controlSnapshot(page)).toEqual(fresh);
    const kept = await page.evaluate(() => ({
      theme: localStorage.getItem('work-desk-theme'),
      pinned: JSON.parse(localStorage.getItem('work-desk-tag-colors') || '{}').k0,
    }));
    expect(kept).toEqual({ theme: 'monokai', pinned: '#22c55e' });

    await page.reload();
    await dismissAuthModal(page);
    expect(await controlSnapshot(page)).toEqual(fresh);
  });
});

// ── Board lanes 1.16.0: drop below a column ─────────────────────────────
test.describe('Board lanes 1.16.0', { tag: ['@board'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openBoard(page: Page, opts: { newCount?: number; activeCount?: number; note?: boolean } = {}) {
    const { newCount = 12, activeCount = 1, note = false } = opts;
    await page.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
    await page.addInitScript(([n, a, withNote]) => {
      if (localStorage.getItem('lane-seeded')) return;
      localStorage.setItem('lane-seeded', '1');
      const t = (id: string, content: string, extra: Record<string, unknown> = {}) => ({
        id, type: 'task', content, completed: false, shelved: false, boardColumn: 'new',
        comments: [], tags: [], createdAt: '2026-10-13T09:00:00', ...extra,
      });
      const items: any[] = [];
      for (let i = 0; i < n; i++) items.push(t(`n${i}`, `New task ${i + 1}`));
      for (let i = 0; i < a; i++) items.push(t(`a${i}`, `Active task ${i + 1}`, { boardColumn: 'active' }));
      items.push(t('c0', 'Finished already', { completed: true }));
      if (withNote) items.push({ id: 'note1', type: 'note', content: 'Meeting notes', comments: [], createdAt: '2026-10-13T09:00:00' });
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-auto-carry-forward', 'false');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: { '2026-10-13': { date: '2026-10-13', items } }, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    }, [newCount, activeCount, note] as const);
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await expect(page.locator('.sprint-board')).toBeVisible();
  }

  // Starts a real mouse drag on a card and moves to (x, y) in viewport coordinates
  async function dragCardTo(page: Page, cardId: string, point: (page: Page) => Promise<{ x: number; y: number }>) {
    const card = page.locator(`#item-${cardId}`);
    await card.scrollIntoViewIfNeeded();
    const cb = (await card.boundingBox())!;
    const sx = cb.x + cb.width * 0.4;
    const sy = cb.y + cb.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 15, sy + 10, { steps: 4 });
    const p = await point(page);
    await page.mouse.move(p.x, p.y, { steps: 10 });
    await page.mouse.move(p.x, p.y + 2, { steps: 2 });
  }

  const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
  const ghost = (page: Page) => page.locator('#board-lane-ghost');
  const columnIds = (page: Page, cls: string) =>
    page.locator(`.board-column.${cls} .item-card`).evaluateAll(els => els.map(e => e.id.replace(/^item-/, '')));

  test('dragging into the space under Active shows the lane and drops into Active', async ({ page }) => {
    await openBoard(page);
    await dragCardTo(page, 'n10', async (p) => {
      const a = await box(p, '.board-column.active');
      const card = await box(p, '#item-n10');
      return { x: a.x + a.width / 2, y: card.y + card.height / 2 };
    });
    await expect(ghost(page)).toBeVisible();
    await expect(ghost(page)).toHaveAttribute('data-target', 'active');
    await expect(page.locator('.board-lane-label')).toHaveText('Drop in Active');
    await expect(page.locator('.board-column.active')).toHaveClass(/drag-over/);
    await expect(page.locator('.board-column.new')).not.toHaveClass(/drag-over/);
    const g = (await ghost(page).boundingBox())!;
    const a = await box(page, '.board-column.active');
    expect(Math.abs(g.x - a.x)).toBeLessThan(2);
    expect(Math.abs(g.width - a.width)).toBeLessThan(2);

    await page.mouse.up();
    await expect(page.locator('#toast')).toContainText('Moved to Active');
    expect(await columnIds(page, 'active')).toContain('n10');
    expect(await columnIds(page, 'new')).not.toContain('n10');
    await expect(ghost(page)).toBeHidden();
    await expect(page.locator('.drag-over')).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-data-work')!).days['2026-10-13'].items.find((i: any) => i.id === 'n10'));
    expect(saved.boardColumn).toBe('active');
  });

  test('the lane under Completed / Shelved marks the task done and highlights Completed only', async ({ page }) => {
    await openBoard(page);
    await dragCardTo(page, 'n8', async (p) => {
      const d = await box(p, '.board-column.done');
      const card = await box(p, '#item-n8');
      return { x: d.x + d.width / 2, y: card.y + card.height / 2 };
    });
    await expect(page.locator('.board-lane-label')).toHaveText('Drop in Completed');
    await expect(page.locator('.board-column.done .col-subsection[data-drop-target="completed"]')).toHaveClass(/drag-over/);
    await expect(page.locator('.board-column.done .col-subsection[data-drop-target="shelved"]')).not.toHaveClass(/drag-over/);
    await page.mouse.up();
    await expect(page.locator('#toast')).toContainText('Task completed');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-data-work')!).days['2026-10-13'].items.find((i: any) => i.id === 'n8'));
    expect(saved.completed).toBe(true);
    expect(saved.shelved).toBe(false);
  });

  test('when Active is the long column, the space under New drops into New', async ({ page }) => {
    await openBoard(page, { newCount: 1, activeCount: 10 });
    await dragCardTo(page, 'a8', async (p) => {
      const n = await box(p, '.board-column.new');
      const card = await box(p, '#item-a8');
      return { x: n.x + n.width / 2, y: card.y + card.height / 2 };
    });
    await expect(page.locator('.board-lane-label')).toHaveText('Drop in New');
    await page.mouse.up();
    await expect(page.locator('#toast')).toContainText('Moved to New');
    expect(await columnIds(page, 'new')).toContain('a8');
  });

  test('the gap between columns does not accept a drop', async ({ page }) => {
    await openBoard(page);
    await dragCardTo(page, 'n10', async (p) => {
      const n = await box(p, '.board-column.new');
      const a = await box(p, '.board-column.active');
      const card = await box(p, '#item-n10');
      return { x: (n.x + n.width + a.x) / 2, y: card.y + card.height / 2 };
    });
    await expect(ghost(page)).toBeHidden();
    await expect(page.locator('.board-column.active')).not.toHaveClass(/drag-over/);
    await page.mouse.up();
    expect(await columnIds(page, 'new')).toContain('n10');
    await expect(page.locator('.drag-over')).toHaveCount(0);
  });

  test('the Notes area below the board does not accept a drop', async ({ page }) => {
    await openBoard(page, { note: true });
    await dragCardTo(page, 'n11', async (p) => {
      const a = await box(p, '.board-column.active');
      const notes = await box(p, '.item-section');
      return { x: a.x + a.width / 2, y: notes.y + Math.min(notes.height / 2, 40) };
    });
    await expect(ghost(page)).toBeHidden();
    await page.mouse.up();
    expect(await columnIds(page, 'new')).toContain('n11');
  });

  test('moving from the lane back over New clears the lane; moving into the Active box keeps its own highlight', async ({ page }) => {
    await openBoard(page, { newCount: 6 });
    await dragCardTo(page, 'n5', async (p) => {
      const a = await box(p, '.board-column.active');
      return { x: a.x + a.width / 2, y: a.y + a.height + 60 };
    });
    await expect(ghost(page)).toBeVisible();
    await expect(page.locator('.board-column.active')).toHaveClass(/drag-over/);

    const n = await box(page, '.board-column.new');
    await page.mouse.move(n.x + n.width / 2, n.y + n.height - 30, { steps: 8 });
    await page.mouse.move(n.x + n.width / 2, n.y + n.height - 28, { steps: 2 });
    await expect(ghost(page)).toBeHidden();
    await expect(page.locator('.board-column.active')).not.toHaveClass(/drag-over/);

    const a = await box(page, '.board-column.active');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height - 20, { steps: 8 });
    await page.mouse.move(a.x + a.width / 2, a.y + a.height - 18, { steps: 2 });
    await expect(ghost(page)).toBeHidden();
    await expect(page.locator('.board-column.active')).toHaveClass(/drag-over/);
    await page.mouse.up();
    await expect(page.locator('#toast')).toContainText('Moved to Active');
    expect(await columnIds(page, 'active')).toContain('n5');
    await expect(page.locator('.drag-over')).toHaveCount(0);
  });

  test('1.16.1: on a short board, the bottom of the page under Active still drops into Active', async ({ page }) => {
    await openBoard(page, { newCount: 3, activeCount: 1 });
    const boardBottom = (await box(page, '.sprint-board')).y + (await box(page, '.sprint-board')).height;
    await dragCardTo(page, 'n2', async (p) => {
      const a = await box(p, '.board-column.active');
      return { x: a.x + a.width / 2, y: 870 };
    });
    expect(870).toBeGreaterThan(boardBottom + 100);
    await expect(ghost(page)).toBeVisible();
    await expect(page.locator('.board-lane-label')).toHaveText('Drop in Active');
    await expect(page.locator('.board-column.active')).toHaveClass(/drag-over/);
    await page.mouse.up();
    await expect(page.locator('#toast')).toContainText('Moved to Active');
    expect(await columnIds(page, 'active')).toContain('n2');
    await expect(page.locator('.drag-over')).toHaveCount(0);
  });

  test('1.16.1: the far right margin drops into Completed; the far left margin is New', async ({ page }) => {
    await openBoard(page, { newCount: 3, activeCount: 1 });
    await dragCardTo(page, 'n1', async (p) => {
      const d = await box(p, '.board-column.done');
      return { x: d.x + d.width + 12, y: d.y + 40 };
    });
    await expect(page.locator('.board-column.done .col-subsection[data-drop-target="completed"]')).toHaveClass(/drag-over/);
    await expect(ghost(page)).toBeHidden();
    const n = await box(page, '.board-column.new');
    await page.mouse.move(n.x - 10, 860, { steps: 8 });
    await page.mouse.move(n.x - 10, 862, { steps: 2 });
    await expect(ghost(page)).toBeVisible();
    await expect(page.locator('.board-lane-label')).toHaveText('Drop in New');
    await expect(page.locator('.board-column.done .drag-over')).toHaveCount(0);
    const d = await box(page, '.board-column.done');
    await page.mouse.move(d.x + d.width + 12, d.y + 40, { steps: 8 });
    await page.mouse.move(d.x + d.width + 12, d.y + 42, { steps: 2 });
    await page.mouse.up();
    await expect(page.locator('#toast')).toContainText('Task completed');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-data-work')!).days['2026-10-13'].items.find((i: any) => i.id === 'n1'));
    expect(saved.completed).toBe(true);
  });

  test('1.16.1: dragging over the sidebar or the header above the board is not a lane', async ({ page }) => {
    await openBoard(page, { newCount: 3, activeCount: 1 });
    await dragCardTo(page, 'n0', async (p) => {
      const s = await box(p, '.sidebar');
      return { x: s.x + s.width / 2, y: 700 };
    });
    await expect(ghost(page)).toBeHidden();
    const a = await box(page, '.board-column.active');
    await page.mouse.move(a.x + a.width / 2, a.y - 30, { steps: 8 });
    await page.mouse.move(a.x + a.width / 2, a.y - 28, { steps: 2 });
    await expect(ghost(page)).toBeHidden();
    await page.mouse.up();
    expect(await columnIds(page, 'new')).toContain('n0');
  });

  test('stacked columns (1000px wide) have no lanes', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await openBoard(page, { newCount: 3 });
    await dragCardTo(page, 'n1', async (p) => {
      const d = await box(p, '.board-column.done');
      return { x: d.x + d.width / 2, y: d.y + d.height + 10 };
    });
    await expect(ghost(page)).toHaveCount(0);
    await page.mouse.up();
    expect(await columnIds(page, 'new')).toContain('n1');
  });
});

// ── Patterned background 1.16.1 ─────────────────────────────────────────
test.describe('Patterned background 1.16.1', { tag: ['@options'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openAppearance(page: Page, stored?: Record<string, string>) {
    await page.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
    await page.addInitScript((s) => {
      if (localStorage.getItem('bgp-seeded')) return;
      localStorage.setItem('bgp-seeded', '1');
      const items = [{ id: 'n1', type: 'task', content: 'Review PR', completed: false, shelved: false, boardColumn: 'new', comments: [], tags: [], createdAt: '2026-10-13T09:00:00' }];
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: { '2026-10-13': { date: '2026-10-13', items } }, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
      for (const [k, v] of Object.entries(s || {})) localStorage.setItem(k, v);
    }, stored);
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    if ((page.viewportSize()?.width ?? 1440) <= 768) {
      await page.locator('#mobile-menu-btn').click();
      await page.locator('#mobile-menu-options').click();
    } else {
      await page.locator('#density-toggle').click();
    }
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(page.locator('#options-pane-appearance')).toBeVisible();
    await page.locator('#options-pane-appearance [data-options-open="background"]').click();
    await expect(page.locator('[data-options-section="background"]')).toBeVisible();
  }

  const popout = (page: Page) => page.locator('#density-popout');
  const tiles = (page: Page) => page.locator('#bg-pattern-grid .bg-pattern-tile');
  // Theme switches cross-fade the background; read it once the fade settles
  const mainTile = async (page: Page) => {
    const raw = () => page.locator('.main').evaluate(el => getComputedStyle(el).backgroundImage);
    await expect.poll(async () => (await raw()).startsWith('cross-fade')).toBe(false);
    return decodeURIComponent(await raw());
  };

  test('off by default: just the toggle, no pattern on the page', async ({ page }) => {
    await openAppearance(page);
    await expect(page.locator('#bg-pattern-toggle')).not.toBeChecked();
    await expect(page.locator('#bg-pattern-controls')).toBeHidden();
    expect(await mainTile(page)).toBe('none');
  });

  test('turning it on shows 12 patterns and the slider, applies Graph paper at 10%, and keeps Options open', async ({ page }) => {
    await openAppearance(page);
    await page.locator('label:has(#bg-pattern-toggle)').click();
    await expect(popout(page)).toBeVisible();
    await expect(page.locator('#bg-pattern-controls')).toBeVisible();
    await expect(tiles(page)).toHaveCount(12);
    expect(await tiles(page).evaluateAll(els => els.map(el => el.getAttribute('aria-label')))).toEqual(['Graph paper', 'Plus grid', 'Isometric',
      'Diagonal', 'Pinstripe', 'Crosshatch', 'Hexagon', 'Herringbone', 'Basketweave', 'Chevron', 'Greek key', 'Dot grid']);
    await expect(page.locator('.bg-pattern-tile.active')).toHaveAttribute('data-bg-pattern', 'graph');
    await expect(page.locator('#bg-pattern-name')).toHaveText('Graph paper');
    await expect(page.locator('#bg-pattern-strength-val')).toHaveText('10%');
    const tile = await mainTile(page);
    expect(tile).toContain('data:image/svg+xml');
    expect(tile).toContain("<g opacity='0.1'>");
    expect(tile).toContain("width='60'");
  });

  test('clicking every pattern applies it, marks it checked, and never closes Options', async ({ page }) => {
    await openAppearance(page, { 'work-desk-bg-pattern-on': 'true' });
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const tile = tiles(page).nth(i);
      const id = (await tile.getAttribute('data-bg-pattern'))!;
      await tile.click();
      await expect(popout(page)).toBeVisible();
      await expect(tile).toHaveClass(/active/);
      await expect(tile).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('.bg-pattern-tile.active')).toHaveCount(1);
      await expect(page.locator('#bg-pattern-name')).toHaveText((await tile.getAttribute('aria-label'))!);
      expect(await page.evaluate(() => localStorage.getItem('work-desk-bg-pattern'))).toBe(id);
      seen.add(await mainTile(page));
    }
    expect(seen.size).toBe(12);
  });

  test('Strength slider changes the pattern opacity live and the label follows', async ({ page }) => {
    await openAppearance(page, { 'work-desk-bg-pattern-on': 'true' });
    await page.locator('#bg-pattern-strength').fill('25');
    await expect(page.locator('#bg-pattern-strength-val')).toHaveText('25%');
    expect(await mainTile(page)).toContain("<g opacity='0.25'>");
    await page.locator('#bg-pattern-strength').fill('2');
    await expect(page.locator('#bg-pattern-strength-val')).toHaveText('2%');
    expect(await mainTile(page)).toContain("<g opacity='0.02'>");
    await expect(popout(page)).toBeVisible();
  });

  test('choices survive a reload; turning off hides the controls but remembers the pattern and strength', async ({ page }) => {
    await openAppearance(page, { 'work-desk-bg-pattern-on': 'true' });
    await page.locator('.bg-pattern-tile[data-bg-pattern="herringbone"]').click();
    await page.locator('#bg-pattern-strength').fill('18');
    await page.reload();
    await dismissAuthModal(page);
    expect(await mainTile(page)).toContain("<g opacity='0.18'>");
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(page.locator('#options-pane-appearance [data-options-open="background"]')).toHaveAttribute('title', 'Current: Herringbone · 18%');
    await page.locator('#options-pane-appearance [data-options-open="background"]').click();
    await expect(page.locator('.bg-pattern-tile.active')).toHaveAttribute('data-bg-pattern', 'herringbone');

    await page.locator('label:has(#bg-pattern-toggle)').click();
    await expect(page.locator('#bg-pattern-controls')).toBeHidden();
    expect(await mainTile(page)).toBe('none');
    await page.locator('label:has(#bg-pattern-toggle)').click();
    await expect(page.locator('.bg-pattern-tile.active')).toHaveAttribute('data-bg-pattern', 'herringbone');
    await expect(page.locator('#bg-pattern-strength-val')).toHaveText('18%');
  });

  test('switching to a dark theme recolors the pattern with the theme text color', async ({ page }) => {
    await openAppearance(page, { 'work-desk-bg-pattern-on': 'true' });
    const lightInk = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--text').trim());
    expect(await mainTile(page)).toContain(`stroke='${lightInk}'`);
    await page.locator('.options-nav-btn[data-options-tab="themes"]').click();
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await page.locator('#customize-theme-grid .theme-swatch').first().click();
    const textColor = () => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--text').trim());
    await expect.poll(textColor).not.toBe(lightInk);
    const darkInk = await textColor();
    await expect.poll(() => mainTile(page)).toContain(`stroke='${darkInk}'`);
    if (!(await popout(page).isVisible())) await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await page.locator('#options-pane-appearance [data-options-open="background"]').click();
    const swatch = await page.locator('.bg-pattern-tile.active .bg-pattern-swatch').evaluate(el => decodeURIComponent(getComputedStyle(el).backgroundImage));
    expect(swatch).toContain(`stroke='${darkInk}'`);
  });

  test('arrow keys move between patterns', async ({ page }) => {
    await openAppearance(page, { 'work-desk-bg-pattern-on': 'true' });
    await page.locator('.bg-pattern-tile[data-bg-pattern="graph"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.bg-pattern-tile.active')).toHaveAttribute('data-bg-pattern', 'plus');
    await expect(page.locator('.bg-pattern-tile[data-bg-pattern="plus"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.bg-pattern-tile.active')).toHaveAttribute('data-bg-pattern', 'pinstripe');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.bg-pattern-tile.active')).toHaveAttribute('data-bg-pattern', 'diagonal');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.bg-pattern-tile.active')).toHaveAttribute('data-bg-pattern', 'graph');
    await expect(popout(page)).toBeVisible();
  });

  test('Reset Appearance turns the pattern off and restores Graph paper at 10%', async ({ page }) => {
    await openAppearance(page, { 'work-desk-bg-pattern-on': 'true', 'work-desk-bg-pattern': 'greek-key', 'work-desk-bg-pattern-strength': '30' });
    expect(await mainTile(page)).toContain("<g opacity='0.3'>");
    await page.locator('[data-options-section="background"] [data-options-back]').click();
    page.once('dialog', d => d.accept());
    await page.locator('[data-options-reset="appearance"]').click();
    await expect(page.locator('#toast')).toContainText('Appearance reset to defaults');
    await expect(page.locator('#bg-pattern-toggle')).not.toBeChecked();
    expect(await mainTile(page)).toBe('none');
    const stored = await page.evaluate(() => [localStorage.getItem('work-desk-bg-pattern'), localStorage.getItem('work-desk-bg-pattern-strength')]);
    expect(stored).toEqual(['graph', '10']);
  });

  test('phone: the pattern grid fits the Options sheet and the pattern shows behind the board', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openAppearance(page, { 'work-desk-bg-pattern-on': 'true' });
    const grid = page.locator('#bg-pattern-grid');
    await grid.scrollIntoViewIfNeeded();
    const g = (await grid.boundingBox())!;
    expect(g.x).toBeGreaterThanOrEqual(0);
    expect(g.x + g.width).toBeLessThanOrEqual(390);
    await page.locator('.bg-pattern-tile[data-bg-pattern="isometric"]').click();
    await expect(popout(page)).toBeVisible();
    expect(await mainTile(page)).toContain("height='41.57'");
  });
});

// ── Sidebar top / bottom 1.16.0 ─────────────────────────────────────────
test.describe('Card tags 1.16.0', { tag: ['@tags', '@board'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const LONG = 'Sometimes if there are too many items under new, it becomes a chore to drag the item under the active card. Let us add the ability to drop in the middle of the page.';

  async function openTagged(page: Page) {
    await page.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
    await page.addInitScript((long) => {
      if (localStorage.getItem('cardtags-seeded')) return;
      localStorage.setItem('cardtags-seeded', '1');
      const t = (id: string, extra: Record<string, unknown> = {}) => ({
        id, type: 'task', content: long, completed: false, shelved: false, boardColumn: 'new',
        comments: [], createdAt: '2026-10-13T09:00:00', ...extra,
      });
      const n = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'note', content: long, comments: [], createdAt: '2026-10-13T09:00:00', ...extra });
      const items = [
        t('tagged', { tags: ['workdesk'] }),
        t('plain'),
        t('many', { tags: ['workdesk', 'averyveryverylongtagnamethatkeepsgoing', 'eoyreview', 'ops'] }),
        t('later'),
        n('note-tagged', { tags: ['notes'] }),
        n('note-plain'),
      ];
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-auto-carry-forward', 'false');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: { '2026-10-13': { date: '2026-10-13', items } }, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    }, LONG);
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await expect(page.locator('#item-plain')).toBeVisible();
  }

  // Width actually available to the text (content box minus padding) plus its rendered height
  const textBox = (page: Page, id: string) => page.locator(`#item-${id} .item-content`).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      width: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      height: el.getBoundingClientRect().height,
    };
  });

  async function expectSameText(page: Page, a: string, b: string) {
    const [x, y] = [await textBox(page, a), await textBox(page, b)];
    expect(Math.abs(x.width - y.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(x.height - y.height)).toBeLessThanOrEqual(2);
  }

  async function expectChipsClearOfText(page: Page, id: string) {
    const chips = (await page.locator(`#item-${id} .tag-chip-row`).boundingBox())!;
    const text = (await page.locator(`#item-${id} .item-content`).boundingBox())!;
    const card = (await page.locator(`#item-${id}`).boundingBox())!;
    expect(chips.y + chips.height).toBeLessThanOrEqual(text.y + 1);
    expect(chips.x + chips.width).toBeLessThanOrEqual(card.x + card.width);
  }

  test('a tagged card wraps its text exactly like an untagged one', async ({ page }) => {
    await openTagged(page);
    await expectSameText(page, 'tagged', 'plain');
    await expectSameText(page, 'many', 'plain');
    await expectSameText(page, 'note-tagged', 'note-plain');
    for (const id of ['tagged', 'many', 'note-tagged']) await expectChipsClearOfText(page, id);
    await expect(page.locator('#item-many .tag-chip')).toHaveCount(4);
  });

  test('adding a tag through the tag button leaves the text width unchanged', async ({ page }) => {
    await openTagged(page);
    const card = page.locator('#item-later');
    const before = await textBox(page, 'later');
    await card.locator('button.card-action', { hasText: /^tag$/i }).click();
    await card.locator('.tag-input-inline').fill('fresh');
    await card.locator('.tag-input-inline').press('Enter');
    await expect(card.locator('.tag-chip-row .tag-chip-label')).toHaveText(['fresh']);
    const after = await textBox(page, 'later');
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2);
    await expectChipsClearOfText(page, 'later');
    await card.locator('.tag-chip-remove').click();
    await expect(card.locator('.tag-chip')).toHaveCount(0);
    expect(Math.abs((await textBox(page, 'later')).width - before.width)).toBeLessThanOrEqual(2);
  });

  test('compact layout keeps the one-line text the same width with tags', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('work-desk-density', 'compact'));
    await openTagged(page);
    await expect(page.locator('#desk-view')).toHaveAttribute('data-density', 'compact');
    await expectSameText(page, 'tagged', 'plain');
    await expectSameText(page, 'many', 'plain');
    await expectChipsClearOfText(page, 'many');
  });

  test('phone width keeps tagged and untagged text the same', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTagged(page);
    await expectSameText(page, 'tagged', 'plain');
    await expectSameText(page, 'many', 'plain');
    await expectSameText(page, 'note-tagged', 'note-plain');
    for (const id of ['tagged', 'many', 'note-tagged']) await expectChipsClearOfText(page, id);
  });
});

test.describe('Sidebar top and bottom 1.16.0', { tag: ['@sidebar'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openDesk(page: Page, position?: string) {
    await page.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
    await page.addInitScript((pos) => {
      if (localStorage.getItem('bar-seeded')) return;
      localStorage.setItem('bar-seeded', '1');
      const t = (id: string, content: string, extra: Record<string, unknown> = {}) => ({
        id, type: 'task', content, completed: false, shelved: false, boardColumn: 'new',
        comments: [], tags: [], createdAt: '2026-10-13T09:00:00', ...extra,
      });
      const items = [t('n1', 'Review PR for IDS batching'), t('a1', 'Call vendor about the renewal', { boardColumn: 'active' })];
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-auto-carry-forward', 'false');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: { '2026-10-13': { date: '2026-10-13', items } }, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-projects', JSON.stringify({ deletedIds: {}, projects: [
        { id: 'p1', name: 'EoY Review', createdAt: '2026-10-13T09:00:00', notes: [], tasks: [] },
        { id: 'p2', name: 'Databricks Silver Layer', createdAt: '2026-10-13T09:00:00', notes: [], tasks: [] },
      ] }));
      if (pos) localStorage.setItem('work-desk-sidebar-position', pos);
    }, position);
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await expect(page.locator('.sprint-board')).toBeVisible();
  }

  async function pickPosition(page: Page, pos: string) {
    if (!(await page.locator('#density-popout').isVisible())) await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await openOptionsSectionFor(page, '#sidebar-position-select');
    await page.locator('#sidebar-position-select').selectOption(pos);
    await expect(page.locator('#density-popout')).toBeVisible();
  }

  const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

  test('Options: Top, Bottom, Right, and Left each move the sidebar', async ({ page }) => {
    await openDesk(page);
    const sel = page.locator('#sidebar-position-select');
    await expect(sel.locator('option')).toHaveText(['Left', 'Right', 'Top', 'Bottom']);

    await pickPosition(page, 'top');
    await expect(page.locator('html')).toHaveAttribute('data-sidebar-bar', 'true');
    let s = await box(page, '.sidebar');
    expect(s.y).toBe(0);
    expect(s.width).toBe(1440);
    expect((await box(page, '.main')).y).toBeGreaterThanOrEqual(s.height - 1);

    await pickPosition(page, 'bottom');
    s = await box(page, '.sidebar');
    expect(s.width).toBe(1440);
    expect(Math.round(s.y + s.height)).toBe(900);
    expect((await box(page, '.main')).y).toBe(0);

    await pickPosition(page, 'right');
    await expect(page.locator('html')).not.toHaveAttribute('data-sidebar-bar', /.*/);
    s = await box(page, '.sidebar');
    expect(s.height).toBe(900);
    expect(Math.round(s.x + s.width)).toBe(1440);

    await pickPosition(page, 'left');
    s = await box(page, '.sidebar');
    expect(s.x).toBe(0);
    expect(s.height).toBe(900);
    expect(s.width).toBeLessThan(400);
    await expect(page.locator('#sidebar-toggle')).toBeVisible();
    await expect(page.locator('.date-nav')).toBeVisible();
  });

  test('top bar: one row at 1440, collapse and calendar hidden, week strip shown, survives reload', async ({ page }) => {
    await openDesk(page);
    await pickPosition(page, 'top');
    await page.locator('#density-toggle').click();
    await expect(page.locator('#density-popout')).toBeHidden();
    expect((await box(page, '.sidebar')).height).toBeLessThan(80);
    await expect(page.locator('#sidebar-toggle')).toBeHidden();
    await expect(page.locator('.date-nav')).toBeHidden();
    await expect(page.locator('#week-strip-row')).toBeVisible();
    await expect(page.locator('#logo-sub-text')).toBeHidden();
    const barH = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--sidebar-bar-h'));
    expect(parseFloat(barH)).toBeGreaterThan(40);

    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('html')).toHaveAttribute('data-sidebar-position', 'top');
    expect((await box(page, '.sidebar')).y).toBe(0);
    expect((await box(page, '.sidebar')).width).toBe(1440);
  });

  test('top bar: tabs, Projects list, account menu Export, and Repair all work', async ({ page }) => {
    await openDesk(page, 'top');
    await page.locator('#tab-insights').click();
    await expect(page.locator('#tab-insights')).toHaveClass(/active/);
    await page.locator('#tab-desk').click();
    await expect(page.locator('.sprint-board')).toBeVisible();

    await openAccountMenu(page);
    const acct = await box(page, '#account-menu');
    const acctBtn = await box(page, '#account-menu-btn');
    expect(acct.y).toBeGreaterThanOrEqual(acctBtn.y + acctBtn.height);
    expect(Math.round(acct.x + acct.width)).toBeLessThanOrEqual(1440);
    await page.locator('#export-btn').click();
    const menu = page.locator('#export-menu');
    await expect(menu).toBeVisible();
    const m = await box(page, '#export-menu');
    const b = await box(page, '#export-btn');
    expect(m.y).toBeGreaterThanOrEqual(b.y + b.height);
    expect(m.y + m.height).toBeLessThanOrEqual(900);
    await page.locator('#export-btn').click();
    await expect(menu).toBeHidden();

    await page.locator('#repair-btn').click();
    await expect(page.locator('#toast')).toContainText('No duplicates found');

    await page.locator('#tab-projects').click();
    const projects = page.locator('#projects-list li');
    await expect(projects).toHaveCount(2);
    const p0 = await projects.nth(0).boundingBox();
    const p1 = await projects.nth(1).boundingBox();
    expect(Math.abs(p0!.y - p1!.y)).toBeLessThan(4);
    expect(p1!.x).toBeGreaterThan(p0!.x);
    expect((await box(page, '.sidebar')).height).toBeLessThan(80);
    await page.locator('#tab-work').click();
    await expect(page.locator('.sprint-board')).toBeVisible();
  });

  test('bottom bar: search results and toasts open above it', async ({ page }) => {
    await openDesk(page, 'bottom');
    const bar = await box(page, '.sidebar');
    await page.locator('#search-input').fill('vendor');
    const overlay = page.locator('#search-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('Call vendor');
    const o = await box(page, '#search-overlay');
    const input = await box(page, '#search-input');
    expect(o.y).toBeGreaterThanOrEqual(0);
    expect(o.y + o.height).toBeLessThanOrEqual(input.y);
    expect(o.y + o.height).toBeLessThan(bar.y + 12);
    await page.locator('#search-overlay-close').click();
    await expect(overlay).toBeHidden();

    await openAccountMenu(page);
    const acct = await box(page, '#account-menu');
    expect(acct.y + acct.height).toBeLessThanOrEqual((await box(page, '#account-menu-btn')).y);
    expect(acct.y).toBeGreaterThanOrEqual(0);
    await page.locator('#repair-btn').click();
    await expect(page.locator('#account-menu')).toBeHidden();
    const toast = page.locator('#toast');
    await expect(toast).toContainText('No duplicates found');
    await expect.poll(async () => {
      const t = await box(page, '#toast');
      return t.y + t.height;
    }).toBeLessThanOrEqual(bar.y);
  });

  test('1024px: the top bar wraps but stays full width above the board', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await openDesk(page, 'top');
    const s = await box(page, '.sidebar');
    expect(s.y).toBe(0);
    expect(s.width).toBe(1024);
    expect((await box(page, '.main')).y).toBeGreaterThanOrEqual(s.height - 1);
    await expect(page.locator('#week-strip-row')).toBeVisible();
  });

  test('phones ignore Top and Bottom and keep the normal phone header', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openDesk(page, 'left');
    const phone = await box(page, '.sidebar');
    await page.evaluate(() => localStorage.setItem('work-desk-sidebar-position', 'bottom'));
    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('html')).toHaveAttribute('data-sidebar-position', 'bottom');
    const s = await box(page, '.sidebar');
    expect(s.y).toBe(0);
    expect(s.height).toBe(phone.height);
    await expect(page.locator('#mobile-menu-btn')).toBeVisible();
    const barH = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--sidebar-bar-h'));
    expect(barH.trim()).toBe('0px');
  });

  test('Reset Appearance returns a bar to the left sidebar', async ({ page }) => {
    await openDesk(page, 'bottom');
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(page.locator('#sidebar-position-select')).toHaveValue('bottom');
    page.once('dialog', d => d.accept());
    await page.locator('[data-options-reset="appearance"]').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await expect(page.locator('#sidebar-position-select')).toHaveValue('left');
    await expect(page.locator('html')).not.toHaveAttribute('data-sidebar-bar', /.*/);
    expect((await box(page, '.sidebar')).x).toBe(0);
    expect((await box(page, '.sidebar')).height).toBe(900);
  });
});

// ── 1.17.0: Options summary list, account menu, calendar polish, quieter weekends ──
async function open117(page: Page, stored: Record<string, string> = {}) {
  await page.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
  await page.addInitScript((s) => {
    if (localStorage.getItem('v117-seeded')) return;
    localStorage.setItem('v117-seeded', '1');
    const task = (id: string, content: string) => ({ id, type: 'task', content, completed: false, shelved: false, boardColumn: 'new', comments: [], tags: [], createdAt: '2026-10-05T09:00:00' });
    localStorage.setItem('work-desk-list-context', 'work');
    localStorage.setItem('work-desk-auto-carry-forward', 'false');
    localStorage.setItem('work-desk-data-work', JSON.stringify({ deletedIds: {}, days: {
      '2026-10-05': { date: '2026-10-05', items: [task('w1', 'Left open on Monday'), task('w2', 'Also left open')] },
      '2026-10-13': { date: '2026-10-13', items: [task('w3', 'Today task')] },
    } }));
    localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, stored);
  await page.goto(DESK_URL);
  await dismissAuthModal(page);
  await expect(page.locator('.sprint-board')).toBeVisible();
}

test.describe('Options summary list 1.17.0', { tag: ['@options'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const popout = (page: Page) => page.locator('#density-popout');
  const ROWS = {
    appearance: ['card-layout', 'typography', 'layout', 'effects', 'background', 'tags'],
    behavior: ['general', 'tasks', 'projects', 'insights', 'holidays'],
  } as const;

  async function openTab(page: Page, tab: 'appearance' | 'behavior') {
    if (!(await popout(page).isVisible())) await page.locator('#density-toggle').click();
    await page.locator(`.options-nav-btn[data-options-tab="${tab}"]`).click();
    await expect(page.locator(`#options-pane-${tab} .options-summary`)).toBeVisible();
  }

  for (const tab of ['appearance', 'behavior'] as const) {
    test(`${tab}: every row opens its section and the back button returns to the list`, async ({ page }) => {
      await open117(page);
      await openTab(page, tab);
      const pane = page.locator(`#options-pane-${tab}`);
      await expect(pane.locator('[data-options-open]')).toHaveCount(ROWS[tab].length);
      for (const id of ROWS[tab]) {
        await expect(pane.locator(`[data-options-open="${id}"] .options-row-desc`)).toBeVisible();
        await expect(pane.locator(`[data-options-open="${id}"]`)).toHaveAttribute('title', /^Current: .+/);
        await pane.locator(`[data-options-open="${id}"]`).click();
        // The clicked row is hidden by the click; Options must stay open
        await expect(popout(page)).toBeVisible();
        const section = pane.locator(`[data-options-section="${id}"]`);
        await expect(section).toBeVisible();
        await expect(pane.locator('.options-section:visible')).toHaveCount(1);
        await expect(pane.locator('.options-summary')).toBeHidden();
        await expect(pane.locator(`[data-options-reset="${tab}"]`)).toBeHidden();
        const back = section.locator('[data-options-back]');
        await expect(back).toHaveText('‹ Back');
        await expect(back).toBeFocused();
        await back.click();
        await expect(popout(page)).toBeVisible();
        await expect(section).toBeHidden();
        await expect(pane.locator('.options-summary')).toBeVisible();
        await expect(pane.locator(`[data-options-reset="${tab}"]`)).toBeVisible();
        await expect(pane.locator(`[data-options-open="${id}"]`)).toBeFocused();
      }
    });
  }

  test('Esc goes back to the list first, then closes Options', async ({ page }) => {
    await open117(page);
    await openTab(page, 'behavior');
    await page.locator('#options-pane-behavior [data-options-open="tasks"]').click();
    await page.keyboard.press('Escape');
    await expect(popout(page)).toBeVisible();
    await expect(page.locator('#options-pane-behavior .options-summary')).toBeVisible();
    await expect(page.locator('[data-options-section="tasks"]')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(popout(page)).toBeHidden();
  });

  test('switching tabs or reopening Options always lands on the list', async ({ page }) => {
    await open117(page);
    await openTab(page, 'appearance');
    await page.locator('#options-pane-appearance [data-options-open="effects"]').click();
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(page.locator('#options-pane-appearance .options-summary')).toBeVisible();
    await expect(page.locator('[data-options-section="effects"]')).toBeHidden();

    await page.locator('#options-pane-appearance [data-options-open="effects"]').click();
    await page.locator('#density-toggle').click();
    await expect(popout(page)).toBeHidden();
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(page.locator('#options-pane-appearance .options-summary')).toBeVisible();
  });

  test('the panel keeps its height between the list and a short section', async ({ page }) => {
    await open117(page);
    await openTab(page, 'appearance');
    const listH = (await popout(page).boundingBox())!.height;
    await page.locator('#options-pane-appearance [data-options-open="layout"]').click();
    const sectionH = (await popout(page).boundingBox())!.height;
    expect(Math.abs(sectionH - listH)).toBeLessThanOrEqual(2);
  });

  for (const tab of ['appearance', 'behavior'] as const) {
    test(`${tab}: the panel hugs the list with no empty space below Reset`, async ({ page }) => {
      await open117(page);
      await openTab(page, tab);
      const pop = (await popout(page).boundingBox())!;
      const reset = (await page.locator(`[data-options-reset="${tab}"]`).boundingBox())!;
      expect(pop.y + pop.height - (reset.y + reset.height)).toBeLessThanOrEqual(24);

      // A tall section can grow the panel; going back returns it to the list's size
      await page.locator(`#options-pane-${tab} [data-options-open="${tab === 'appearance' ? 'tags' : 'tasks'}"]`).click();
      await page.keyboard.press('Escape');
      await expect(page.locator(`#options-pane-${tab}`)).toHaveAttribute('style', /^(?!.*min-height)/);
      await expect.poll(async () => Math.round((await popout(page).boundingBox())!.height)).toBe(Math.round(pop.height));
    });
  }

  test('summary values follow changes made inside a section (round trip)', async ({ page }) => {
    await open117(page);
    await openTab(page, 'appearance');
    const value = (id: string) => page.locator(`.options-row[data-options-open="${id}"]`);
    await expect(value('typography')).toHaveAttribute('title', 'Current: Default · System font');
    await page.locator('[data-options-open="typography"]').click();
    await page.locator('#font-size-select').selectOption('large');
    await page.locator('#font-family-select').selectOption('jetbrains');
    await page.locator('[data-options-section="typography"] [data-options-back]').click();
    await expect(value('typography')).toHaveAttribute('title', 'Current: Large · JetBrains Mono');

    await expect(value('card-layout')).toHaveAttribute('title', 'Current: Comfortable · Done label');
    await page.locator('[data-options-open="card-layout"]').click();
    await page.locator('.density-option[data-density="compact"]').click();
    await expect(popout(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(value('card-layout')).toHaveAttribute('title', 'Current: Compact · Done label');

    await expect(value('effects')).toHaveAttribute('title', 'Current: Off');
    await page.locator('[data-options-open="effects"]').click();
    await page.locator('label:has(#card-glow-toggle)').click();
    await page.keyboard.press('Escape');
    await expect(value('effects')).toHaveAttribute('title', 'Current: Glow');

    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    const before = (await value('tasks').getAttribute('title'))!;
    const on = Number(before.split(' ')[1]);
    await page.locator('[data-options-open="tasks"]').click();
    await page.locator('label:has(#confetti-toggle)').click();
    await page.keyboard.press('Escape');
    await expect(value('tasks')).not.toHaveAttribute('title', before);
    expect(Math.abs(Number((await value('tasks').getAttribute('title'))!.split(' ')[1]) - on)).toBe(1);

    await page.locator('[data-options-open="general"]').click();
    await page.locator('#startup-view-select').selectOption('today');
    await page.locator('#week-start-select').selectOption('monday');
    await page.keyboard.press('Escape');
    await expect(value('general')).toHaveAttribute('title', 'Current: Today · Mon');
  });

  test('settings switches flip on click and persist', async ({ page }) => {
    await open117(page);
    await openTab(page, 'appearance');
    await page.locator('[data-options-open="effects"]').click();
    const glow = page.locator('#card-glow-toggle');
    expect(await glow.evaluate(el => getComputedStyle(el).appearance)).toBe('none');
    const offBg = await glow.evaluate(el => getComputedStyle(el).backgroundColor);
    await glow.click();
    await expect(glow).toBeChecked();
    await expect.poll(() => glow.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(offBg);
    await page.reload();
    await dismissAuthModal(page);
    await openTab(page, 'appearance');
    await page.locator('[data-options-open="effects"]').click();
    await expect(page.locator('#card-glow-toggle')).toBeChecked();
    await page.locator('#card-glow-toggle').click();
    await expect(page.locator('#card-glow-toggle')).not.toBeChecked();
  });

  test('1.19.0 adds no Options settings, so no New tags show', async ({ page }) => {
    await open117(page);
    await openTab(page, 'appearance');
    await expect(page.locator('[data-options-open="card-layout"] .options-new-tag')).toBeHidden();
    await expect(page.locator('#density-popout .options-new-tag:not([hidden])')).toHaveCount(0);
    await page.locator('[data-options-open="card-layout"]').click();
    for (const id of ['complete-style-select', 'tag-position-select']) {
      await expect(page.locator(`label[for="${id}"] .options-new-tag`)).toBeHidden();
    }
  });
  test('phone: sections and back work in the Options sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open117(page);
    await page.locator('#mobile-menu-btn').click();
    await page.locator('#mobile-menu-options').click();
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await page.locator('#options-pane-behavior [data-options-open="holidays"]').click();
    await expect(popout(page)).toBeVisible();
    await expect(page.locator('#custom-holiday-label')).toBeVisible();
    // The section slides in 14px; measure once it settles
    await expect.poll(async () => {
      const box = (await page.locator('[data-options-section="holidays"]').boundingBox())!;
      return box.x + box.width;
    }).toBeLessThanOrEqual(390);
    await page.locator('[data-options-section="holidays"] [data-options-back]').click();
    await expect(page.locator('#options-pane-behavior .options-summary')).toBeVisible();
    await expect(popout(page)).toBeVisible();
  });
});

test.describe('Options polish 1.17.2', { tag: ['@options'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const popout = (page: Page) => page.locator('#density-popout');
  const value = (page: Page, id: string) => page.locator(`.options-row[data-options-open="${id}"]`);

  async function openSection(page: Page, tab: 'appearance' | 'behavior', id: string) {
    if (!(await popout(page).isVisible())) await page.locator('#density-toggle').click();
    await page.locator(`.options-nav-btn[data-options-tab="${tab}"]`).click();
    await page.locator(`#options-pane-${tab} [data-options-open="${id}"]`).click();
    await expect(page.locator(`[data-options-section="${id}"]`)).toBeVisible();
  }

  // Release-independent: treat the Card layout tags as new in whatever version is running
  const markCardLayoutNew = (page: Page) => page.evaluate(() => {
    document.querySelectorAll('[data-new-in="1.18.0"]').forEach(el => { (el as HTMLElement).dataset.newIn = APP_VERSION; });
    syncNewTags();
  });

  test('New tags stay up while a section is open, then are gone for good (per section)', async ({ page }) => {
    await open117(page);
    await markCardLayoutNew(page);
    const rowTag = page.locator('[data-options-open="card-layout"] .options-new-tag');
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(rowTag).toBeVisible();

    await page.locator('[data-options-open="card-layout"]').click();
    await expect(popout(page)).toBeVisible();
    await expect(page.locator('[data-options-section="card-layout"] .options-new-tag:not([hidden])')).toHaveCount(2);
    await page.locator('[data-options-section="card-layout"] [data-options-back]').click();
    await expect(page.locator('#options-pane-appearance .options-summary')).toBeVisible();
    await expect(rowTag).toBeHidden();

    await page.locator('[data-options-open="card-layout"]').click();
    await expect(page.locator('[data-options-section="card-layout"] .options-new-tag:not([hidden])')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.reload();
    await dismissAuthModal(page);
    await markCardLayoutNew(page);
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(rowTag).toBeHidden();
    const version = await page.evaluate(() => APP_VERSION);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('work-desk-seen-new-tags')))!)).toEqual([`card-layout@${version}`]);
  });

  test('Complete button name stays on one line with its New tag inline', async ({ page }) => {
    await open117(page);
    await markCardLayoutNew(page);
    await openSection(page, 'appearance', 'card-layout');
    const name = page.locator('label[for="complete-style-select"] > span:first-child');
    const tag = name.locator('.options-new-tag');
    const nameBox = (await name.boundingBox())!;
    const tagBox = (await tag.boundingBox())!;
    const lineH = await name.evaluate(el => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3);
    expect(nameBox.height).toBeLessThanOrEqual(lineH + 4);
    expect(tagBox.y).toBeGreaterThanOrEqual(nameBox.y - 1);
    await expect(page.locator('label[for="complete-style-select"] .customize-toggle-sub')).toHaveText("Click a task's left edge to finish it");
  });
  test('row descriptions wrap instead of being cut off, and tooltips carry the current settings', async ({ page }) => {
    await open117(page, { 'work-desk-launch-desk': 'work', 'work-desk-startup-view': 'today', 'work-desk-show-cal-legend': 'false', 'work-desk-show-today-progress': 'false' });
    await page.locator('#density-toggle').click();
    for (const tab of ['appearance', 'behavior'] as const) {
      await page.locator(`.options-nav-btn[data-options-tab="${tab}"]`).click();
      for (const el of await page.locator(`#options-pane-${tab} .options-row-desc`).all()) {
        const clipped = await el.evaluate(e => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis');
        expect(clipped, (await el.textContent()) ?? '').toBe(false);
      }
    }
    await expect(value(page, 'general')).toHaveAttribute('title', 'Current: Work · Today · Sun');
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await expect(value(page, 'layout')).toHaveAttribute('title', 'Current: Sidebar left · No legend · No progress');
  });

  test('calendar legend switch hides and restores the legend (round trip + reset)', async ({ page }) => {
    await open117(page);
    const legend = page.locator('.sidebar-calendar .cal-legend');
    await expect(legend).toBeVisible();
    await openSection(page, 'appearance', 'layout');
    const toggle = page.locator('#show-cal-legend-toggle');
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(popout(page)).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(legend).toBeHidden();
    // The calendar redraws when the month changes; the legend stays hidden
    await page.locator('.sidebar-calendar .cal-nav-btn').last().click();
    await expect(page.locator('.sidebar-calendar .cal-legend')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(value(page, 'layout')).toHaveAttribute('title', 'Current: Sidebar left · No legend');

    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('.sidebar-calendar .cal-legend')).toBeHidden();
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    page.once('dialog', d => d.accept());
    await page.locator('[data-options-reset="appearance"]').click();
    await expect(page.locator('.sidebar-calendar .cal-legend')).toBeVisible();
    await expect(page.locator('#show-cal-legend-toggle')).toBeChecked();
    await expect(value(page, 'layout')).toHaveAttribute('title', 'Current: Sidebar left');
  });

  test("Today's Progress switch hides and restores the sidebar card (round trip)", async ({ page }) => {
    await open117(page);
    const card = page.locator('#sidebar-today-glance');
    await expect(card).toBeVisible();
    await openSection(page, 'appearance', 'layout');
    const toggle = page.locator('#show-today-progress-toggle');
    await toggle.click();
    await expect(popout(page)).toBeVisible();
    await expect(card).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(value(page, 'layout')).toHaveAttribute('title', 'Current: Sidebar left · No progress');

    await page.reload();
    await dismissAuthModal(page);
    await expect(card).toBeHidden();
    await openSection(page, 'appearance', 'layout');
    await page.locator('#show-today-progress-toggle').click();
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('work-desk-show-today-progress'))).toBe('true');
  });

  test('Open desk picks the desk on launch; Last used follows the last one (round trip + reset)', async ({ page }) => {
    await open117(page);
    await expect(page.locator('#context-badge')).toHaveText('Work');
    await openSection(page, 'behavior', 'general');
    const select = page.locator('#launch-desk-select');
    await expect(select).toHaveValue('last');
    await select.selectOption('personal');
    await expect(popout(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(value(page, 'general')).toHaveAttribute('title', 'Current: Personal · Last viewed · Sun');
    await page.keyboard.press('Escape');

    // Still on Work now; next launch opens Personal even after using Work last
    await expect(page.locator('#context-badge')).toHaveText('Work');
    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('#context-badge')).toHaveText('Personal');

    await openSection(page, 'behavior', 'general');
    await page.locator('#launch-desk-select').selectOption('work');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('#context-badge')).toHaveText('Work');

    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    page.once('dialog', d => d.accept());
    await page.locator('[data-options-reset="behavior"]').click();
    await expect(page.locator('#launch-desk-select')).toHaveValue('last');
    await page.keyboard.press('Escape');
    await page.locator('#tab-personal').click();
    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('#context-badge')).toHaveText('Personal');
  });

  test('notes have no 📝 icon and their text starts at the card edge, with or without tags', { tag: '@board' }, async ({ page }) => {
    const note = (id: string, content: string, tags: string[] = []) => ({ id, type: 'note', content, completed: false, shelved: false, boardColumn: 'notes', comments: [], tags, createdAt: '2026-10-13T09:00:00' });
    const task = { ...note('t1', 'A task'), type: 'task', boardColumn: 'new' };
    const items = [task, note('n1', 'Plain note'), note('n2', 'Tagged note', ['ops'])];
    await open117(page, { 'work-desk-data-work': JSON.stringify({ deletedIds: {}, days: { '2026-10-13': { date: '2026-10-13', items } } }) });
    const plain = page.locator('.item-card', { hasText: 'Plain note' });
    const tagged = page.locator('.item-card', { hasText: 'Tagged note' });
    await expect(plain).toBeVisible();
    await expect(page.locator('.note-icon')).toHaveCount(0);
    for (const n of await page.locator('.item.note').all()) await expect(n).not.toContainText('📝');
    for (const card of [plain, tagged]) {
      const row = (await card.locator('.item').boundingBox())!;
      const text = (await card.locator('.item-content').boundingBox())!;
      const padLeft = await card.locator('.item').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
      expect(text.x - row.x).toBeLessThanOrEqual(padLeft + 2);
      // No empty checkbox row above the text
      const padTop = await card.locator('.item').evaluate(el => parseFloat(getComputedStyle(el).paddingTop));
      if (card === plain) expect(text.y - row.y).toBeLessThanOrEqual(padTop + 2);
    }
    await expect(tagged.locator('.tag-chip-row')).toBeVisible();
    // The action row still sits under the text
    const text = (await plain.locator('.item-content').boundingBox())!;
    const edit = (await plain.getByRole('button', { name: 'edit' }).first().boundingBox())!;
    expect(edit.y).toBeGreaterThan(text.y);
  });
});

test.describe('Account menu 1.17.0', { tag: ['@sidebar'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const menu = (page: Page) => page.locator('#account-menu');
  const btn = (page: Page) => page.locator('#account-menu-btn');

  test('the button opens and closes the menu: click, click outside, and Esc', async ({ page }) => {
    await open117(page);
    await expect(menu(page)).toBeHidden();
    await expect(btn(page)).toHaveAttribute('aria-expanded', 'false');
    await btn(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(btn(page)).toHaveAttribute('aria-expanded', 'true');
    for (const id of ['account-menu-options', 'account-menu-help', 'account-menu-whatsnew', 'export-btn', 'import-btn', 'repair-btn', 'version-btn']) {
      await expect(page.locator(`#account-menu #${id}`)).toBeVisible();
    }
    const m = (await menu(page).boundingBox())!;
    expect(m.y).toBeGreaterThanOrEqual(0);
    await btn(page).click();
    await expect(menu(page)).toBeHidden();

    await btn(page).click();
    await page.locator('.date-title').click();
    await expect(menu(page)).toBeHidden();

    await btn(page).click();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await expect(btn(page)).toBeFocused();
    await expect(btn(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('Options opens next to the gear on the Desk and stays open', async ({ page }) => {
    await open117(page);
    await openAccountMenu(page);
    await page.locator('#account-menu-options').click();
    await expect(menu(page)).toBeHidden();
    const popout = page.locator('#density-popout');
    await expect(popout).toBeVisible();
    await expect(popout).not.toHaveClass(/options-floating/);
    expect(await popout.evaluate(el => el.parentElement!.classList.contains('density-wrap'))).toBe(true);
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await expect(popout).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popout).toBeHidden();
  });

  for (const tab of ['insights', 'projects'] as const) {
    test(`Options opens from the menu on ${tab} and returns home when closed`, async ({ page }) => {
      await open117(page);
      await page.locator(`#tab-${tab}`).click();
      await openAccountMenu(page);
      await page.locator('#account-menu-options').click();
      const popout = page.locator('#density-popout');
      await expect(popout).toBeVisible();
      const b = (await popout.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(1440);
      expect(b.y).toBeGreaterThanOrEqual(0);
      await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
      await page.locator('#options-pane-appearance [data-options-open="typography"]').click();
      await expect(popout).toBeVisible();
      await page.locator('#font-size-select').selectOption('large');
      await expect(popout).toBeVisible();
      await page.mouse.click(700, 600);
      await expect(popout).toBeHidden();
      await expect(popout).not.toHaveClass(/options-floating/);
      expect(await popout.evaluate(el => el.parentElement!.classList.contains('density-wrap'))).toBe(true);
    });
  }

  test('Help opens the help modal; What\'s new opens the changelog and clears both dots', async ({ page }) => {
    await open117(page);
    await expect(page.locator('#account-menu-btn-dot')).toBeVisible();
    await openAccountMenu(page);
    await expect(page.locator('#account-menu-new-dot')).toBeVisible();
    await page.locator('#account-menu-help').click();
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('#help-modal')).toBeVisible();
    await expect(page.locator('#help-modal')).toContainText('Today chip');
    await page.locator('#help-modal-close').click();

    await openAccountMenu(page);
    await page.locator('#account-menu-whatsnew').click();
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    const version = await page.evaluate(() => APP_VERSION);
    await expect(page.locator('#changelog-body')).toContainText(`v${version}`);
    await page.locator('#changelog-modal-dismiss').click();
    await expect(page.locator('#account-menu-btn-dot')).toBeHidden();
    await openAccountMenu(page);
    await expect(page.locator('#account-menu-new-dot')).toBeHidden();
  });

  test('Export and Import open inline, keep the menu open, and choosing an option closes it', async ({ page }) => {
    await open117(page);
    await openAccountMenu(page);
    await page.locator('#export-btn').click();
    await expect(page.locator('#export-menu')).toBeVisible();
    await expect(menu(page)).toBeVisible();
    const exp = (await page.locator('#export-menu').boundingBox())!;
    const m = (await menu(page).boundingBox())!;
    expect(exp.y + exp.height).toBeLessThanOrEqual(m.y + m.height);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-all-opt').click()]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    await expect(menu(page)).toBeHidden();

    await openAccountMenu(page);
    await page.locator('#import-btn').click();
    await expect(page.locator('#import-menu')).toBeVisible();
    await expect(page.locator('#export-menu')).toBeHidden();
    await expect(menu(page)).toBeVisible();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#import-desk-opt').click()]);
    expect(chooser).toBeTruthy();
    await expect(menu(page)).toBeHidden();

    // Reopening starts with the dropdowns closed
    await openAccountMenu(page);
    await expect(page.locator('#import-menu')).toBeHidden();
  });

  test('Repair and Sign in close the menu and do their job', async ({ page }) => {
    await open117(page);
    await openAccountMenu(page);
    await page.locator('#repair-btn').click();
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('#toast')).toBeVisible();
    await openAccountMenu(page);
    await expect(page.locator('#sb-signin-btn')).toHaveText('Sign in to sync');
    await page.locator('#sb-signin-btn').click();
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('#auth-modal')).toBeVisible();
  });

  test('the button shows who you are and sync status in words', async ({ page }) => {
    await open117(page);
    await expect(page.locator('#account-email')).toHaveText('Offline Mode');
    await expect(page.locator('#account-sync-text')).toHaveText('This browser only');
    await page.evaluate(() => (window as any).updateAccountChrome('signed-in', 'keith@example.com'));
    await expect(page.locator('#account-email')).toHaveText('keith@example.com');
    for (const [status, text] of [['syncing', 'Syncing…'], ['ok', 'Synced'], ['error', 'Sync error']]) {
      await page.evaluate((s) => (window as any).sbSetStatus(s), status);
      await expect(page.locator('#account-sync-text')).toHaveText(text);
    }
    await openAccountMenu(page);
    await expect(page.locator('#sb-signout-btn')).toBeVisible();
    await expect(page.locator('#sb-signin-btn')).toBeHidden();
  });

  test('collapsed sidebar hides the button; expanding brings it back working', async ({ page }) => {
    await open117(page);
    await page.locator('#sidebar-toggle').click();
    await expect(btn(page)).not.toBeInViewport();
    await page.locator('#sidebar-toggle').click();
    await expect(btn(page)).toBeInViewport();
    await openAccountMenu(page);
    await expect(page.locator('#version-btn')).toBeInViewport();
  });

  test('phone: the sheet shows the account and sign in inline, without the desktop menu items', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open117(page);
    await expect(btn(page)).toBeHidden();
    await page.locator('#mobile-menu-btn').click();
    const sheet = page.locator('#mobile-menu-sheet');
    await expect(sheet.locator('#account-email')).toBeVisible();
    await expect(sheet.locator('#sb-signin-btn')).toBeVisible();
    await expect(sheet.locator('#export-btn')).toBeVisible();
    await expect(sheet.locator('#account-menu-options')).toBeHidden();
    await expect(sheet.locator('#version-btn')).toBeHidden();
    await page.locator('#mobile-menu-close').click();
    await expect(page.locator('#account-menu .sidebar-backup')).toHaveCount(1);
  });
});

test.describe('Calendar 1.17.0', { tag: ['@calendar'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const cal = (page: Page) => page.locator('#sidebar-calendar');
  const chip = (page: Page) => page.locator('#cal-today-chip');
  const next = (page: Page) => cal(page).locator('.cal-nav-btn[aria-label="Next month"]');
  const prev = (page: Page) => cal(page).locator('.cal-nav-btn[aria-label="Previous month"]');
  const colorOf = (loc: ReturnType<Page['locator']>) => loc.evaluate(el => getComputedStyle(el).color);

  test('Today chip appears away from this month and jumps back (DOM replaced on click)', async ({ page }) => {
    await open117(page);
    await expect(chip(page)).toHaveCount(0);
    for (let i = 0; i < 14; i++) await next(page).click();
    await expect(cal(page).locator('.cal-title')).toHaveText('December 2027');
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Today');
    await chip(page).click();
    await expect(cal(page).locator('.cal-title')).toHaveText('October 2026');
    await expect(chip(page)).toHaveCount(0);
    await expect(cal(page).locator('.cal-day.selected')).toHaveText('13');
    await expect(cal(page)).toBeVisible();

    await prev(page).click();
    await expect(chip(page)).toBeVisible();
    await next(page).click();
    await expect(chip(page)).toHaveCount(0);
  });

  test('the legend explains the marks and the calendar stays compact', async ({ page }) => {
    await open117(page);
    const legend = cal(page).locator('.cal-legend');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.cal-legend-item')).toHaveText([/Has items/, /Left open/, /Holiday/]);
    // The sample is a swatch, not a count; real counts only sit on past days with open tasks
    await expect(legend.locator('.cal-legend-badge')).toHaveText('');
    const dot = await legend.locator('.cal-legend-dot').first().boundingBox();
    const sample = await legend.locator('.cal-legend-badge').boundingBox();
    expect(sample!.width).toBeCloseTo(dot!.width, 0);
    expect(sample!.height).toBeCloseTo(dot!.height, 0);
    const realInk = await cal(page).locator('.cal-day-badge').first().evaluate(el => getComputedStyle(el).color);
    expect(await legend.locator('.cal-legend-badge').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(realInk);
    await expect(cal(page).locator('.cal-day-badge')).toHaveText(['2']);
    await expect(cal(page).locator('.cal-day', { has: page.locator('.cal-day-badge') })).toContainText('5');
    const h = (await cal(page).boundingBox())!.height;
    expect(h).toBeLessThan(300);
  });

  test('with nothing left open the calendar shows no counts, only the legend swatch', async ({ page }) => {
    await open117(page, { 'work-desk-data-work': JSON.stringify({ deletedIds: {}, days: {
      '2026-10-05': { date: '2026-10-05', items: [{ id: 'd1', type: 'task', content: 'Finished Monday', completed: true, completedAt: '2026-10-05T12:00:00', shelved: false, boardColumn: 'done', comments: [], tags: [], createdAt: '2026-10-05T09:00:00' }] },
      '2026-10-13': { date: '2026-10-13', items: [{ id: 't1', type: 'task', content: 'Today task', completed: false, shelved: false, boardColumn: 'new', comments: [], tags: [], createdAt: '2026-10-13T09:00:00' }] },
    } }) });
    await expect(cal(page).locator('.cal-legend')).toBeVisible();
    await expect(cal(page).locator('.cal-day-badge')).toHaveCount(0);
    await expect(cal(page).locator('.cal-legend-badge')).toHaveText('');
  });

  test('selected day is a solid theme fill with readable text on light and amber themes', async ({ page }) => {
    await open117(page);
    const sel = cal(page).locator('.cal-day.selected');
    // Relative colors compute to color(srgb …) / lch(…), so resolve them to RGBA through a canvas pixel
    const read = () => sel.evaluate(el => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const rgba = (c: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const lum = (c: string) => {
        const [r, g, b] = rgba(c).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [a, b] = [lum(cs.backgroundColor), lum(cs.color)].sort((x, y) => y - x);
      return { alpha: rgba(cs.backgroundColor)[3] / 255, contrast: (a + 0.05) / (b + 0.05) };
    });
    const light = await read();
    expect(light.alpha).toBe(1);
    expect(light.contrast).toBeGreaterThanOrEqual(3);

    await page.evaluate(() => localStorage.setItem('work-desk-theme', 'flint'));
    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'flint');
    await expect.poll(async () => (await read()).contrast).toBeGreaterThanOrEqual(3);
    expect((await read()).alpha).toBe(1);
  });

  test('left-open badges are amber by default and rose on amber-accent themes', async ({ page }) => {
    await open117(page);
    const badge = cal(page).locator('.cal-day-badge').first();
    await expect(badge).toHaveText('2');
    expect(await colorOf(badge)).toBe('rgb(251, 191, 36)');
    await page.evaluate(() => localStorage.setItem('work-desk-theme', 'flint'));
    await page.reload();
    await dismissAuthModal(page);
    await expect.poll(() => colorOf(cal(page).locator('.cal-day-badge').first())).toBe('rgb(253, 164, 175)');
  });

  test('quieter weekends: Off, Work desk only, and Both desks across Work and Personal', async ({ page }) => {
    await open117(page);
    const sat = () => cal(page).locator('.cal-day.weekend:not(.other-month):not(.selected)').first();
    const weekday = () => cal(page).locator('.cal-day:not(.weekend):not(.other-month):not(.selected):not(.today):not(.holiday)').first();
    const quiet = async () => (await colorOf(sat())) !== (await colorOf(weekday()));
    expect(await quiet()).toBe(false);

    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await page.locator('[data-options-open="general"]').click();
    await page.locator('#quiet-weekends-select').selectOption('work');
    await expect(page.locator('#density-popout')).toBeVisible();
    await expect.poll(quiet).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.options-row[data-options-open="general"]')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator('#tab-personal').click();
    await expect.poll(quiet).toBe(false);
    await page.locator('#tab-work').click();
    await expect.poll(quiet).toBe(true);

    await page.reload();
    await dismissAuthModal(page);
    await expect.poll(quiet).toBe(true);

    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await page.locator('[data-options-open="general"]').click();
    await page.locator('#quiet-weekends-select').selectOption('both');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('#tab-personal').click();
    await expect.poll(quiet).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('work-desk-quiet-weekends'))).toBe('both');

    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await page.locator('[data-options-open="general"]').click();
    await page.locator('#quiet-weekends-select').selectOption('off');
    await expect.poll(quiet).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 1.18.0 complete edge + tag position
// ═══════════════════════════════════════════════════════════════════════
async function open118(page: Page, stored: Record<string, string> = {}) {
  await page.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
  await page.addInitScript((s) => {
    if (localStorage.getItem('v118-seeded')) return;
    localStorage.setItem('v118-seeded', '1');
    const t = (id: string, content: string, extra: Record<string, unknown> = {}) => ({ id, type: 'task', content, completed: false, shelved: false, boardColumn: 'new', comments: [], tags: [], createdAt: '2026-10-13T09:00:00', ...extra });
    localStorage.setItem('work-desk-list-context', 'work');
    localStorage.setItem('work-desk-auto-carry-forward', 'false');
    localStorage.setItem('work-desk-data-work', JSON.stringify({ deletedIds: {}, days: {
      '2026-10-13': { date: '2026-10-13', items: [t('k1', 'Plain task'), t('k2', 'Tagged task', { tags: ['dco', 'q4'] }), t('k3', 'Done task', { completed: true })] },
    } }));
    localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, stored);
  await page.goto(DESK_URL);
  await dismissAuthModal(page);
  await expect(page.locator('.sprint-board')).toBeVisible();
}
const beforeContent = (loc: ReturnType<Page['locator']>) => loc.evaluate(el => getComputedStyle(el, '::before').content);
const taskCard = (page: Page, text: string) => page.locator('.item-card', { hasText: text });

test.describe('Complete edge 1.18.0', { tag: ['@board'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the edge completes and reopens a task: DONE, DONE? on hover, DONE!, UNDO?', async ({ page }) => {
    await open118(page);
    const card = taskCard(page, 'Plain task');
    const edge = card.locator('.complete-edge');
    await expect(edge).toBeVisible();
    await expect(card.locator('.item > .checkbox')).toBeHidden();
    await expect(edge).toHaveAttribute('aria-label', 'Mark complete');
    expect(await beforeContent(edge)).toBe('"done"');
    await edge.hover();
    expect(await beforeContent(edge)).toBe('"done\u200A?"');
    await edge.click();
    const done = page.locator('.board-column.done .item-card', { hasText: 'Plain task' });
    await expect(done.locator('.item.completed')).toBeVisible();
    const doneEdge = done.locator('.complete-edge');
    await expect(doneEdge).toHaveClass(/is-done/);
    await expect(doneEdge).toHaveAttribute('aria-label', 'Mark incomplete');
    await page.mouse.move(5, 5);
    expect(await beforeContent(doneEdge)).toBe('"done\u200A!"');
    await doneEdge.hover();
    expect(await beforeContent(doneEdge)).toBe('"undo\u200A?"');
    await doneEdge.click();
    await expect(page.locator('.board-column.new .item-card', { hasText: 'Plain task' })).toBeVisible();
    await expect(page.locator('.item.completed', { hasText: 'Plain task' })).toHaveCount(0);
  });

  test('keyboard: Enter on the focused edge completes the task', async ({ page }) => {
    await open118(page);
    await taskCard(page, 'Plain task').locator('.complete-edge').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.board-column.done .item.completed', { hasText: 'Plain task' })).toBeVisible();
  });

  test('reads DOING while the card is dragged', async ({ page }) => {
    await open118(page);
    const card = taskCard(page, 'Plain task');
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await card.locator('.item-content').dispatchEvent('dragstart', { dataTransfer: dt });
    await expect(card).toHaveClass(/dragging/);
    expect(await beforeContent(card.locator('.complete-edge'))).toBe('"doing"');
    await card.dispatchEvent('dragend');
    await expect(card).not.toHaveClass(/dragging/);
    expect(await beforeContent(card.locator('.complete-edge'))).toBe('"done"');
  });

  test('a press that moves like a drag does not complete the task', async ({ page }) => {
    await open118(page);
    const card = taskCard(page, 'Plain task');
    const box = (await card.locator('.complete-edge').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect(card.locator('.item.completed')).toHaveCount(0);
    await expect(page.locator('.board-column.new .item-card', { hasText: 'Plain task' })).toBeVisible();
  });

  test('the edge covers the task and action bar, stopping above open comments', async ({ page }) => {
    await open118(page);
    const card = taskCard(page, 'Plain task');
    await card.locator('.card-action', { hasText: /^comment/ }).click();
    await expect(card.locator('.comments-panel')).toBeVisible();
    const edge = (await card.locator('.complete-edge').boundingBox())!;
    const bar = (await card.locator('.card-action-bar').boundingBox())!;
    const panel = (await card.locator('.comments-panel').boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(edge.y - cardBox.y).toBeLessThanOrEqual(2);
    expect(Math.abs(edge.y + edge.height - (bar.y + bar.height))).toBeLessThanOrEqual(1);
    expect(edge.y + edge.height).toBeLessThanOrEqual(panel.y + 1);
    // Text sits clear of the edge
    const text = (await card.locator('.item-content').boundingBox())!;
    expect(text.x).toBeGreaterThanOrEqual(edge.x + edge.width + 6);
  });

  test('compact cards show a bar instead of the label', async ({ page }) => {
    await open118(page, { 'work-desk-density': 'compact' });
    const edge = taskCard(page, 'Plain task').locator('.complete-edge');
    await expect(edge).toBeVisible();
    expect(await beforeContent(edge)).not.toContain('done');
    await edge.click();
    await expect(page.locator('.board-column.done .item.completed', { hasText: 'Plain task' })).toBeVisible();
  });
});

test.describe('Complete edge and tag position on phones 1.18.0', { tag: ['@phone', '@board'] }, () => {
  test.use({ viewport: { width: 390, height: 1200 }, isMobile: true, hasTouch: true });

  test('the edge is 40px wide and a tap completes the task', async ({ page }) => {
    await open118(page);
    const edge = taskCard(page, 'Plain task').locator('.complete-edge');
    expect((await edge.boundingBox())!.width).toBeGreaterThanOrEqual(40);
    await edge.tap();
    await expect(page.locator('.board-column.done .item.completed', { hasText: 'Plain task' })).toBeVisible();
  });

  test('action-bar tags share a right-aligned line with ⋮ when the bar wraps', async ({ page }) => {
    await open118(page, { 'work-desk-tag-position': 'actions' });
    const card = taskCard(page, 'Tagged task');
    const chips = card.locator('.card-action-end > .tag-chip-row');
    await expect(chips).toBeVisible();
    await expect(card.locator('.item .tag-chip-row')).toHaveCount(0);
    const c = (await chips.boundingBox())!;
    const dots = (await card.locator('.card-overflow-btn').boundingBox())!;
    const bar = (await card.locator('.card-action-bar').boundingBox())!;
    const edit = (await card.getByRole('button', { name: 'edit' }).boundingBox())!;
    expect(Math.abs((c.y + c.height / 2) - (dots.y + dots.height / 2))).toBeLessThanOrEqual(4);
    expect(bar.x + bar.width - (dots.x + dots.width)).toBeLessThanOrEqual(16);
    expect(dots.x - (c.x + c.width)).toBeLessThanOrEqual(16);
    expect(c.y).toBeGreaterThan(edit.y + edit.height - 2);
  });
});

test.describe('Card layout options 1.18.0', { tag: ['@options'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const popout = (page: Page) => page.locator('#density-popout');
  const html = (page: Page) => page.locator('html');
  async function openCardLayout(page: Page) {
    if (!(await popout(page).isVisible())) await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await page.locator('#options-pane-appearance [data-options-open="card-layout"]').click();
    await expect(page.locator('[data-options-section="card-layout"]')).toBeVisible();
  }
  async function closeOptions(page: Page) {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(popout(page)).toBeHidden();
  }

  test('Complete button: every style applies, Checkbox brings back the checkbox, and it persists', async ({ page }) => {
    await open118(page);
    await openCardLayout(page);
    await expect(page.locator('[data-options-section="card-layout"] .options-new-tag')).toHaveCount(2);
    const sel = page.locator('#complete-style-select');
    await expect(sel).toHaveValue('label');
    await sel.click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-options-section="card-layout"]')).toBeVisible();
    for (const v of ['bar', 'raised', 'switch', 'circle', 'square', 'diamond', 'check', 'none', 'label']) {
      await sel.selectOption(v);
      await expect(html(page)).toHaveAttribute('data-complete-style', v);
      await expect(html(page)).toHaveAttribute('data-complete-edge', 'on');
      await expect(popout(page)).toBeVisible();
    }
    await sel.selectOption('checkbox');
    await expect(html(page)).toHaveAttribute('data-complete-edge', 'off');
    await page.keyboard.press('Escape');
    await expect(page.locator('.options-row[data-options-open="card-layout"]')).toBeVisible();
    await expect(page.locator('.options-row[data-options-open="card-layout"]')).toHaveAttribute('title', 'Current: Comfortable · Checkbox');
    await page.keyboard.press('Escape');
    await expect(popout(page)).toBeHidden();
    const card = taskCard(page, 'Plain task');
    await expect(card.locator('.complete-edge')).toBeHidden();
    await expect(card.locator('.item > .checkbox')).toBeVisible();
    await card.locator('.item > .checkbox').click();
    await expect(page.locator('.board-column.done .item.completed', { hasText: 'Plain task' })).toBeVisible();
    await page.reload();
    await dismissAuthModal(page);
    await expect(html(page)).toHaveAttribute('data-complete-style', 'checkbox');
    await expect(page.locator('#complete-style-select')).toHaveValue('checkbox');
  });

  test('Tag position: slim keeps text level, action bar moves chips next to ⋮, own row puts them back', async ({ page }) => {
    await open118(page);
    await openCardLayout(page);
    const sel = page.locator('#tag-position-select');
    await expect(sel).toHaveValue('row');
    await sel.click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-options-section="card-layout"]')).toBeVisible();
    const textTop = (text: string) => taskCard(page, text).evaluate(c => Math.round(c.querySelector('.item-content')!.getBoundingClientRect().top - c.getBoundingClientRect().top));

    await sel.selectOption('slim');
    await expect(html(page)).toHaveAttribute('data-tag-position', 'slim');
    expect(await textTop('Plain task')).toBe(await textTop('Tagged task'));
    for (const chip of await taskCard(page, 'Tagged task').locator('.tag-chip').all()) {
      expect((await chip.boundingBox())!.height).toBeLessThanOrEqual(14.5);
    }

    await sel.selectOption('actions');
    await expect(popout(page)).toBeVisible();
    await expect(taskCard(page, 'Tagged task').locator('.card-action-end .tag-chip')).toHaveCount(2);
    await expect(taskCard(page, 'Tagged task').locator('.item .tag-chip')).toHaveCount(0);
    expect(await textTop('Plain task')).toBe(await textTop('Tagged task'));
    await page.keyboard.press('Escape');
    await expect(page.locator('.options-row[data-options-open="card-layout"]')).toBeVisible();
    await expect(page.locator('.options-row[data-options-open="card-layout"]')).toHaveAttribute('title', 'Current: Comfortable · Done label · Tags in bar');
    await page.locator('#options-pane-appearance [data-options-open="card-layout"]').click();

    await page.locator('#tag-position-select').selectOption('row');
    await expect(taskCard(page, 'Tagged task').locator('.item .tag-chip')).toHaveCount(2);
    await expect(taskCard(page, 'Tagged task').locator('.card-action-end .tag-chip')).toHaveCount(0);
    expect(await textTop('Tagged task')).toBeGreaterThan(await textTop('Plain task'));

    // Chips in the action bar keep working: × removes the tag
    await page.locator('#tag-position-select').selectOption('actions');
    await closeOptions(page);
    await taskCard(page, 'Tagged task').locator('.card-action-end .tag-chip-remove').first().click();
    await expect(taskCard(page, 'Tagged task').locator('.tag-chip')).toHaveCount(1);
    await page.reload();
    await dismissAuthModal(page);
    await expect(html(page)).toHaveAttribute('data-tag-position', 'actions');
    await expect(taskCard(page, 'Tagged task').locator('.card-action-end .tag-chip')).toHaveCount(1);
  });

  test('Reset Appearance restores the "Done" label and tags on their own row', async ({ page }) => {
    await open118(page, { 'work-desk-complete-style': 'switch', 'work-desk-tag-position': 'actions' });
    await expect(html(page)).toHaveAttribute('data-complete-style', 'switch');
    await expect(taskCard(page, 'Tagged task').locator('.card-action-end .tag-chip')).toHaveCount(2);
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    page.once('dialog', d => d.accept());
    await page.locator('[data-options-reset="appearance"]').click();
    await expect(page.locator('#complete-style-select')).toHaveValue('label');
    await expect(page.locator('#tag-position-select')).toHaveValue('row');
    await expect(html(page)).toHaveAttribute('data-complete-style', 'label');
    await expect(html(page)).toHaveAttribute('data-tag-position', 'row');
    await expect(taskCard(page, 'Tagged task').locator('.item .tag-chip')).toHaveCount(2);
    await expect(page.locator('.options-row[data-options-open="card-layout"]')).toHaveAttribute('title', 'Current: Comfortable · Done label');
  });
});

test.describe('Options list 1.18.2', { tag: ['@options'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const popout = (page: Page) => page.locator('#density-popout');
  const SECTIONS = {
    appearance: ['card-layout', 'typography', 'layout', 'effects', 'background', 'tags'],
    behavior: ['general', 'tasks', 'projects', 'insights', 'holidays'],
  } as const;

  test('every section says ‹ Back and the title never runs into it', async ({ page }) => {
    await open117(page);
    await page.locator('#density-toggle').click();
    for (const tab of ['appearance', 'behavior'] as const) {
      await page.locator(`.options-nav-btn[data-options-tab="${tab}"]`).click();
      for (const id of SECTIONS[tab]) {
        await page.locator(`#options-pane-${tab} [data-options-open="${id}"]`).click();
        const section = page.locator(`[data-options-section="${id}"]`);
        const back = section.locator('[data-options-back]');
        await expect(back).toHaveText('‹ Back');
        const backRight = (await back.boundingBox())!.x + (await back.boundingBox())!.width;
        const titleLeft = await section.locator('.options-section-title').evaluate(el => {
          const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().left;
        });
        expect(titleLeft - backRight, id).toBeGreaterThanOrEqual(8);
        await back.click();
        await expect(popout(page)).toBeVisible();
        await expect(page.locator(`#options-pane-${tab} .options-summary`)).toBeVisible();
      }
    }
  });

  test('settings inside a section get space and a faint divider, except the first one', async ({ page }) => {
    await open117(page);
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await page.locator('[data-options-open="card-layout"]').click();
    const rows = page.locator('[data-options-section="card-layout"] > .customize-select-row');
    await expect(rows).toHaveCount(2);
    expect(await rows.nth(0).evaluate(el => getComputedStyle(el, '::before').height)).toBe('1px');
    expect(await rows.nth(1).evaluate(el => getComputedStyle(el, '::before').height)).toBe('1px');
    const group = (await page.locator('[data-options-section="card-layout"] .density-option-group').boundingBox())!;
    const first = (await rows.nth(0).boundingBox())!;
    expect(first.y - (group.y + group.height)).toBeGreaterThanOrEqual(8);

    await page.keyboard.press('Escape');
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await page.locator('[data-options-open="tasks"]').click();
    const toggles = page.locator('[data-options-section="tasks"] > .customize-toggle');
    expect(await toggles.nth(0).evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
    expect(await toggles.nth(1).evaluate(el => getComputedStyle(el, '::before').height)).toBe('1px');
    // Collapse after belongs to Auto-collapse, so no divider splits them
    expect(await page.locator('[data-options-section="tasks"] > .customize-threshold-row').evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
  });

  test('rows describe what is inside; the tooltip follows a change (round trip)', async ({ page }) => {
    await open117(page);
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    const row = page.locator('.options-row[data-options-open="card-layout"]');
    await expect(row.locator('.options-row-desc')).toHaveText('Density, complete button, tag spot');
    await expect(row.locator('.options-row-value')).toHaveCount(0);
    await expect(row).toHaveAttribute('title', 'Current: Comfortable · Done label');
    await row.click();
    await page.locator('#tag-position-select').selectOption('slim');
    await page.locator('[data-options-section="card-layout"] [data-options-back]').click();
    await expect(row).toHaveAttribute('title', 'Current: Comfortable · Done label · Slim tags');
    await row.click();
    await page.locator('#tag-position-select').selectOption('row');
    await page.locator('[data-options-section="card-layout"] [data-options-back]').click();
    await expect(row).toHaveAttribute('title', 'Current: Comfortable · Done label');

    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    await expect(page.locator('.options-row[data-options-open="tasks"] .options-row-desc')).toHaveText('Delete, carry-forward, collapse, confetti');
  });

  test('phone: descriptions and ‹ Back fit the Options sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open117(page);
    await page.locator('#mobile-menu-btn').click();
    await page.locator('#mobile-menu-options').click();
    await page.locator('.options-nav-btn[data-options-tab="behavior"]').click();
    const desc = page.locator('.options-row[data-options-open="general"] .options-row-desc');
    await expect(desc).toBeVisible();
    expect((await desc.boundingBox())!.x + (await desc.boundingBox())!.width).toBeLessThanOrEqual(390);
    await page.locator('[data-options-open="general"]').click();
    await expect(page.locator('[data-options-section="general"] [data-options-back]')).toHaveText('‹ Back');
    await page.locator('[data-options-section="general"] [data-options-back]').click();
    await expect(page.locator('#options-pane-behavior .options-summary')).toBeVisible();
    await expect(popout(page)).toBeVisible();
  });
});

test.describe('Expanded Completed list scrolling 1.18.2', { tag: ['@board'] }, () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the board scrolls on its own layer and expanded completed cards stay in place', async ({ page }) => {
    const today = '2026-10-15';
    const task = (id: string, content: string, extra: Record<string, unknown> = {}) => ({ id, type: 'task', content, completed: false, shelved: false, boardColumn: 'new', comments: [], tags: [], createdAt: `${today}T09:00:00`, ...extra });
    const items = [
      ...Array.from({ length: 6 }, (_, i) => task(`n${i}`, `New task ${i}`)),
      ...Array.from({ length: 7 }, (_, i) => task(`d${i}`, i % 2 ? `Done task ${i} with a longer title that wraps to two lines` : `Done task ${i}`, { completed: true, completedAt: `${today}T1${i}:00:00`, boardColumn: 'done' })),
    ];
    await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
    await page.addInitScript((d) => {
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-auto-carry-forward', 'false');
      localStorage.setItem('work-desk-bg-pattern-on', 'true');
      localStorage.setItem('work-desk-bg-pattern', 'basketweave');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ deletedIds: {}, days: { [d.today]: { date: d.today, items: d.items } } }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    }, { today, items });
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await expect(page.locator('main.main')).toHaveCSS('will-change', 'scroll-position');

    const label = page.locator('.board-column.done .col-subsection-label.collapsible');
    await expect(label).toHaveAttribute('aria-expanded', 'false');
    await label.click();
    await expect(label).toHaveAttribute('aria-expanded', 'true');
    const cards = page.locator('.board-column.done .item-card');
    await expect(cards).toHaveCount(7);

    const read = () => page.evaluate(() => ({
      st: document.querySelector('main.main')!.scrollTop,
      tops: [...document.querySelectorAll('.board-column.done .item-card')].map(el => { const r = el.getBoundingClientRect(); return [r.top, r.bottom]; }),
    }));
    let prev = await read();
    await page.mouse.move(1100, 400);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 40);
      await page.waitForTimeout(30);
      const now = await read();
      const d = now.st - prev.st;
      now.tops.forEach(([top], k) => expect(Math.abs(prev.tops[k][0] - top - d)).toBeLessThan(0.6));
      now.tops.slice(1).forEach(([top], k) => expect(top).toBeGreaterThanOrEqual(now.tops[k][1] - 0.5));
      prev = now;
    }
    expect(prev.st).toBeGreaterThan(0);
  });
});

test.describe('Complete edge on project tasks 1.18.4', { tag: ['@projects', '@board'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openProjectTasks(page: Page, stored: Record<string, string> = {}) {
    await page.addInitScript((s) => {
      if (localStorage.getItem('v1184-seeded')) return;
      localStorage.setItem('v1184-seeded', '1');
      const t = (id: string, content: string, extra: Record<string, unknown> = {}) => ({ id, type: 'task', content, completed: false, archived: false, comments: [], createdAt: '2026-10-13T09:00:00', ...extra });
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-projects', JSON.stringify({ deletedIds: {}, projects: [
        { id: 'p1', name: 'Edge Project', createdAt: '2026-10-13T09:00:00', notes: [], tasks: [
          t('pt1', 'Open project task'),
          t('pt2', 'Commented project task', { comments: [{ id: 'c1', text: 'Waiting on vendor', createdAt: '2026-10-13T09:30:00' }] }),
        ] },
      ] }));
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, stored);
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await page.locator('#tab-projects').click();
    await page.locator('.project-list-item', { hasText: 'Edge Project' }).click();
    await page.locator('.project-tab-btn[data-project-tab="tasks"]').click();
    await expect(page.locator('#project-detail')).toBeVisible();
  }
  const projectTask = (page: Page, text: string) => page.locator('.project-task-card', { hasText: text });

  test('the edge completes a project task into Archived, and reopens it there', async ({ page }) => {
    await openProjectTasks(page);
    const card = projectTask(page, 'Open project task');
    const edge = card.locator('.complete-edge');
    await expect(edge).toBeVisible();
    await expect(card.locator('.project-task-check')).toBeHidden();
    await expect(edge).toHaveAttribute('aria-label', 'Mark complete');
    expect(await beforeContent(edge)).toBe('"done"');
    await edge.hover();
    expect(await beforeContent(edge)).toBe('"done\u200A?"');
    await edge.click();

    await expect(page.locator('#project-detail')).toBeVisible();
    await expect(page.locator('#project-tasks-list .project-task-card', { hasText: 'Open project task' })).toHaveCount(0);
    await page.locator('.project-archive-toggle').click();
    const archived = page.locator('#project-tasks-archive-wrap .project-task-card', { hasText: 'Open project task' });
    await expect(archived).toBeVisible();
    await expect(archived.locator('.project-task-text')).toHaveClass(/completed/);
    const doneEdge = archived.locator('.complete-edge');
    await expect(doneEdge).toHaveClass(/is-done/);
    await expect(doneEdge).toHaveAttribute('aria-label', 'Mark incomplete');

    await doneEdge.click();
    await expect(page.locator('#project-detail')).toBeVisible();
    const reopened = page.locator('#project-tasks-list .project-task-card', { hasText: 'Open project task' });
    await expect(reopened.locator('.project-task-text')).not.toHaveClass(/completed/);
    await expect(reopened.locator('.complete-edge')).not.toHaveClass(/is-done/);
    await expect(page.locator('#project-tasks-archive-wrap .project-task-card', { hasText: 'Open project task' })).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-projects')!).projects[0].tasks.find((t: { id: string }) => t.id === 'pt1'));
    expect(saved.completed).toBe(false);
    expect(saved.archived).toBe(false);
  });

  test('keyboard: Enter on the focused edge completes the project task', async ({ page }) => {
    await openProjectTasks(page);
    await projectTask(page, 'Open project task').locator('.complete-edge').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#project-tasks-list .project-task-card', { hasText: 'Open project task' })).toHaveCount(0);
    await expect(page.locator('.project-archive-toggle')).toContainText('Archived (1)');
  });

  test('a press that moves like a drag does not complete the project task', async ({ page }) => {
    await openProjectTasks(page);
    const card = projectTask(page, 'Open project task');
    const box = (await card.locator('.complete-edge').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#project-tasks-list .project-task-card', { hasText: 'Open project task' })).toBeVisible();
    await expect(card.locator('.project-task-text')).not.toHaveClass(/completed/);
  });

  test('the edge spans the whole card, comments included, and text clears it', async ({ page }) => {
    await openProjectTasks(page);
    const card = projectTask(page, 'Commented project task');
    const cardBox = (await card.boundingBox())!;
    const edgeBox = (await card.locator('.complete-edge').boundingBox())!;
    expect(Math.abs(edgeBox.y - (cardBox.y + 1))).toBeLessThan(1.5);
    expect(Math.abs(edgeBox.y + edgeBox.height - (cardBox.y + cardBox.height - 1))).toBeLessThan(1.5);
    expect(edgeBox.width).toBe(18);
    const textBox = (await card.locator('.project-task-text').boundingBox())!;
    expect(textBox.x).toBeGreaterThan(edgeBox.x + edgeBox.width + 6);
  });

  test('Checkbox style keeps the project checkbox, which still completes the task', async ({ page }) => {
    await openProjectTasks(page, { 'work-desk-complete-style': 'checkbox' });
    const card = projectTask(page, 'Open project task');
    await expect(card.locator('.complete-edge')).toBeHidden();
    const check = card.locator('.project-task-check');
    await expect(check).toBeVisible();
    await check.click();
    await expect(page.locator('#project-tasks-list .project-task-card', { hasText: 'Open project task' })).toHaveCount(0);
    await expect(page.locator('.project-archive-toggle')).toContainText('Archived (1)');
  });

  test('switching the Complete button style in Options updates project cards live', async ({ page }) => {
    await openProjectTasks(page);
    const card = projectTask(page, 'Open project task');
    await openAccountMenu(page);
    await page.locator('#account-menu-options').click();
    await expect(page.locator('#density-popout')).toBeVisible();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
    await openOptionsSectionFor(page, '#complete-style-select');
    await page.locator('#complete-style-select').selectOption('checkbox');
    await expect(page.locator('#density-popout')).toBeVisible();
    await expect(card.locator('.project-task-check')).toBeVisible();
    await expect(card.locator('.complete-edge')).toBeHidden();
    await page.locator('#complete-style-select').selectOption('circle');
    await expect(card.locator('.complete-edge')).toBeVisible();
    await expect(card.locator('.project-task-check')).toBeHidden();
  });
});

test.describe('Project header and backup import 1.18.4', { tag: ['@projects'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openSeededProject(page: Page) {
    await page.addInitScript(() => {
      if (localStorage.getItem('v1184h-seeded')) return;
      localStorage.setItem('v1184h-seeded', '1');
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-projects', JSON.stringify({ deletedIds: {}, projects: [
        { id: 'p1', name: 'Header Project', createdAt: '2026-10-13T09:00:00', notes: [], tasks: [] },
      ] }));
    });
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await page.locator('#tab-projects').click();
    await page.locator('.project-list-item', { hasText: 'Header Project' }).click();
    await expect(page.locator('#project-title')).toHaveText('Header Project');
  }

  const backup = JSON.stringify({ type: 'projects', context: 'projects', projects: [
    { id: 'imp1', name: 'Imported Project', createdAt: '2026-10-01T09:00:00', notes: [
      { id: 'in1', type: 'note', content: 'Live note', createdAt: '2026-10-01T09:00:00', comments: [] },
      { id: 'in2', type: 'note', content: 'Archived note', createdAt: '2026-10-01T09:00:00', archived: true, comments: [] },
    ], tasks: [
      { id: 'it1', type: 'task', content: 'Open imported task', completed: false, createdAt: '2026-10-01T09:00:00', comments: [] },
      { id: 'it2', type: 'task', content: 'Finished imported task', completed: true, archived: true, createdAt: '2026-10-01T09:00:00', comments: [] },
    ] },
  ] });

  test('Rename and Delete are text buttons that still rename and delete the project', async ({ page }) => {
    await openSeededProject(page);
    const rename = page.locator('#project-rename-btn');
    const del = page.locator('#project-delete-btn');
    await expect(rename).toHaveText('Rename');
    await expect(del).toHaveText('Delete');
    const gear = (await page.locator('#project-customize-btn').boundingBox())!;
    for (const btn of [rename, del]) expect((await btn.boundingBox())!.height).toBeCloseTo(gear.height, 0);

    page.once('dialog', d => d.accept('Renamed Project'));
    await rename.click();
    await expect(page.locator('#project-title')).toHaveText('Renamed Project');

    await del.hover();
    await expect(del).toHaveCSS('color', 'rgb(239, 68, 68)');
    page.once('dialog', d => d.accept());
    await del.click();
    await expect(page.locator('.project-list-item', { hasText: 'Renamed Project' })).toHaveCount(0);
  });

  for (const mode of ['replace', 'merge'] as const) {
    test(`importing a projects backup (${mode}) keeps archived notes and tasks in Archived`, async ({ page }) => {
      await openSeededProject(page);
      page.on('dialog', d => d.accept());
      await page.locator('#import-file').setInputFiles({ name: 'work-desk-backup-projects.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
      await expect(page.locator('#import-modal')).toBeVisible();
      await page.locator(`#import-${mode}`).click();
      await expect(page.locator('#import-modal')).toBeHidden();

      await page.locator('.project-list-item', { hasText: 'Imported Project' }).click();
      await expect(page.locator('#project-notes-list .project-item-card', { hasText: 'Live note' })).toBeVisible();
      await expect(page.locator('#project-notes-list .project-item-card', { hasText: 'Archived note' })).toHaveCount(0);
      await expect(page.locator('#project-notes-archive-wrap .project-archive-toggle')).toContainText('Archived (1)');

      await page.locator('.project-tab-btn[data-project-tab="tasks"]').click();
      await expect(page.locator('#project-tasks-list .project-task-card', { hasText: 'Open imported task' })).toBeVisible();
      await expect(page.locator('#project-tasks-list .project-task-card', { hasText: 'Finished imported task' })).toHaveCount(0);
      await page.locator('#project-tasks-archive-wrap .project-archive-toggle').click();
      const finished = page.locator('#project-tasks-archive-wrap .project-task-card', { hasText: 'Finished imported task' });
      await expect(finished).toBeVisible();
      await expect(finished.locator('.complete-edge')).toHaveClass(/is-done/);
    });
  }
});

test.describe('Complete edge on project tasks, touch 1.18.4', { tag: ['@projects', '@phone'] }, () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the edge is wider on touch screens and a tap completes the task', async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem('v1184t-seeded')) return;
      localStorage.setItem('v1184t-seeded', '1');
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-projects', JSON.stringify({ deletedIds: {}, projects: [
        { id: 'p1', name: 'Phone Project', createdAt: '2026-10-13T09:00:00', notes: [], tasks: [
          { id: 'pt1', type: 'task', content: 'Tap me done', completed: false, archived: false, comments: [], createdAt: '2026-10-13T09:00:00' },
        ] },
      ] }));
    });
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await page.locator('#tab-projects').click();
    await page.locator('.project-list-item', { hasText: 'Phone Project' }).click();
    await page.locator('.project-tab-btn[data-project-tab="tasks"]').click();
    const edge = page.locator('.project-task-card', { hasText: 'Tap me done' }).locator('.complete-edge');
    expect((await edge.boundingBox())!.width).toBe(40);
    await edge.tap();
    await expect(page.locator('#project-tasks-list .project-task-card', { hasText: 'Tap me done' })).toHaveCount(0);
    await expect(page.locator('.project-archive-toggle')).toContainText('Archived (1)');
  });
});

async function seedProjectSpace(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('v119-seeded')) return;
    localStorage.setItem('v119-seeded', '1');
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const at = `${today}T09:00:00.000Z`;
    localStorage.setItem('work-desk-list-context', 'work');
    localStorage.setItem('work-desk-data-work', JSON.stringify({ deletedIds: {}, days: { [today]: { date: today, items: [
      { id: 'd1', type: 'task', content: 'Desk task to send', completed: false, shelved: false, boardColumn: 'new', createdAt: at, tags: ['q4'],
        comments: [{ id: 'dc1', content: 'desk <b>comment</b>', createdAt: at }] },
      { id: 'd2', type: 'note', content: 'Desk note to send', completed: false, createdAt: at },
    ] } } }));
    localStorage.setItem('work-desk-data-personal', JSON.stringify({ days: {}, deletedIds: {} }));
    localStorage.setItem('work-desk-projects', JSON.stringify({ deletedIds: {}, projects: [
      { id: 'p1', name: 'Alpha Project', createdAt: '2026-10-01T09:00:00', notes: [
        { id: 'pn1', type: 'note', content: 'Alpha note', createdAt: '2026-10-02T09:00:00', tags: ['ops'], comments: [{ id: 'pc1', text: 'note comment', createdAt: '2026-10-02T10:00:00' }] },
      ], tasks: [
        { id: 'pt1', type: 'task', content: 'Alpha task', completed: false, createdAt: '2026-10-03T09:00:00', comments: [{ id: 'pc2', text: 'line one\nline two', createdAt: '2026-10-03T10:00:00' }] },
        { id: 'pt2', type: 'task', content: 'Finished alpha task', completed: true, archived: true, createdAt: '2026-10-04T09:00:00', comments: [] },
      ] },
      { id: 'p2', name: 'Beta Project', createdAt: '2026-10-01T09:00:00', notes: [
        { id: 'pn2', type: 'note', content: 'Shelved beta note', archived: true, createdAt: '2026-10-01T09:00:00', comments: [] },
      ], tasks: [] },
      { id: 'p3', name: 'Gamma Project', createdAt: '2026-10-01T09:00:00', notes: [], tasks: [] },
    ] }));
  });
  await page.goto(DESK_URL);
  await dismissAuthModal(page);
}

async function openSeededProjectTab(page: Page, name: string, tab: 'notes' | 'tasks') {
  await page.locator('#tab-projects').click();
  await page.locator('.project-list-item', { hasText: name }).click();
  await expect(page.locator('#project-title')).toHaveText(name);
  await page.locator(`.project-tab-btn[data-project-tab="${tab}"]`).click();
}

const storedProjects = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-projects')!));
const projectCard = (page: Page, text: string) => page.locator(':is(#project-notes-list, #project-tasks-list) .project-item-card', { hasText: text });
const cardButton = (card: Locator, name: string) => card.locator('.project-item-actions').getByRole('button', { name, exact: true });

test.describe('Project list counts 1.18.4', { tag: ['@projects'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('each project shows open tasks and active notes, or archived / empty', async ({ page }) => {
    await seedProjectSpace(page);
    await page.locator('#tab-projects').click();
    const meta = (name: string) => page.locator('.project-list-item', { hasText: name }).locator('.project-list-meta');
    await expect(meta('Alpha Project')).toHaveText('1 open task · 1 note');
    await expect(meta('Beta Project')).toHaveText('1 archived');
    await expect(meta('Gamma Project')).toHaveText('Empty');

    await page.locator('.project-list-item', { hasText: 'Alpha Project' }).click();
    await page.locator('.project-tab-btn[data-project-tab="tasks"]').click();
    await projectCard(page, 'Alpha task').locator('.complete-edge').click();
    await expect(meta('Alpha Project')).toHaveText('1 note');
  });
});

test.describe('Project fixes 1.18.4', { tag: ['@projects'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('comment edit/delete appear on hover with a mouse', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    const row = projectCard(page, 'Alpha note').locator('.project-comment-row');
    const actions = row.locator('.project-comment-actions');
    await expect(actions).toHaveCSS('opacity', '0');
    await row.hover();
    await expect(actions).toHaveCSS('opacity', '1');
    await actions.getByRole('button', { name: 'edit', exact: true }).click();
    await expect(projectCard(page, 'Alpha note').locator('.project-comment-row')).toHaveCount(0);
  });

  test('a deleted project is not brought back by a Replace import of an older backup', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Gamma Project', 'notes');
    page.on('dialog', d => d.accept());
    await page.locator('#project-delete-btn').click();
    await expect(page.locator('.project-list-item', { hasText: 'Gamma Project' })).toHaveCount(0);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    await cardButton(projectCard(page, 'Alpha note'), 'delete').click();
    await expect(projectCard(page, 'Alpha note')).toHaveCount(0);

    const before = await storedProjects(page);
    const old = JSON.stringify({ type: 'projects', context: 'projects', projects: [
      { id: 'p1', name: 'Alpha Project', createdAt: '2026-10-01T09:00:00', notes: [
        { id: 'pn1', type: 'note', content: 'Alpha note', createdAt: '2026-10-02T09:00:00', comments: [] },
      ], tasks: [] },
      { id: 'p3', name: 'Gamma Project', createdAt: '2026-10-01T09:00:00', notes: [], tasks: [] },
    ] });
    await page.locator('#import-file').setInputFiles({ name: 'work-desk-backup-projects.json', mimeType: 'application/json', buffer: Buffer.from(old) });
    await page.locator('#import-replace').click();
    await expect(page.locator('#import-modal')).toBeHidden();
    await expect(page.locator('.project-list-item', { hasText: 'Gamma Project' })).toHaveCount(0);
    await page.locator('.project-list-item', { hasText: 'Alpha Project' }).click();
    await expect(projectCard(page, 'Alpha note')).toHaveCount(0);
    const after = await storedProjects(page);
    expect(after.projects.map((p: { id: string }) => p.id)).toEqual(['p1']);
    expect(Object.keys(after.deletedIds)).toEqual(expect.arrayContaining(Object.keys(before.deletedIds)));
  });
});

test.describe('Project comment actions, touch 1.18.4', { tag: ['@projects', '@phone'] }, () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('comment edit/delete are visible without hovering', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    const actions = projectCard(page, 'Alpha note').locator('.project-comment-actions');
    await expect(actions).toHaveCSS('opacity', '1');
    page.once('dialog', d => d.accept());
    await actions.getByRole('button', { name: 'delete', exact: true }).tap();
    await expect(projectCard(page, 'Alpha note').locator('.project-comment-row')).toHaveCount(0);
  });
});

test.describe('Project tags 1.19.0', { tag: ['@projects', '@tags'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('tag button: suggestion, typed tag, Escape, outside click, remove ×, and reload', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    const card = projectCard(page, 'Alpha note');
    const chips = card.locator('.project-tag-row .tag-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText(/ops/i);

    await cardButton(card, 'tag').click();
    const input = card.locator('.tag-input-inline');
    await expect(input).toBeFocused();
    const pick = card.locator('.tag-suggestion', { hasText: 'q4' });
    await expect(pick).toBeVisible();
    await expect(card.locator('.tag-suggestion', { hasText: 'ops' })).toHaveCount(0);
    await pick.click();
    await expect(page.locator('#project-detail')).toBeVisible();
    await expect(card.locator('.tag-input-inline')).toHaveCount(0);
    await expect(chips).toHaveCount(2);

    await cardButton(card, 'tag').click();
    await card.locator('.tag-input-inline').fill('Launch');
    await card.locator('.tag-input-inline').press('Enter');
    await expect(chips).toHaveCount(3);
    await expect(card.locator('.tag-input-inline')).toHaveCount(0);

    await cardButton(card, 'tag').click();
    await card.locator('.tag-input-inline').press('Escape');
    await expect(card.locator('.tag-input-inline')).toHaveCount(0);

    await cardButton(card, 'tag').click();
    await expect(card.locator('.tag-input-inline')).toBeVisible();
    await page.locator('#project-title').click();
    await expect(card.locator('.tag-input-inline')).toHaveCount(0);

    await card.locator('.project-tag-row .tag-chip', { hasText: /ops/i }).locator('.tag-chip-remove').click();
    await expect(chips).toHaveCount(2);

    await page.reload();
    await dismissAuthModal(page);
    const saved = (await storedProjects(page)).projects[0].notes[0];
    expect(saved.tags).toEqual(['q4', 'launch']);
  });

  test('typing #word while editing a project task turns it into a tag', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'tasks');
    const card = projectCard(page, 'Alpha task');
    await cardButton(card, 'edit').click();
    const editor = page.locator('#project-tasks-list .project-item-editor');
    await editor.click();
    await page.keyboard.press('End');
    await editor.pressSequentially(' #urgent', { delay: 10 });
    await page.locator('#project-tasks-list button', { hasText: 'Save' }).click();
    await expect(card.locator('.project-task-text')).toHaveText('Alpha task');
    await expect(card.locator('.project-tag-row .tag-chip')).toContainText(/urgent/i);
  });
});

test.describe('Send between desk and projects 1.19.0', { tag: ['@projects', '@board'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const deskCard = (page: Page, text: string) => page.locator('.item-card', { hasText: text });
  const sendOption = (page: Page, name: string) => page.locator('#send-modal .send-option', { hasText: name });

  async function openSendToProject(page: Page, text: string) {
    const card = deskCard(page, text);
    await card.locator('.card-overflow-btn').click();
    await card.locator('.card-overflow-menu button', { hasText: 'Send to project…' }).click();
    await expect(page.locator('#send-modal')).toBeVisible();
  }

  test('desk ⋮ Send to project… lists projects; Cancel and Escape change nothing', async ({ page }) => {
    await seedProjectSpace(page);
    await openSendToProject(page, 'Desk task to send');
    await expect(page.locator('#send-modal-text')).toContainText('Move this task to a project: "Desk task to send"');
    await expect(page.locator('#send-modal .send-option-name')).toHaveText(['Alpha Project', 'Beta Project', 'Gamma Project', '+ New project…']);
    await expect(sendOption(page, 'Alpha Project').locator('.send-option-sub')).toHaveText('1 open task · 1 note');
    await page.locator('#send-modal-cancel').click();
    await expect(page.locator('#send-modal')).toBeHidden();

    await openSendToProject(page, 'Desk task to send');
    await page.keyboard.press('Escape');
    await expect(page.locator('#send-modal')).toBeHidden();
    await expect(deskCard(page, 'Desk task to send')).toBeVisible();
  });

  test('sending a desk task to a project moves it with comments and tags; Undo brings it back', async ({ page }) => {
    await seedProjectSpace(page);
    await openSendToProject(page, 'Desk task to send');
    await sendOption(page, 'Alpha Project').click();
    await expect(page.locator('#send-modal')).toBeHidden();
    await expect(deskCard(page, 'Desk task to send')).toHaveCount(0);
    await expect(page.getByText('Sent to Alpha Project')).toBeVisible();
    await page.locator('.toast-undo-btn').click();
    await expect(deskCard(page, 'Desk task to send')).toBeVisible();
    let projects = await storedProjects(page);
    expect(projects.projects[0].tasks.map((t: { content: string }) => t.content)).not.toContain('Desk task to send');

    await openSendToProject(page, 'Desk task to send');
    await sendOption(page, 'Alpha Project').click();
    await expect(deskCard(page, 'Desk task to send')).toHaveCount(0);
    const work = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-data-work')!));
    expect(work.deletedIds.d1).toBeTruthy();

    await openSeededProjectTab(page, 'Alpha Project', 'tasks');
    const moved = projectCard(page, 'Desk task to send');
    await expect(moved).toBeVisible();
    await expect(moved.locator('.project-tag-row .tag-chip')).toContainText(/q4/i);
    await expect(moved).toContainText('desk comment');
    projects = await storedProjects(page);
    const task = projects.projects[0].tasks.find((t: { content: string }) => t.content === 'Desk task to send');
    expect(task.comments[0].text).toBe('desk comment');
  });

  test('+ New project… creates the project and sends the note there', async ({ page }) => {
    await seedProjectSpace(page);
    await openSendToProject(page, 'Desk note to send');
    await expect(page.locator('#send-modal-text')).toContainText('Move this note to a project');
    page.once('dialog', d => d.accept('Fresh Project'));
    await sendOption(page, '+ New project…').click();
    await expect(page.locator('#send-modal')).toBeHidden();
    await expect(deskCard(page, 'Desk note to send')).toHaveCount(0);
    await openSeededProjectTab(page, 'Fresh Project', 'notes');
    await expect(projectCard(page, 'Desk note to send')).toBeVisible();
  });

  test('to desk on a project task moves it to today on the chosen desk; Undo puts it back', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'tasks');
    await cardButton(projectCard(page, 'Alpha task'), 'to desk').click();
    await expect(page.locator('#send-modal')).toBeVisible();
    await expect(page.locator('#send-modal-text')).toContainText('Move this task to a desk: "Alpha task"');
    await expect(page.locator('#send-modal-date')).toBeVisible();
    await expect(page.locator('#send-modal .send-option-sub')).toHaveText(['Today', 'Today']);
    await expect(page.locator('#send-modal .send-option-name')).toHaveText(['Work desk', 'Personal desk']);
    await page.locator('#send-modal-cancel').click();
    await expect(page.locator('#send-modal')).toBeHidden();

    await cardButton(projectCard(page, 'Alpha task'), 'to desk').click();
    await sendOption(page, 'Personal desk').click();
    await expect(page.locator('#send-modal')).toBeHidden();
    await expect(projectCard(page, 'Alpha task')).toHaveCount(0);
    await expect(page.getByText('Sent to Personal desk · today')).toBeVisible();
    await page.locator('.toast-undo-btn').click();
    await expect(projectCard(page, 'Alpha task')).toBeVisible();
    const personal = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-data-personal')!));
    expect(Object.values(personal.days).flatMap((d: any) => d.items)).toHaveLength(0);

    await cardButton(projectCard(page, 'Alpha task'), 'to desk').click();
    await sendOption(page, 'Work desk').click();
    await expect(projectCard(page, 'Alpha task')).toHaveCount(0);
    expect((await storedProjects(page)).deletedIds.pt1).toBeTruthy();
    await page.locator('#tab-work').click();
    const card = deskCard(page, 'Alpha task');
    await expect(card).toBeVisible();
    const work = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-data-work')!));
    const item = Object.values(work.days).flatMap((d: any) => d.items).find((i: any) => i.content === 'Alpha task');
    expect(item.boardColumn).toBe('new');
    expect(item.comments[0].content).toBe('line one<br>line two');
  });

  test('to desk on a project note works from the Notes tab', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    await cardButton(projectCard(page, 'Alpha note'), 'to desk').click();
    await expect(page.locator('#send-modal-text')).toContainText('Move this note to a desk');
    await sendOption(page, 'Work desk').click();
    await expect(projectCard(page, 'Alpha note')).toHaveCount(0);
    await page.locator('#tab-work').click();
    const card = deskCard(page, 'Alpha note');
    await expect(card).toBeVisible();
    await expect(card.locator('.tag-chip')).toContainText(/ops/i);
  });
});

test.describe('Pin and reorder projects 1.19.0', { tag: ['@projects', '@sidebar'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const names = (page: Page) => page.locator('#projects-list .project-list-name');
  const item = (page: Page, name: string) => page.locator('.project-list-item', { hasText: name });
  const order = async (page: Page) => (await storedProjects(page)).projects.map((p: { id: string }) => p.id);

  test('the list pin toggles a pin without opening the project, and the divider follows the pins', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    await expect(names(page)).toHaveText(['Alpha Project', 'Beta Project', 'Gamma Project']);
    const pin = item(page, 'Gamma Project').locator('.project-list-pin');
    await expect(pin).toHaveCSS('opacity', '0');
    await item(page, 'Gamma Project').hover();
    await expect(pin).toHaveCSS('opacity', '1');
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    await pin.click();

    await expect(names(page)).toHaveText(['Gamma Project', 'Alpha Project', 'Beta Project']);
    await expect(page.locator('#project-title')).toHaveText('Alpha Project');
    await expect(page.locator('#project-detail')).toBeVisible();
    const pinned = item(page, 'Gamma Project');
    await expect(pinned).toHaveClass(/pinned/);
    await expect(pinned).toHaveClass(/pinned-last/);
    await expect(pinned.locator('.project-list-pin')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(900, 600);
    await expect(pinned.locator('.project-list-pin')).toHaveCSS('opacity', '1');
    expect(await order(page)).toEqual(['p3', 'p1', 'p2']);

    await pinned.locator('.project-list-pin').click();
    await expect(names(page)).toHaveText(['Gamma Project', 'Alpha Project', 'Beta Project']);
    await expect(page.locator('.project-list-item.pinned')).toHaveCount(0);
    await expect(page.locator('.project-list-item.pinned-last')).toHaveCount(0);
  });

  test('Pin / Unpin in the project header, kept after a reload, and the send dialog follows the order', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Beta Project', 'notes');
    const btn = page.locator('#project-pin-btn');
    await expect(btn).toHaveText('Pin');
    await btn.click();
    await expect(btn).toHaveText('Unpin');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(names(page)).toHaveText(['Beta Project', 'Alpha Project', 'Gamma Project']);

    await page.reload();
    await dismissAuthModal(page);
    await page.locator('#tab-projects').click();
    await expect(names(page)).toHaveText(['Beta Project', 'Alpha Project', 'Gamma Project']);
    await item(page, 'Beta Project').click();
    await expect(page.locator('#project-pin-btn')).toHaveText('Unpin');

    await page.locator('#tab-work').click();
    const card = page.locator('.item-card', { hasText: 'Desk task to send' });
    await card.locator('.card-overflow-btn').click();
    await card.locator('.card-overflow-menu button', { hasText: 'Send to project…' }).click();
    await expect(page.locator('#send-modal .send-option-name')).toHaveText(['Beta Project', 'Alpha Project', 'Gamma Project', '+ New project…']);
    await page.locator('#send-modal-cancel').click();

    await page.locator('#tab-projects').click();
    await item(page, 'Beta Project').click();
    await page.locator('#project-pin-btn').click();
    await expect(page.locator('#project-pin-btn')).toHaveText('Pin');
    await expect(page.locator('.project-list-item.pinned')).toHaveCount(0);
  });

  test('dragging reorders projects, but not across the pinned divider', async ({ page }) => {
    await seedProjectSpace(page);
    await page.locator('#tab-projects').click();
    await item(page, 'Gamma Project').dragTo(item(page, 'Alpha Project'), { targetPosition: { x: 20, y: 4 } });
    await expect(names(page)).toHaveText(['Gamma Project', 'Alpha Project', 'Beta Project']);
    const beta = (await item(page, 'Beta Project').boundingBox())!;
    await item(page, 'Gamma Project').dragTo(item(page, 'Beta Project'), { targetPosition: { x: 20, y: beta.height - 4 } });
    await expect(names(page)).toHaveText(['Alpha Project', 'Beta Project', 'Gamma Project']);
    expect(await order(page)).toEqual(['p1', 'p2', 'p3']);

    await item(page, 'Beta Project').hover();
    await item(page, 'Beta Project').locator('.project-list-pin').click();
    await expect(names(page)).toHaveText(['Beta Project', 'Alpha Project', 'Gamma Project']);
    await item(page, 'Gamma Project').dragTo(item(page, 'Beta Project'), { targetPosition: { x: 20, y: 4 } });
    await expect(names(page)).toHaveText(['Beta Project', 'Alpha Project', 'Gamma Project']);
    await expect(page.locator('.project-list-item.drop-before, .project-list-item.drop-after')).toHaveCount(0);
  });

  test('keyboard: Enter opens a project, Alt+↑ / Alt+↓ move it and keep focus', async ({ page }) => {
    await seedProjectSpace(page);
    await page.locator('#tab-projects').click();
    await item(page, 'Gamma Project').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#project-title')).toHaveText('Gamma Project');
    await item(page, 'Gamma Project').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(names(page)).toHaveText(['Alpha Project', 'Gamma Project', 'Beta Project']);
    await expect(item(page, 'Gamma Project')).toBeFocused();
    await page.keyboard.press('Alt+ArrowUp');
    await page.keyboard.press('Alt+ArrowUp');
    await expect(names(page)).toHaveText(['Gamma Project', 'Alpha Project', 'Beta Project']);
    await page.keyboard.press('Alt+ArrowDown');
    await expect(names(page)).toHaveText(['Alpha Project', 'Gamma Project', 'Beta Project']);
    expect(await order(page)).toEqual(['p1', 'p3', 'p2']);
  });

  test('top bar: projects drag left and right', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('work-desk-sidebar-position', 'top'));
    await seedProjectSpace(page);
    await page.locator('#tab-projects').click();
    const alpha = (await item(page, 'Alpha Project').boundingBox())!;
    const gamma = (await item(page, 'Gamma Project').boundingBox())!;
    expect(Math.abs(alpha.y - gamma.y)).toBeLessThan(2);
    await item(page, 'Gamma Project').dragTo(item(page, 'Alpha Project'), { targetPosition: { x: 4, y: alpha.height / 2 } });
    await expect(names(page)).toHaveText(['Gamma Project', 'Alpha Project', 'Beta Project']);
  });
});

test.describe('Project More menu, archive, progress, Markdown 1.19.0', { tag: ['@projects', '@sidebar'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const names = (page: Page) => page.locator('#projects-list .project-list-name');
  const menu = (page: Page) => page.locator('#project-more-menu');
  const menuItem = (page: Page, name: string) => menu(page).getByRole('menuitem', { name, exact: true });
  async function openMore(page: Page) {
    await page.locator('#project-more-btn').click();
    await expect(menu(page)).toBeVisible();
    await expect(page.locator('#project-more-btn')).toHaveAttribute('aria-expanded', 'true');
  }

  test('More opens and closes with a second click, an outside click, and Escape; arrows move focus', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    await openMore(page);
    await expect(menu(page).getByRole('menuitem')).toHaveText(['Copy as Markdown', 'Archive project', 'Move up', 'Move down']);
    await expect(menuItem(page, 'Copy as Markdown')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menuItem(page, 'Archive project')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(menuItem(page, 'Move down')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await expect(page.locator('#project-more-btn')).toBeFocused();
    await expect(page.locator('#project-detail')).toBeVisible();

    await openMore(page);
    await page.locator('#project-more-btn').click();
    await expect(menu(page)).toBeHidden();
    await openMore(page);
    await page.locator('#project-title').click();
    await expect(menu(page)).toBeHidden();
  });

  test('Move up / Move down reorder the project and are disabled at the ends of its group', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    await openMore(page);
    await expect(menuItem(page, 'Move up')).toBeDisabled();
    await menuItem(page, 'Move down').click();
    await expect(menu(page)).toBeHidden();
    await expect(names(page)).toHaveText(['Beta Project', 'Alpha Project', 'Gamma Project']);
    await openMore(page);
    await menuItem(page, 'Move down').click();
    await expect(names(page)).toHaveText(['Beta Project', 'Gamma Project', 'Alpha Project']);
    await openMore(page);
    await expect(menuItem(page, 'Move down')).toBeDisabled();
    await menuItem(page, 'Move up').click();
    await expect(names(page)).toHaveText(['Beta Project', 'Alpha Project', 'Gamma Project']);
    await expect(page.locator('#project-title')).toHaveText('Alpha Project');
  });

  test('Archive moves the project into a collapsed group; the toggle, send dialog, and Unarchive all follow', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    await openMore(page);
    await menuItem(page, 'Archive project').click();
    await expect(page.getByText('Archived Alpha Project')).toBeVisible();
    const toggle = page.locator('.project-list-archive-toggle');
    await expect(toggle).toHaveText(/Archived projects \(1\)/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(names(page)).toHaveText(['Beta Project', 'Gamma Project', 'Alpha Project']);
    await expect(page.locator('.project-list-item.archived')).toHaveText(/Alpha Project/);
    await expect(page.locator('#project-progress-text')).toHaveText('1 of 2 tasks done · Archived');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(names(page)).toHaveText(['Beta Project', 'Gamma Project']);
    await expect(page.locator('#project-detail')).toBeVisible();
    await toggle.click();
    await expect(names(page)).toHaveText(['Beta Project', 'Gamma Project', 'Alpha Project']);

    await page.locator('#tab-work').click();
    const card = page.locator('.item-card', { hasText: 'Desk task to send' });
    await card.locator('.card-overflow-btn').click();
    await card.locator('.card-overflow-menu button', { hasText: 'Send to project…' }).click();
    await expect(page.locator('#send-modal .send-option-name')).toHaveText(['Beta Project', 'Gamma Project', '+ New project…']);
    await page.keyboard.press('Escape');

    await page.locator('#tab-projects').click();
    await page.locator('.project-list-item', { hasText: 'Alpha Project' }).click();
    await openMore(page);
    await menuItem(page, 'Unarchive project').click();
    await expect(page.locator('.project-list-archive-toggle')).toHaveCount(0);
    await expect(names(page)).toHaveText(['Alpha Project', 'Beta Project', 'Gamma Project']);
    await expect(page.locator('#project-progress-text')).toHaveText('1 of 2 tasks done');
  });

  test('progress shows in the header and the list, and updates as tasks finish', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'tasks');
    await expect(page.locator('#project-progress-text')).toHaveText('1 of 2 tasks done');
    await expect(page.locator('#project-progress-fill')).toHaveAttribute('style', /width: 50%/);
    const listBar = page.locator('.project-list-item', { hasText: 'Alpha Project' }).locator('.project-list-progress');
    await expect(listBar).toHaveAttribute('title', '1 of 2 tasks done');
    await expect(page.locator('.project-list-item', { hasText: 'Gamma Project' }).locator('.project-list-progress')).toHaveCount(0);
    await projectCard(page, 'Alpha task').locator('.complete-edge').click();
    await expect(page.locator('#project-progress-text')).toHaveText('2 of 2 tasks done');
    await expect(listBar.locator('span')).toHaveAttribute('style', /width: 100%/);
    await page.locator('.project-list-item', { hasText: 'Gamma Project' }).click();
    await expect(page.locator('#project-progress')).toBeHidden();
  });

  test('Copy as Markdown puts open tasks, notes, comments, and tags on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    await openMore(page);
    await menuItem(page, 'Copy as Markdown').click();
    await expect(page.getByText('Copied Alpha Project as Markdown')).toBeVisible();
    const md = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    expect(md).toBe([
      '# Alpha Project', '', '1 of 2 tasks done', '',
      '## Tasks', '- [ ] Alpha task', '  - Oct 3: line one', '    line two', '',
      '## Notes', '- Alpha note #ops', '  - Oct 2: note comment', '',
    ].join('\n'));
  });
});

test.describe('Reorder project notes and tasks 1.19.0', { tag: ['@projects', '@board'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const texts = (page: Page) => page.locator('#project-tasks-list .project-task-text');

  async function openThreeTasks(page: Page) {
    await page.addInitScript(() => {
      if (localStorage.getItem('v119r-seeded')) return;
      localStorage.setItem('v119r-seeded', '1');
      localStorage.setItem('work-desk-list-context', 'work');
      localStorage.setItem('work-desk-data-work', JSON.stringify({ days: {}, deletedIds: {} }));
      localStorage.setItem('work-desk-projects', JSON.stringify({ deletedIds: {}, projects: [
        { id: 'p1', name: 'Order Project', createdAt: '2026-10-01T09:00:00', notes: [
          { id: 'n1', type: 'note', content: 'First note', createdAt: '2026-10-01T09:00:00', comments: [] },
          { id: 'n2', type: 'note', content: 'Second note', createdAt: '2026-10-01T09:00:00', comments: [] },
        ], tasks: [
          { id: 't1', type: 'task', content: 'One', completed: false, createdAt: '2026-10-01T09:00:00', comments: [] },
          { id: 't2', type: 'task', content: 'Two', completed: false, createdAt: '2026-10-01T09:00:00', comments: [] },
          { id: 't3', type: 'task', content: 'Three', completed: false, createdAt: '2026-10-01T09:00:00', comments: [] },
        ] },
      ] }));
    });
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await openSeededProjectTab(page, 'Order Project', 'tasks');
  }
  const taskCard = (page: Page, text: string) => page.locator('#project-tasks-list .project-item-card', { has: page.locator('.project-task-text', { hasText: new RegExp(`^${text}$`) }) });

  test('dragging a task card reorders tasks and persists', async ({ page }) => {
    await openThreeTasks(page);
    await expect(texts(page)).toHaveText(['One', 'Two', 'Three']);
    await taskCard(page, 'Three').dragTo(taskCard(page, 'One'), { targetPosition: { x: 200, y: 4 } });
    await expect(texts(page)).toHaveText(['Three', 'One', 'Two']);
    await expect(page.locator('#project-detail')).toBeVisible();
    await page.reload();
    await dismissAuthModal(page);
    await page.locator('#tab-projects').click();
    await page.locator('.project-tab-btn[data-project-tab="tasks"]').click();
    await expect(texts(page)).toHaveText(['Three', 'One', 'Two']);
  });

  test('Alt+↑ / Alt+↓ on a focused card move it and keep focus; notes reorder too', async ({ page }) => {
    await openThreeTasks(page);
    await taskCard(page, 'One').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(texts(page)).toHaveText(['Two', 'One', 'Three']);
    await expect(taskCard(page, 'One')).toBeFocused();
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Alt+ArrowDown');
    await expect(texts(page)).toHaveText(['Two', 'Three', 'One']);

    await page.locator('.project-tab-btn[data-project-tab="notes"]').click();
    const notes = page.locator('#project-notes-list .project-item-card');
    await notes.filter({ hasText: 'Second note' }).dragTo(notes.filter({ hasText: 'First note' }), { targetPosition: { x: 200, y: 4 } });
    await expect(notes.first()).toContainText('Second note');
  });

  test('a card being edited is not draggable', async ({ page }) => {
    await openThreeTasks(page);
    await taskCard(page, 'Two').locator('.project-item-actions').getByRole('button', { name: 'edit', exact: true }).click();
    await expect(page.locator('#project-tasks-list .project-item-editor')).toBeVisible();
    await expect(page.locator('#project-tasks-list .project-item-card').nth(1)).not.toHaveAttribute('draggable', 'true');
    await expect(taskCard(page, 'One')).toHaveAttribute('draggable', 'true');
  });
});

test.describe('to desk day picker 1.19.0', { tag: ['@projects', '@calendar'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('pick a later day: labels follow, the item lands on that day, and Today resets', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'tasks');
    await projectCard(page, 'Alpha task').locator('.project-item-actions').getByRole('button', { name: 'to desk', exact: true }).click();
    const date = page.locator('#send-modal-date');
    const today = await page.evaluate(() => todayKey());
    await expect(date).toHaveValue(today);
    const later = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); return formatDateKey(d); });
    const laterLabel = await page.evaluate((k) => formatSidebarLabel(k), later);
    await date.fill(later);
    await expect(page.locator('#send-modal .send-option-sub')).toHaveText([laterLabel, laterLabel]);
    await page.locator('#send-modal-today').click();
    await expect(date).toHaveValue(today);
    await expect(page.locator('#send-modal .send-option-sub')).toHaveText(['Today', 'Today']);
    await expect(page.locator('#send-modal')).toBeVisible();

    await date.fill(later);
    await page.locator('#send-modal .send-option', { hasText: 'Work desk' }).click();
    await expect(page.getByText(`Sent to Work desk · ${laterLabel}`)).toBeVisible();
    const work = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-data-work')!));
    expect(work.days[later].items.map((i: { content: string }) => i.content)).toContain('Alpha task');
  });

  test('the desk → project dialog has no day picker', async ({ page }) => {
    await seedProjectSpace(page);
    const card = page.locator('.item-card', { hasText: 'Desk task to send' });
    await card.locator('.card-overflow-btn').click();
    await card.locator('.card-overflow-menu button', { hasText: 'Send to project…' }).click();
    await expect(page.locator('#send-modal')).toBeVisible();
    await expect(page.locator('#send-modal-date-row')).toBeHidden();
  });
});

test.describe('Pin projects, touch 1.19.0', { tag: ['@projects', '@phone'] }, () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the pin shows without hovering and a tap pins the project', async ({ page }) => {
    await seedProjectSpace(page);
    await page.locator('#tab-projects').click();
    const pin = page.locator('.project-list-item', { hasText: 'Beta Project' }).locator('.project-list-pin');
    await expect(pin).toHaveCSS('opacity', '1');
    await pin.tap();
    await expect(page.locator('#projects-list .project-list-name').first()).toHaveText('Beta Project');
  });

  test('More → Move down reorders projects by tap', async ({ page }) => {
    await seedProjectSpace(page);
    await page.locator('#tab-projects').click();
    await page.locator('.project-list-item', { hasText: 'Alpha Project' }).tap();
    await page.locator('#project-more-btn').tap();
    await page.locator('#project-more-menu').getByRole('menuitem', { name: 'Move down', exact: true }).tap();
    await expect(page.locator('#projects-list .project-list-name')).toHaveText(['Beta Project', 'Alpha Project', 'Gamma Project']);
  });
});

test.describe('Search covers projects 1.19.0', { tag: ['@search', '@projects'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function searchAll(page: Page, q: string) {
    const chip = page.locator('#search-scope-chip');
    await expect(chip).toHaveText('Work');
    await page.locator('#search-input').click();
    await chip.click();
    await expect(chip).toHaveText('All');
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Search Work, Personal & Projects…');
    await page.locator('#search-input').fill(q);
  }

  test('All scope finds project items; a click opens the project with the item outlined', async ({ page }) => {
    await seedProjectSpace(page);
    await searchAll(page, 'alpha');
    const result = page.locator('.search-result', { hasText: 'Finished alpha task' });
    await expect(result).toBeVisible();
    await expect(result.locator('.search-result-date')).toHaveText('Alpha Project');
    await expect(page.locator('.search-result', { hasText: 'Alpha note' })).toBeVisible();
    await result.click();
    await expect(page.locator('#project-title')).toHaveText('Alpha Project');
    await expect(page.locator('.project-tab-btn[data-project-tab="tasks"]')).toHaveClass(/active/);
    const card = page.locator('#project-tasks-archive-wrap .project-item-card', { hasText: 'Finished alpha task' });
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/search-highlight/);
  });

  test('#tag and comment searches reach project notes', async ({ page }) => {
    await seedProjectSpace(page);
    await searchAll(page, '#ops');
    await expect(page.locator('.search-result')).toHaveCount(1);
    await page.locator('.search-result', { hasText: 'Alpha note' }).click();
    await expect(page.locator('.project-tab-btn[data-project-tab="notes"]')).toHaveClass(/active/);
    await expect(projectCard(page, 'Alpha note')).toHaveClass(/search-highlight/);

    await page.locator('#tab-work').click();
    await page.locator('#search-input').fill('note comment');
    await expect(page.locator('.search-result')).toHaveCount(1);
    await expect(page.locator('.search-result')).toContainText('note comment');
  });

  test('the current-list scope leaves projects out', async ({ page }) => {
    await seedProjectSpace(page);
    await page.locator('#search-input').fill('alpha');
    await expect(page.locator('#search-overlay-count')).toHaveText('No matches');
  });
});

test.describe('Formatting in projects 1.19.1', { tag: ['@projects', '@board'] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const formatBtn = (scope: Locator, cmd: string) => scope.locator(`.format-btn[data-cmd="${cmd}"]`);

  test('note editor toolbar: B, I, U, and bullets apply, keep the editor open, and save', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    const card = projectCard(page, 'Alpha note');
    await cardButton(card, 'edit').click();
    const editor = page.locator('#project-notes-list .project-item-editor');
    await expect(editor).toBeFocused();
    const toolbar = page.locator('#project-notes-list .format-toolbar');
    await expect(toolbar.locator('.format-btn')).toHaveCount(4);

    await page.keyboard.press('Control+A');
    for (const cmd of ['bold', 'italic', 'underline']) {
      await formatBtn(toolbar, cmd).click();
      await expect(editor).toBeVisible();
    }
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await formatBtn(toolbar, 'insertUnorderedList').click();
    await expect(editor).toBeVisible();
    await page.keyboard.type('first point');

    await page.locator('#project-notes-list .project-add-btn', { hasText: 'Save' }).click();
    await expect(editor).toHaveCount(0);
    const content = projectCard(page, 'Alpha note').locator('.project-item-content');
    await expect(content.locator('b, strong').first()).toContainText('Alpha note');
    await expect(content.locator('i, em').first()).toContainText('Alpha note');
    await expect(content.locator('u').first()).toContainText('Alpha note');
    await expect(content.locator('ul li')).toHaveText('first point');
    const stored = (await storedProjects(page)).projects[0].notes[0].content;
    expect(stored).toMatch(/<(b|strong)>/);
    expect(stored).toMatch(/<ul><li>.*first point.*<\/li><\/ul>/);
  });

  test('task editor: Ctrl+B formats, Ctrl+Enter saves, Esc cancels and keeps the old text', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'tasks');
    await cardButton(projectCard(page, 'Alpha task'), 'edit').click();
    const editor = page.locator('#project-tasks-list .project-item-editor');
    await expect(page.locator('#project-tasks-list .format-toolbar .format-btn')).toHaveCount(4);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+B');
    await page.keyboard.press('Control+Enter');
    await expect(editor).toHaveCount(0);
    await expect(projectCard(page, 'Alpha task').locator('.project-task-text b, .project-task-text strong')).toHaveText('Alpha task');

    await projectCard(page, 'Alpha task').locator('.project-task-text').dblclick();
    await expect(editor).toBeFocused();
    await page.keyboard.type(' changed');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(projectCard(page, 'Alpha task').locator('.project-task-text')).toHaveText('Alpha task');
    expect((await storedProjects(page)).projects[0].tasks[0].content).toMatch(/^<(b|strong)>Alpha task<\/(b|strong)>$/);
  });

  test('add a formatted comment with the toolbar; Ctrl+Enter adds it, Esc closes the box', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'tasks');
    const card = projectCard(page, 'Alpha task');
    await cardButton(card, 'comments (1)').click();
    const box = card.locator('.project-comment-editor-wrap');
    const editor = box.locator('.project-comment-editor');
    await expect(editor).toBeFocused();
    await expect(box.locator('.format-btn')).toHaveCount(4);
    await formatBtn(box, 'bold').click();
    await expect(box).toBeVisible();
    await page.keyboard.type('Bold update');
    await formatBtn(box, 'bold').click();
    await page.keyboard.press('Enter');
    await formatBtn(box, 'insertUnorderedList').click();
    await page.keyboard.type('item one');
    await page.keyboard.press('Control+Enter');

    await expect(card.locator('.project-comment-editor-wrap')).toHaveCount(0);
    const body = projectCard(page, 'Alpha task').locator('.project-comment-body').last();
    await expect(body.locator('b, strong')).toHaveText('Bold update');
    await expect(body.locator('ul li')).toHaveText('item one');
    const comment = (await storedProjects(page)).projects[0].tasks[0].comments[1];
    expect(comment.html).toMatch(/<(b|strong)>Bold update<\/(b|strong)>/);
    expect(comment.text).toBe('Bold update\nitem one');

    await cardButton(projectCard(page, 'Alpha task'), 'comments (2)').click();
    await expect(projectCard(page, 'Alpha task').locator('.project-comment-editor')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(projectCard(page, 'Alpha task').locator('.project-comment-editor-wrap')).toHaveCount(0);
  });

  test('a blank comment is not added', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'notes');
    const card = projectCard(page, 'Alpha note');
    await cardButton(card, 'add update').click();
    await card.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card.locator('.project-comment-editor-wrap')).toBeVisible();
    expect((await storedProjects(page)).projects[0].notes[0].comments).toHaveLength(1);
  });

  test('edit a comment: starts with its text, bullets apply, save keeps it; cancel and Esc leave it alone', async ({ page }) => {
    await seedProjectSpace(page);
    await openSeededProjectTab(page, 'Alpha Project', 'tasks');
    const row = () => projectCard(page, 'Alpha task').locator('.project-comment-row');
    await expect(row().locator('.project-comment-body br')).toHaveCount(1);
    await row().hover();
    await row().getByRole('button', { name: 'edit', exact: true }).click();
    const card = projectCard(page, 'Alpha task');
    const editor = card.locator('.project-comment-editor');
    await expect(editor).toBeFocused();
    await expect(editor).toContainText('line one');
    await expect(editor).toContainText('line two');

    await page.keyboard.press('Control+A');
    await formatBtn(card, 'insertUnorderedList').click();
    await expect(editor).toBeVisible();
    await card.getByRole('button', { name: 'save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(row().locator('.project-comment-body ul li').first()).toContainText('line one');
    await expect(row().locator('.project-comment-body ul')).toContainText('line two');
    const saved = (await storedProjects(page)).projects[0].tasks[0].comments[0];
    expect(saved.html).toMatch(/<ul><li>line one/);
    expect(saved.text).toMatch(/^line one\s+line two$/);

    await row().locator('.project-comment-body').dblclick();
    await expect(editor).toBeFocused();
    await page.keyboard.type('zzz');
    await card.getByRole('button', { name: 'cancel', exact: true }).click();
    await expect(row().locator('.project-comment-body')).not.toContainText('zzz');

    await row().hover();
    await row().getByRole('button', { name: 'edit', exact: true }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.type('yyy');
    await page.keyboard.press('Escape');
    await expect(row().locator('.project-comment-body')).not.toContainText('yyy');
    expect((await storedProjects(page)).projects[0].tasks[0].comments[0].html).toBe(saved.html);
  });

  test('comment formatting survives desk → project → desk', async ({ page }) => {
    await seedProjectSpace(page);
    const deskCard = page.locator('.item-card', { hasText: 'Desk task to send' });
    await deskCard.locator('.card-overflow-btn').click();
    await deskCard.locator('.card-overflow-menu button', { hasText: 'Send to project…' }).click();
    await page.locator('#send-modal .send-option', { hasText: 'Gamma Project' }).click();

    await openSeededProjectTab(page, 'Gamma Project', 'tasks');
    const body = projectCard(page, 'Desk task to send').locator('.project-comment-body');
    await expect(body.locator('b')).toHaveText('comment');

    await cardButton(projectCard(page, 'Desk task to send'), 'to desk').click();
    await page.locator('#send-modal .send-option', { hasText: 'Work desk' }).click();
    const work = await page.evaluate(() => JSON.parse(localStorage.getItem('work-desk-data-work')!));
    const items = Object.values(work.days as Record<string, { items: { content: string; comments?: { content: string }[] }[] }>).flatMap(d => d.items);
    const back = items.find(i => i.content === 'Desk task to send')!;
    expect(back.comments![0].content).toBe('desk <b>comment</b>');
  });

  test('a comment edited by an older version shows its plain text, not stale formatting', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('work-desk-projects', JSON.stringify({ deletedIds: {}, projects: [
        { id: 'p1', name: 'Old Client Project', createdAt: '2026-10-01T09:00:00', notes: [], tasks: [
          { id: 't1', type: 'task', content: 'Task', createdAt: '2026-10-03T09:00:00', comments: [
            { id: 'c1', text: 'edited on 1.19.0', html: '<b>original</b>', createdAt: '2026-10-03T10:00:00' },
            { id: 'c2', text: 'kept', html: '<i>kept</i>', createdAt: '2026-10-03T11:00:00' },
          ] },
        ] },
      ] }));
    });
    await page.goto(DESK_URL);
    await dismissAuthModal(page);
    await openSeededProjectTab(page, 'Old Client Project', 'tasks');
    const bodies = projectCard(page, 'Task').locator('.project-comment-body');
    await expect(bodies.nth(0)).toHaveText('edited on 1.19.0');
    await expect(bodies.nth(0).locator('b')).toHaveCount(0);
    await expect(bodies.nth(1).locator('i')).toHaveText('kept');
  });
});
