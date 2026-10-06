import { test, expect, type Page } from '@playwright/test';

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
test.describe('App update prompt', () => {
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

test.describe('Search matching', () => {
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

test.describe('Desktop layout baselines', () => {
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
    await page.locator('#export-btn').click();
    await expect(page.locator('#export-menu')).toBeVisible();
    await shot(page, 'export-1440.png');
  });
});

test.describe('Phone layout baselines', () => {
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

test.describe('Phone menu (1.13.0)', () => {
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
    await expect(page.locator('.sidebar-backup')).toBeVisible();
    await expect(page.locator('#sidebar-account')).toBeVisible();
    await expect(page.locator('#density-toggle')).toBeVisible();
  });

  test('widening the window with the menu or Options open restores the desktop layout', async ({ page }) => {
    await openPhone(page);
    await openMenu(page);
    await page.setViewportSize({ width: 1024, height: 844 });
    await expectMenuClosed(page);
    await expect(page.locator('.sidebar #export-btn')).toBeVisible();
    await expect(page.locator('#sidebar-account')).toBeVisible();

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
      await expect(page.locator('#version-btn')).toBeVisible();
      await expect(page.locator('#sidebar-today-glance')).toBeVisible();
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

test.describe('UI audit fixes (1.12.1)', () => {
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
    expect((await card.locator('.checkbox').boundingBox())!.height).toBeGreaterThanOrEqual(28);
    expect((await card.locator('.card-action').first().boundingBox())!.height).toBeGreaterThanOrEqual(32);
    const remove = card.locator('.tag-chip-remove').first();
    const box = (await remove.boundingBox())!;
    // Tap 7px to the left of the tiny ×; the halo should still remove the tag
    await page.mouse.click(box.x - 7, box.y + box.height / 2);
    await expect(card.locator('.tag-chip')).toHaveCount(0);
  });
});

test.describe('Delete and undo sync records', () => {
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

test.describe('Work Desk smoke', () => {
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
    await card.locator('button.checkbox').click();
    await expect(page.locator('.board-column.done .item.completed', { hasText: 'Complete me' })).toBeVisible();

    await page.locator('.board-column.done .item.completed', { hasText: 'Complete me' }).locator('button.checkbox').click();
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

    // Export button now opens a dropdown; click the single-desk export option
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

test.describe('Tags', () => {
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
test.describe('Font family persistence', () => {
  const bodyFont = (page: Page) => page.evaluate(() => getComputedStyle(document.body).fontFamily);

  async function pickThemeAndFont(page: Page) {
    await openDesk(page);
    await page.locator('#density-toggle').click();
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="monokai"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai');
    await page.locator('#density-toggle').click();
    await page.locator('.options-nav-btn[data-options-tab="appearance"]').click();
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
test.describe('Tag colors', () => {
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
        await page.locator('#font-family-select').selectOption(font);
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

  test('Analogous gives tags different shades that stay near the accent hue', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await openAppearance(page);
    await page.locator('#tag-color-mode-select').selectOption('analogous');
    await expect(page.locator('html')).toHaveAttribute('data-tag-colors', 'analogous');

    const accent = await rgbOf(page, await accentColor(page));
    const a = await rgbOf(page, await colorOf(chipOn(page, 'Alpha task')));
    const b = await rgbOf(page, await colorOf(chipOn(page, 'Bravo task')));
    expect(toHex(a)).not.toBe(toHex(b));
    expect(hueGap(hueOf(a), hueOf(accent))).toBeLessThan(60);
    expect(hueGap(hueOf(b), hueOf(accent))).toBeLessThan(60);

    await page.reload();
    await dismissAuthModal(page);
    await expect(page.locator('html')).toHaveAttribute('data-tag-colors', 'analogous');
  });

  test('Analogous colors follow the theme when you switch', async ({ page }) => {
    await setupTwoTaggedTasks(page);
    await openAppearance(page);
    await page.locator('#tag-color-mode-select').selectOption('analogous');
    await page.locator('.options-nav-btn[data-options-tab="themes"]').click();
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="one-dark"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'one-dark');
    await page.waitForTimeout(600);
    const blue = toHex(await rgbOf(page, await colorOf(chipOn(page, 'Alpha task'))));

    await page.locator('#density-toggle').click();
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await page.locator('#customize-theme-grid .theme-swatch[data-theme-id="monokai"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai');
    await page.waitForTimeout(600);
    const pink = await rgbOf(page, await colorOf(chipOn(page, 'Alpha task')));
    expect(toHex(pink)).not.toBe(blue);
    expect(hueGap(hueOf(pink), hueOf(await rgbOf(page, '#f92672')))).toBeLessThan(60);
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
      'Single color (accent)', 'Analogous (shades of accent)', 'Multi-color (from theme)',
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

test.describe('Search overlay', () => {
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

test.describe('Projects', () => {
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
test.describe('Settings popout tabs', () => {
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
test.describe('Theme filter buttons', () => {
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
    expect(count).toBe(32);
  });

  test('Light and Dark filters each show 32 swatches', async ({ page }) => {
    await openThemesTab(page);
    await expect(page.locator('#customize-theme-grid .theme-swatch')).toHaveCount(32);
    await page.locator('.theme-filter-btn[data-theme-filter="dark"]').click();
    await expect(page.locator('#customize-theme-grid .theme-swatch')).toHaveCount(32);
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
test.describe('Custom theme builder', () => {
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
test.describe('Comments', () => {
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
test.describe('Recurring templates', () => {
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

// ── Insights tab ───────────────────────────────────────────────────────
test.describe('Insights tab', () => {
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
test.describe('Carry-Over Analysis', () => {
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
test.describe('Streak weekend handling', () => {
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
    await page.locator('#streak-skip-weekends-toggle').click();
    await expect(page.locator('#streak-skip-weekends-toggle')).not.toBeChecked();

    const off = await readStreaks(page);
    expect(off.longest).toBeLessThanOrEqual(5);
    expect(off.longest).toBeLessThan(on.longest);
  });

  test('toggle choice persists across reload', async ({ page }) => {
    await openDesk(page);
    await openSettingsBehavior(page);
    await page.locator('#streak-skip-weekends-toggle').click();
    expect(await page.evaluate(() => localStorage.getItem('work-desk-streak-skip-weekends'))).toBe('false');

    await page.reload();
    await dismissAuthModal(page);
    await openSettingsBehavior(page);
    await expect(page.locator('#streak-skip-weekends-toggle')).not.toBeChecked();
  });
});

// ── Desk vs Projects separation ────────────────────────────────────────
test.describe('Desk vs Projects separation', () => {
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
test.describe('Project lifecycle', () => {
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
test.describe('Work / Personal contexts', () => {
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
test.describe('Day navigation', () => {
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

test.describe('Notes on the desk', () => {
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
test.describe('Carry forward', () => {
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

test.describe('Auto carry toggle', () => {
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
    const toggle = page.locator('#auto-carry-toggle-popout');
    if (!(await toggle.isChecked())) await toggle.click();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('work-desk-auto-carry-forward'))).toBe('false');
  });
});

// ── Character encoding ─────────────────────────────────────────────────
test.describe('Rendered text has no mojibake', () => {
  const MOJIBAKE = /â€|â†|Ã[\u0080-\u00BF\u0152-\u2122]|Â[\u00A0-\u00BF]|ðŸ|ï¸|\uFFFD/;

  async function expectClean(page: Page, selector: string) {
    const text = await page.locator(selector).innerText();
    const m = text.match(MOJIBAKE);
    expect(m, m ? `${selector}: …${text.slice(Math.max(0, m.index! - 30), m.index! + 30)}…` : '').toBeNull();
  }

  test('What\'s New, Help, Options, and the desk render real characters', async ({ page }) => {
    await openDesk(page);
    await expectClean(page, 'body');

    await page.locator('#version-btn').click();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    await expect(page.locator('#changelog-body')).toContainText('—');
    await expect(page.locator('#changelog-body')).toContainText('"✓ Done"');
    await expect(page.locator('#changelog-body')).toContainText('the ⋮ menu, tag ×');
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
test.describe('Help and What\'s New modals', () => {
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

    await page.locator('#version-btn').click();
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
test.describe('What\'s new link and version footer (1.13.2)', () => {
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

  test('version button lives at the bottom of the sidebar and opens the changelog any time', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page);
    const ver = page.locator('.sidebar > .sidebar-version > #version-btn');
    await expect(ver).toBeVisible();
    await expect(ver).toHaveText(/^v\d+\.\d+\.\d+$/);
    const verBox = await box(page, '#version-btn');
    const account = await box(page, '#sidebar-account');
    expect(verBox.y).toBeGreaterThanOrEqual(account.y + account.height - 1);

    // Footer click while the link is showing: closing still clears the link
    await ver.click();
    await expect(page.locator('#changelog-modal')).toBeVisible();
    await page.locator('#changelog-modal-dismiss').click();
    await expect(page.locator('#whats-new-link')).toBeHidden();

    // Already seen: footer still opens it, link never comes back
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
    await expect(page.locator('#version-btn')).toBeVisible();
  });

  test('collapsed sidebar hides both; expanding brings them back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedLayout(page);
    await page.locator('#sidebar-toggle').click();
    await expect.poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBe(0);
    await expect(page.locator('#whats-new-link')).not.toBeInViewport();
    await expect(page.locator('#version-btn')).not.toBeInViewport();
    await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#whats-new-link')).toBeInViewport();
    await expect(page.locator('#version-btn')).toBeInViewport();
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
test.describe('Insights 1.15.0 additions', () => {
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
