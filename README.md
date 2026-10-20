# Work Desk

A personal daily desk for tasks, notes, and light project tracking — with optional cloud sync and a PWA install.

![PWA Ready](https://img.shields.io/badge/PWA-Ready-blue)
![Self Hosted](https://img.shields.io/badge/Self--Hosted-GitHub%20Pages-green)
![Vanilla JS](https://img.shields.io/badge/Stack-Vanilla%20JS-yellow)

## Features

### Task management

- **Kanban board** — New → Active → Completed / Shelved
- **Complete button on the card edge** — click a task's left edge to finish it (again to reopen). Choose its look in Options → Appearance → Card layout → *Complete button*: a *"Done" label* (default; DONE? on hover, DOING while dragging, DONE! when finished, UNDO? to reopen), bar, raised bar, switch, circle, square, diamond, faint ✓, plain edge, or *Checkbox*. Project tasks use the same edge
- **Drag and drop** — reorder within a day or move between columns; on desktop, the empty space below a column accepts drops for that column, with a *Drop in …* strip showing where the task will land
- **Shelving** — park a task without deleting it
- **Carry forward** — a one-click button that only appears when there's something to carry; enable auto-carry (Options → Behavior) to pull it in every time you open the desk
- **Recurring templates** — daily / weekdays / weekly / custom; injects once per due day (completed instances count)
- **Comments / updates** — timestamped follow-ups on tasks; split any comment into its own task or note with one click (→ task / → note)
- **Move to another day** — keeps a single ID (no dual-day clones)

### Notes and projects

- **Quick notes** — alongside the task board
- **Rich text** — bold, italic, underline, bullets
- **Projects** — third context for longer-lived notes and tasks with updates; organized into **Notes | Tasks** tabs per project, with **Rename** and **Delete** buttons in the project header. The project list shows open tasks and active notes per project; **pin** a project to keep it at the top and drag to reorder (Alt+↑ / Alt+↓ from the keyboard, or *More → Move up / Move down* on phones). Notes and tasks inside a project reorder the same way. The header shows task progress, and its *More* menu has *Copy as Markdown* and *Archive project* (archived projects collapse into a group at the bottom of the list). Project notes and tasks take `#tags` like desk items, and move between desk and projects: *Send to project…* in a desk card's ⋮ menu, or *to desk* on a project card (lands on the Work or Personal desk on the day you pick, today by default; comments and tags come along, with Undo)
- **Note preview** — long project notes are truncated to a few lines with a *show more* toggle (configurable in Options → Behavior)
- **Archive** — archive notes or tasks you're done with; completing a project task auto-archives it; archived items live in a collapsed accordion at the bottom of each tab
- **Double-click to edit** — double-click any project note, task, or comment to jump into the editor

### Organization

- **Work / Personal / Projects** — separate contexts
- **Date navigation** — sidebar calendar (desktop) and week strip (narrow screens). The calendar's selected day is a solid fill in the theme color; yellow number badges count tasks left open (rose on amber-accent themes, matching Insights *carried over*); a legend underneath explains *Has items · Left open · Holiday*; and a *Today* chip appears when you've browsed to another month
- **Quieter weekends** — Options → Behavior → General grays Sat/Sun on the sidebar calendar: *Off* (default), *Work only*, or *Both desks*
- **Open desk** — Options → Behavior → General picks the desk the app starts on: *Last used* (default), *Work*, or *Personal*
- **Calendar legend / Today's Progress switches** — Options → Appearance → Layout can hide the key under the sidebar calendar and the Today's Progress card (both on by default)
- **Tags** — tag a task or note by typing `#word` inline or clicking the `tag` action (which offers your two most-used tags as one-click picks, narrowing as you type); chips render top-right on the card, always uppercase and case-insensitive (`#ACE` == `#ace`)
- **Tag position** — Options → Appearance → Card layout: *Own row* (default), *Slim headroom* (every task keeps a short tag row so text starts at the same height with or without tags), or *Action bar* (chips beside ⋮; on narrow cards they drop to a second line with ⋮, right-aligned)
- **Tag colors** — Options → Appearance → Tags: *Single color (accent)* (default, every tag uses the accent), *Shades of accent* (lighter/darker/neighboring shades of the accent), or *Multi-color* (hues spread around the color wheel at the accent's brightness); both follow the theme when you switch and are stable across devices. Each mode has 8 colors, so with more tags some share one. Click any chip on a card, or use the tag list in Options, to pin a custom color that overrides any mode; synced with your other preferences
- **Search** — floating overlay with a result count; search the current list or switch the scope chip to *All* for Work, Personal, and Projects together (project results show the project name and open the project with the item outlined), and use `#tagname` to filter by tag; finished tasks are marked `✓ Done` or `Shelved`
- **Repair duplicates** — cleans same-ID and same-day recurring copies left by sync races

### Insights

- Week / month / year views with a period selector and prev/next navigation
- **Productivity summary** — completion rate, average daily completions, carry-over rate, most productive day
- **Click a day to open it** — Day-by-day rows, breakdown bars, and heatmap squares jump to that day on the Desk; in Year view a month bar opens that month
- **This week / month / year** button returns to the current period after stepping away
- **Week-over-week, month-over-month, year-over-year** comparisons; an in-progress month or year is compared with the same days at the start of the previous one
- **Tasks by Tag** — done / open / shelved / carried per tag for the period
- **Lingering Tasks** — the five oldest open tasks right now, with days open and a jump link
- **Shelved Review** — shelved tasks in the period with *Bring back* (to today's Active column) and *Open*, plus an all-time shelved count
- **Carry-over analysis** — counted on the day each task was left unfinished; Month/Year views add a by-week / by-month trend chart (Year stops at the current month) and show the specific dates behind each weekday bar inline (hover a row for the full list)
- **Streak tracking** — current/longest streaks based on days with desk activity, with a heatmap matched to the selected period, labeled by weekday, date, or month
- **Weekends don't break streaks** — Options → Behavior toggle (on by default); Fri → Mon stays consecutive; active weekend days still count, idle weekends do not reset the streak
- **Charts** — bar, line, stacked, and pie, each with hover tooltips
- Activity heatmap (year view) and a day-by-day progress breakdown table (real date labels; today marked e.g. `Tue, Sep 22 (Today)`)

### Customization

- **96 preset themes** — 32 light + 32 medium + 32 dark (Nord, Dracula, Synthwave, Catppuccin, Gruvbox, Retro, Dot Matrix, Monokai, Phosphor, Fog, Twilight, the four Unit themes, etc.), browsed as mini wireframe previews, filterable by Light/Med/Dark
- **Custom Theme Builder** — create up to 5 of your own themes from 5 picked colors (Background, Surface, Sidebar, Accent, Text); ~30 CSS variables auto-derived, live preview, synced across devices
- **Options menu** — tabbed **Themes** / **Appearance** / **Behavior** panels (customize button ⚙ near the date, or **Options** in the account menu; on phones, **Options** in the menu sheet). Appearance and Behavior open on a summary list where each row has a one-line note of what's inside (hover it for the current settings); click a row to open that section, then *‹ Back* or Esc to return (Esc again closes). On/off settings are switches, and settings added in the current release carry a *New* tag until you open their section
  - Themes: 96 presets with Light/Med/Dark filters, plus Custom tab for user-created themes; a line under the filter names the current theme, with *Show* to jump to its group
  - Appearance: Card layout (Comfortable/Compact, complete button style, tag position), Typography (text size, font family), Layout (sidebar left, right, top, or bottom), Effects (card glow, gradient header), Background (12 patterns, 2–45% strength), Tags (tag colors; top 8 tags with *Show all*; *Reset* only on pinned colors)
  - Behavior: General (startup view, first day of week, quieter weekends), Tasks (keep comments open, auto-collapse completed with threshold 3–20, auto carry each day, celebration confetti, confirm before delete, strike-through completed tasks), Projects (truncate long notes), Insights (weekends don't break streaks), Holidays (past custom holidays hidden behind *Show past*)
  - *Reset to defaults* at the bottom of Appearance and Behavior restores new-install settings for that tab; theme, pinned tag colors, and custom holidays are kept
- **Keep comments open** — multiple comment panels at once; now persists correctly across day navigation and refresh
- Collapsible sidebar on desktop, with a "Today's Progress" mini card that always reflects today regardless of which day you're viewing (hidden on phones, where the desk header's progress bar and Back to today cover it)

### Cloud sync and offline

- **Optional Supabase sync** — email sign-in; devices merge rather than overwrite
- **Deletes stick everywhere** — a deleted task or note is removed from every device, even one that still has an old copy; **Undo** restores it on every device
- **Synced preferences** — theme, density, complete button style, tag position, strike-through, comment/completed/auto-carry toggles, week start day, startup view, and confetti follow your account (last change wins)
- **Continue offline** — use the desk without an account; data stays in this browser only (clearing site data can wipe it). Use **Sign in** in the sidebar account footer (on phones, in the menu) when you’re ready to sync.
- **Export / Import Desk** — save or restore a single tab (Work, Personal, or Projects) as a JSON file; the export stamps which desk it came from, and importing into the wrong tab shows a confirmation warning
- **Export / Import All** — bundles Work + Personal + Projects into a single file for a complete one-click backup and restore
- Auto-prune of days older than 1 year from the local cache (cloud keeps history)

### Mobile and PWA

- Responsive layout for phone, tablet, and desktop
- **Phone menu** — at 768px and narrower, the header keeps tabs, search, and Help; a menu button opens a bottom sheet with account and sign-in, Export / Import, Repair duplicates, Options, and What's new (close with ×, a tap outside, Esc, or a swipe down). A sync dot beside it shows sync status at a glance
- **Account menu** — the bottom of the sidebar is a single button with your name and sync status; it opens Options, Help & shortcuts, What's new, Export, Import, Repair duplicates, Sign in / out, and the version. With the sidebar at the top or bottom it sits at the right end of the bar
- **What's New** — after an update, a highlighted "What's new" link with a pulsing dot appears under the sidebar subtitle (and a dot on the account button); it opens the changelog and disappears once you close it. *What's new* or the version number in the account menu opens the changelog any time
- **Sticky bottom add bar** on mobile so capture stays reachable while scrolling
- Installable home-screen app and service worker offline shell
- **Always the latest version online** — the service worker (`sw.js`) loads the page network-first and only falls back to the saved copy offline, so a new deploy shows on the first load; an app left open in the background offers a **Reload** when a newer version ships
- **Stale-copy protection** — each sync records the app version; if an out-of-date copy opens and sees cloud data from a newer version, it reloads instead of carrying tasks or overwriting settings
- Touch-friendly week strip and tap-to-complete (the complete edge widens to 40px on touch screens)

## How it behaves

The details behind the features above: when things happen automatically, and what to expect.

### Recurring tasks

- **When they're added** — a due template is added to *today's* date whenever the app opens or refreshes, syncs (signed in: every 5 minutes while the tab is visible, and whenever you switch back to the tab), or you switch between Work and Personal. Creating a template that's due today adds it right away. You don't need to be viewing today
- **Once per day** — each template adds at most one task per day; deleting or completing it won't bring it back that day
- **No backfill, no preview** — days the app was never opened don't get filled in later, and future days stay empty until that day arrives
- **Offline mode** — with no account there's no periodic sync, so a tab left open overnight adds the new day's tasks after a refresh or a Work/Personal switch
- **Skip holidays** — templates with *skip holidays* on aren't added on US federal holidays (when enabled in Options → Behavior) or your custom holidays

### Carry forward

- **Unfinished means open** — only tasks that are neither completed nor shelved are carried; shelved tasks stay where they are
- **Auto carry** (Options → Behavior) — moves every open task from *all* earlier days onto today, not just yesterday, and stamps the day it came from so Insights can count carry-overs. It runs when the desk opens and, when signed in, on each sync, so a task you reopen on a past day moves to today at the next sync. A toast reports how many moved
- **Manual** — the *Carry forward* button appears only when there's something to carry

### Sync timing (signed in)

- **Pull and merge** — on open, when you switch back to the tab, and every 5 minutes while the tab is visible (at most once every 10 seconds)
- **Push** — your edits, including auto carry, upload about 2.5 seconds after the last change; auto-added recurring tasks upload immediately
- **Offline** — nothing leaves the browser; use Export All for backups

### Insights

- **Lingering Tasks ignores the period** — it always shows what's open right now; tasks on future days and tasks created today are left out
- **Shelved Review dates** — tasks are grouped by the day they sit on, because the app doesn't record when a task was shelved
- **Bring back** — moves the task (same ID, not a copy) to today's Active column and clears its carry stamp, so it isn't counted as a carry-over
- **Comparisons in progress** — Month and Year compare against the same number of days at the start of the previous period until the period ends; Week compares full weeks

### Deleting

- **Undo** — the toast after a delete offers *Undo* for 8 seconds

### Layout and controls

- **Desktop scrolling** — the desk scrolls like a normal page: the date / progress / add-task card scrolls away at the top, and the sidebar scrolls on its own
- **Patterned background** — Options → Appearance → Background. Twelve line-based patterns (Graph paper, Plus grid, Isometric, Diagonal, Pinstripe, Crosshatch, Hexagon, Herringbone, Basketweave, Chevron, Greek key, Dot grid) at 2–45% strength. Drawn in the theme's text color so it follows theme changes; only the page behind the board is patterned, cards stay solid. Off by default
- **Sidebar at the top or bottom** — above 768px the sidebar becomes a horizontal bar (one row from 1280px, two below). The week strip replaces the calendar, the account button sits at the right end (its menu opens downward from a top bar), the collapse button is hidden, and with a bottom bar search results open upward and toasts sit above it. Phones keep their normal layout whatever the setting
- **Column lanes when dragging** (desktop, 1025px and wider, where the columns sit side by side) — while you drag a task, the space under each column all the way down the page belongs to that column: New, Active, or Completed (the Completed / Shelved column marks it done; drop on the Shelved box to shelve). The far left margin counts as New and the far right as Completed. The column's box gets the dashed outline and, below it, a strip runs from the box to your cursor. Gaps between columns and the Notes area don't accept drops, and the boxes keep their normal size when you're not dragging. Phones and tablets stack the columns, so there are no lanes there
- **Completed tasks collapse** — once a day has 5 completed tasks (adjustable 3–20, or off, in Options → Behavior) they fold into a *Completed (N)* row you can tap to open
- **Tag box** — clicking *tag* on a card opens a text field with your two most-used tags; it stays open until you add a tag, press Esc, or click outside it
- **Today's Progress** — the sidebar card always shows today, whichever day you're viewing
- **What's new** — the link under the subtitle appears once per new version and disappears after you close the changelog
- **Local history** — days older than 12 months are pruned from this browser's copy to keep it fast

## Tech stack

- Single-file app: `index.html` / `work-desk.html` (vanilla JS, no build required to run)
- `localStorage` for local state; Supabase for optional cloud
- CSS variables for theming
- Optional Node test tooling (`lib/`, `tests/`, Playwright `e2e/`)

## Getting started

### Local use (no setup)

1. Open `index.html` or `work-desk.html` in a modern browser
2. Choose **Continue offline** or create / sign in to an account
3. Start adding tasks

### GitHub Pages

1. Push at least:
   - `index.html`
   - `manifest.json`
   - `sw.js`
   - `icon-192.png`
   - `icon-512.png`
2. Settings → Pages → deploy from `main`
3. Visit `https://<user>.github.io/<repo>/`

Update `sw.js` / manifest paths if your Pages site is not served under `/work_desk/`.

### Supabase (optional cloud sync)

1. Create a [Supabase](https://supabase.com) project
2. Run:

```sql
CREATE TABLE user_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own data"
  ON user_data FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

3. Enable Email auth; optionally disable "Confirm email" for easier local signup
4. Set `SB_URL` and `SB_KEY` in the HTML to your project values

## File structure

```text
work-desk/
├── index.html              # Deployable app
├── work-desk.html          # Dev copy (kept in sync with index.html)
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── icon-192.png / icon-512.png
├── lib/desk-logic.mjs      # Pure sync/recurring helpers (unit-tested)
├── tests/desk-logic.test.mjs
├── scripts/audit-init-order.mjs  # Guards against TDZ boot crashes in state init
├── e2e/smoke.spec.ts       # Playwright smoke tests
├── e2e/layout.spec.ts      # Playwright layout/CSS regressions (scroll pin, mobile chrome)
├── playwright.config.ts
├── package.json            # Optional: unit + e2e scripts
└── README.md
```

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| Add task / note | `Ctrl/Cmd + Enter` |
| Add comment / update | `Ctrl/Cmd + Enter` |
| Bold / Italic / Underline | `Ctrl/Cmd + B` / `I` / `U` |
| Cancel / close | `Escape` |

## Data storage

| Store | Contents |
|-------|----------|
| Local | `work-desk-data-work`, `work-desk-data-personal`, projects + recurring keys, preferences |
| Cloud | Supabase `user_data.data` JSON (work, personal, projects, recurring, prefs) |
| Backup | Single-desk export includes `days` + `deletedIds` + `context`; Export All bundles all three desks |

Tips:

- Prefer signing in if you care about durability across browsers or devices
- Use **Export All** before clearing site data or switching machines
- **Repair duplicates** if sync ever leaves twin cards

## Testing

Requires Node.js. Unit tests need no extra packages; E2E needs Playwright (and a working npm registry).

```bash
npm test                 # unit tests + init-order (TDZ) audit
npm run test:e2e         # Playwright smoke + layout/CSS (serves app on :4173)
npm run test:e2e:ui      # Playwright UI mode
npm run test:all         # unit + e2e
```

Layout/CSS coverage: unit invariants assert critical selectors (e.g. desktop page scroll on `.main` / `#desk-view`, mobile logo-sub / backup grid). Playwright `e2e/layout.spec.ts` checks that the desktop desk scrolls like a normal page (the top card scrolls away; the board has no scroll box of its own), and mobile help/version + Export/Import button width.

Desktop screenshot baselines (`e2e/smoke.spec.ts-snapshots/`) cover the desk at 1440/1024/820px, Insights, the collapsed sidebar, the Options panel, and the Export menu; any pixel change fails the suite. Regenerate them only for an intended desktop change: `npx playwright test -g "Desktop layout baselines" --update-snapshots`. The phone menu suite checks every menu control, the 768/769px boundary, resizing with the menu open, and that no button is duplicated.


E2E covers add → New, complete/uncomplete, reload persistence, export tombstones, move-to-date ID uniqueness, hashtag tagging (extraction, case-insensitivity, add/remove via the tag button), search overlay (result count, `#tagname` filtering, close/outside-click), project tasks (mid-edit preservation, empty-save deletion, cancel revert, tombstone tracking, double-click editing), dynamic add-form placeholder, project note list padding, settings popout 3-tab split (Themes/Appearance/Behavior), theme filter buttons (Light/Med/Dark/Custom switching), custom theme builder (add/edit/delete/apply/persist/max-5 cap), comments (add/edit/delete/badge/collapse/split to task or note/undo/text hover actions), recurring templates (add/edit/delete/persist), Insights tab (period selector, navigation, charts, summary stats, day-by-day date labels), streak weekend toggle (default, effect on streaks, persistence), Desk vs Projects view separation, project lifecycle (empty state, rename, delete confirm/cancel, notes, tabs, persistence, sidebar counts), Work/Personal context isolation, day navigation and Back to today, desk notes, carry forward, and the Help / What's New modals. The auth modal is dismissed via **Continue offline**.

## Browser support

- Chrome / Edge 90+
- Firefox 90+
- Safari 14+
- Mobile browsers with PWA support

## Themes

96 presets — 32 light + 32 medium + 32 dark — browsable as mini wireframe previews in Options → Themes, filterable by Light/Med/Dark.

**Light (32):** Default, Slate, Arctic, Paper, Latte, Sand, Coral, Rose, Sakura, Mint, Sage, Lavender, Solarized, Sepia, Tokyo Day, Nord Light, Honey, Cloud, Peach, Olive, Seafoam, Citrus, Mediterranean, Vaporwave, Synthwave, Cyberpunk, Outrun, Retro, Unit Zero, Unit One, Unit Two, Unit Eight

**Medium (32):** Fog, Overcast, Steel, Fjord, Nimbus, Pewter, Horizon, Denim, Lichen, Fern, Tundra, Moss, Basalt, Dot Matrix, Driftwood, Clay, Sandstone, Umber, Terracotta, Flint, Twilight, Haze, Plum Mid, Mulberry, Merlot, Ash, Graphite, Concrete, Unit Zero, Unit One, Unit Two, Unit Eight

**Dark (32):** Default, OLED, Nord, Dracula, Catppuccin, Tokyo Storm, Solarized, Gruvbox, Ocean, Forest, Dusk, Warm, Midnight, Noir, Mocha, Rose, Ember, Glacier, Plum, Storm, One Dark, Phosphor, Monokai, Rosé Pine, Synthwave, Cyberpunk, Outrun, Vaporwave, Unit Zero, Unit One, Unit Two, Unit Eight

**Unit themes** — one per pilot (Zero: prototype blue and white; One: purple and neon green; Two: production red and orange; Eight: pink and mint), each in all three tiers, with a thin color stripe across the top header. **Dot Matrix** was called Game Boy before 1.14.0; a saved selection carries over automatically.

## Future ideas

- **Faster edge scrolling while dragging** — scroll the page quickly when a dragged task nears the top or bottom of the window, so reaching a column far up the page doesn't rely on the browser's slow built-in scrolling
- **Settings window with search** — a wider Options panel with every category (Themes, Appearance, Behavior) in one list down the left and a search box that finds any setting by name, highlighting matches. A natural next step after the 1.17.0 summary-list Options once there are many more settings; on phones it would be a full-screen sheet
- **Suggested colors for custom themes** — next to the five manual pickers, a *Suggest from a color* option: pick a color (color wheel or hex) or a mood (e.g. calm, cozy, energetic, focused), choose dark or light, and the app fills in background, surface, sidebar, accent, and text from color-harmony rules, with readable contrast enforced. A *Surprise me* button rolls a random harmonious set. Every suggestion stays editable with the existing pickers. Roughly 100–150 lines and no new files, so low overhead
## License

Personal use. Feel free to fork and customize for your own productivity needs.
