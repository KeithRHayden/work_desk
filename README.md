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
- **Recurring templates** — daily / weekdays / weekly / custom days / every 2 weeks / monthly / quarterly; monthly and quarterly go on dates (the 1st and 15th, the last day) or weekdays (the 3rd Thursday, the 1st and 3rd Tuesday); injects once per due day (completed instances count). The panel has a one-line quick-add bar (text, **Repeats** dropdown, Add) and lists templates in columns with the schedule and **next due** date; Edit, Add tag, and Delete are in each row's ⋮ menu (the same menu icon as cards)
- **Comments / updates** — timestamped follow-ups on tasks; split any comment into its own task or note with one click (→ task / → note)
- **Move to another day** — keeps a single ID (no dual-day clones)

### Notes and projects

- **Quick notes** — alongside the task board
- **Rich text** — bold, italic, underline, bullets
- **Projects** — third context for longer-lived notes and tasks with updates; organized into **Notes | Tasks** tabs per project, with **Rename** and **Delete** buttons in the project header. Notes, tasks, and comments use the desk's formatting toolbar (bold, italic, underline, bullets). The project list shows open tasks and active notes per project; **pin** a project to keep it at the top and drag to reorder (Alt+↑ / Alt+↓ from the keyboard, or *More → Move up / Move down* on phones). Notes and tasks inside a project reorder the same way. The header shows task progress, and its *More* menu has *Copy as Markdown* and *Archive project* (archived projects collapse into a group at the bottom of the list). Project notes and tasks take `#tags` like desk items, and move between desk and projects: *Send to project…* in a desk card's ⋮ menu, or *to desk* on a project card (lands on the Work or Personal desk on the day you pick, today by default; comments and tags come along, with Undo)
- **Note preview** — long project notes are truncated to a few lines with a *show more* toggle (configurable in Options → Behavior)
- **Archive** — archive notes or tasks you're done with; completing a project task auto-archives it; archived items live in a collapsed accordion at the bottom of each tab
- **Double-click to edit** — double-click any project note, task, or comment to jump into the editor

### Organization

- **Work / Personal / Projects** — separate contexts
- **Date navigation** — sidebar calendar (desktop) and week strip (narrow screens). The calendar's selected day is a solid fill in the theme color; yellow number badges count tasks left open (rose on amber-accent themes, matching Insights *carried over*); a legend underneath explains *Has items · Left open · Holiday*; and a *Today* chip appears when you've browsed to another month
- **Quieter weekends** — Options → Behavior → General grays Sat/Sun on the sidebar calendar, dims them on the week strip, and leaves empty weekend days out of the Insights Month chart: *Off* (default), *Work only*, or *Both desks*
- **Open desk** — Options → Behavior → General picks the desk the app starts on: *Last used* (default), *Work*, or *Personal*
- **Calendar legend / Today's Progress switches** — Options → Appearance → Layout can hide the key under the sidebar calendar and the Today's Progress card (both on by default; tablets and computers only, since phones don't show the sidebar)
- **Tags** — tag a task or note by typing `#word` inline or clicking the `tag` action (which offers your two most-used tags as one-click picks, narrowing as you type); chips render top-right on the card, always uppercase and case-insensitive (`#ACE` == `#ace`)
- **Tag position** — Options → Appearance → Card layout: *Own row* (default), *Slim headroom* (every task keeps a short tag row so text starts at the same height with or without tags), or *Action bar* (chips beside ⋮; on narrow cards they drop to a second line with ⋮, right-aligned)
- **Tag colors** — Options → Appearance → Tags: *Single color (accent)* (default, every tag uses the accent), *Shades of accent* (colors that match what's on screen: the accent plus the tint of the theme's backgrounds and text, such as Monokai's olive or Mediterranean's navy, with a little hue room around each and spread by lightness; it never widens into a rainbow, and when the card itself is tinted it leans on the accent so tags don't sink into the card. Near-gray themes get fewer clearly different colors), or *Multi-color* (8 clearly different colors that suit the theme: its own color set for Monokai, Dracula, Nord, Solarized, Gruvbox, Catppuccin, One Dark, Rosé Pine, Tokyo, Kanagawa, Everforest, and Mediterranean, otherwise a blend from the accent toward the theme's second color, checked so no two look alike). In both, your most-used tags get the most distinct colors and keep them on every device, and colors follow the theme when you switch. Each mode has 8 colors, so with more tags some share one. Click any chip on a card, or use the tag list in Options, to pin a custom color that overrides any mode; synced with your other preferences
- **Search** — floating overlay with a result count; search the current list or switch the scope chip to *All* for Work, Personal, and Projects together (project results show the project name and open the project with the item outlined), and use `#tagname` to filter by tag; finished tasks are marked `✓ Done` or `Shelved`
- **Repair duplicates** — cleans same-ID and same-day recurring copies left by sync races

### Insights

- Week / month / year views with a period selector and prev/next navigation
- **Layout** — the 8 stat tiles sit at the top, then the cards in reading order: Summary, period comparison, Streak Tracking, breakdown chart, Carry-Over, Tags, Lingering, Shelved, Recurring, Carry Chains, Tag Trend. Day-by-day detail (and the Year heatmap) stay full width at the bottom
- **Wide screens** — when Insights has 1500px or more, the cards split into two columns, each card at its own height and placed in whichever column is shorter so the columns end close together; it rebalances when the window or sidebar changes. Narrower screens keep one column
- **Productivity summary** — completion rate, average daily completions, carry-over rate, most productive day (the weekday with the highest average completions across the days of it that had tasks)
- **Click a day to open it** — Day-by-day rows, breakdown bars, and heatmap squares jump to that day on the Desk; in Year view a month bar opens that month
- **This week / month / year** button returns to the current period after stepping away
- **Week-over-week, month-over-month, year-over-year** comparisons; an in-progress month or year is compared with the same days at the start of the previous one
- **Tasks by Tag** — done / open / shelved / carried per tag for the period
- **Lingering Tasks** — the five oldest open tasks right now, with days open and a jump link
- **Shelved Review** — shelved tasks in the period with *Bring back* (to today's Active column) and *Open*, plus an all-time shelved count
- **Recurring Follow-through** — per recurring task, Done / Still open / Missed on the days it came up, lowest rate first; *Rarely done* flags under 50% after 3+ chances
- **Carry Chains** — tasks carried forward 3 or more times, oldest first, with *Shelve* and *Open*
- **Tag Trend** — each tag's share of tasks vs the previous period, with ▲ / ▼ for moves of 5 points or more
- **Carry-over analysis** — counted on the day each task was left unfinished; Month/Year views add a by-week / by-month trend chart (Year stops at the current month) and show the specific dates behind each weekday bar inline (hover a row for the full list)
- **Streak tracking** — current/longest streaks based on days with desk activity, with a heatmap matched to the selected period, labeled by weekday, date, or month
- **Weekends don't break streaks** — Options → Behavior toggle (on by default); Fri → Mon stays consecutive; active weekend days still count, idle weekends do not reset the streak
- **Charts** — bar, line, stacked, and pie, each with hover tooltips
- Activity heatmap (year view) and a day-by-day progress breakdown table (real date labels; today marked e.g. `Tue, Sep 22 (Today)`)

### Customization

- **108 preset themes** — 36 light + 36 medium + 36 dark, so each group fills the four-column theme grid (Nord, Dracula, Synthwave, Catppuccin, Catppuccin Latte, Catppuccin Frappé, Gruvbox, Gruvbox Mid, Solarized Mid, Rosewood, Rosé Pine Moon, Retro, Dot Matrix, Monokai, Monokai Pro, Kanagawa, Everforest, Rosé Pine Dawn, Phosphor, Fog, Twilight, the four Unit themes, etc.), browsed as mini wireframe previews, filterable by Light/Med/Dark
- **Custom Theme Builder** — create up to 5 of your own themes from 5 picked colors (Background, Surface, Sidebar, Accent, Text); ~30 CSS variables auto-derived, live preview, synced across devices
- **Options menu** — tabbed **Themes** / **Appearance** / **Behavior** panels (customize button ⚙ near the date, or **Options** in the account menu; on phones, **Options** in the menu sheet). Appearance and Behavior open on a summary list where each row has a one-line note of what's inside (hover it for the current settings); click a row to open that section, then *‹ Back* or Esc to return (Esc again closes). On/off settings are switches, and settings added in the current release carry a *New* tag until you open their section
  - Themes: 108 presets with Light/Med/Dark filters, plus Custom tab for user-created themes; a line under the filter names the current theme, with *Show* to jump to its group
  - Appearance: Card layout (Comfortable/Compact, complete button style, tag position), Typography (text size, font family), Layout (sidebar left, right, top, or bottom, calendar legend, Today's Progress; tablets and computers only, so phones show a note instead), Effects (card glow, gradient header), Background (12 patterns, 2–45% strength), Tags (tag colors; top 8 tags with *Show all*; *Reset* only on pinned colors)
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
- **Full history** — every day stays on the desk and in Search and Insights; nothing is trimmed after a year
- **Storage warning** — from 50% of the browser's ~5 MB storage the account menu shows how much is used; from 80% a banner suggests **Export All** (and **Sign in** when not signed in). If storage fills, edits stay on screen, still sync when signed in, and are included in Export All
- **Several tabs** — a change saved in one tab shows up in your other open tabs right away

### Mobile and PWA

- Responsive layout for phone, tablet, and desktop
- **Phone menu** — at 768px and narrower, the header keeps tabs, search, and Help (on phones, 600px and narrower, Work / Personal / Projects sit under Desk / Insights as on desktop; tablets keep them on one row); a menu button opens a bottom sheet with account and sign-in, Export / Import, Repair duplicates, Options, and What's new (close with ×, a tap outside, Esc, or a swipe down). A sync dot beside it shows sync status at a glance
- **Account menu** — the bottom of the sidebar is a single button with your name and sync status; it opens Options, Help & shortcuts, What's new, Export, Import, Repair duplicates, Sign in / out, and the version. With the sidebar at the top or bottom it sits at the right end of the bar
- **What's New** — after an update, a highlighted "What's new" link with a pulsing dot appears under the sidebar subtitle (and a dot on the account button); it opens the changelog and disappears once you close it. *What's new* or the version number in the account menu opens the changelog any time
- **Sticky bottom add bar** on mobile so capture stays reachable while scrolling
- Installable home-screen app and service worker offline shell
- **Full screen** — Options → Behavior → General hides the status bar and app tray (swipe from an edge to see them). Saved per device, not synced; with it on, the first tap after the app opens enters full screen, since browsers only allow it right after a tap or key press
- **Always the latest version online** — the service worker (`sw.js`) loads the page network-first and only falls back to the saved copy offline, so a new deploy shows on the first load; an app left open in the background offers a **Reload** when a newer version ships
- **Stale-copy protection** — each sync records the app version; if an out-of-date copy opens and sees cloud data from a newer version, it reloads instead of carrying tasks or overwriting settings
- Touch-friendly week strip and tap-to-complete (the complete edge widens to 40px on touch screens in the phone layout, and 28px on touch screens showing the desktop layout, like a tablet in landscape)

## How it behaves

The details behind the features above: when things happen automatically, and what to expect.

### Recurring tasks

- **When they're added** — a due template is added to *today's* date whenever the app opens or refreshes, syncs (signed in: every 5 minutes while the tab is visible, and whenever you switch back to the tab), or you switch between Work and Personal. Creating a template that's due today adds it right away. You don't need to be viewing today
- **Once per day** — each template adds at most one task per day; deleting or completing it won't bring it back that day
- **No backfill, no preview** — days the app was never opened don't get filled in later, and future days stay empty until that day arrives
- **Offline mode** — with no account there's no periodic sync, so a tab left open overnight adds the new day's tasks after a refresh or a Work/Personal switch
- **Skip holidays** — templates with *skip holidays* on aren't added on US federal holidays (when enabled in Options → Behavior) or your custom holidays
- **Every 2 weeks** — counts from the first date you pick, so it lands on that weekday every other week
- **Monthly and quarterly** — *Day of month* picks one or more dates; a 29th–31st falls on the last day in shorter months, and *Last* is always the last day. *Day of week* picks one or more weeks (1st–4th or Last) and a weekday. Quarterly runs in one of three month sets (Jan · Apr · Jul · Oct, Feb · May · Aug · Nov, or Mar · Jun · Sep · Dec)
- **Ctrl+Enter** (Cmd+Enter on Mac) adds or saves a template, the same as it saves task, note, and comment edits

### Carry forward

- **Unfinished means open** — only tasks that are neither completed nor shelved are carried; shelved tasks stay where they are
- **Auto carry** (Options → Behavior) — moves every open task from *all* earlier days onto today, not just yesterday, and stamps the day it came from so Insights can count carry-overs. It runs when the desk opens and, when signed in, on each sync, so a task you reopen on a past day moves to today at the next sync. A toast reports how many moved
- **Manual** — the *Carry forward* button appears only when there's something to carry

### Sync timing (signed in)

- **Check** — when you switch back to the tab and every 5 minutes while the tab is visible (at most once every 10 seconds), the app reads only the cloud row's last-updated time. If it matches what this device last saw, nothing is downloaded; auto carry and recurring tasks still run, and local edits upload if there are any
- **Full sync (download and merge)** — on open, after signing in to a different account, whenever another device or the add-task shortcut has saved, and at least every 4 hours
- **Push** — your edits, including auto carry, upload about 2.5 seconds after the last change; auto-added recurring tasks upload immediately. An upload is skipped when the data matches the cloud, and if another device saved in the meantime its changes are merged in first
- **Which copy wins** — each task and note records `updatedAt` when a save actually changes it (column, completed, shelved, text, tags, comments, or a hand move to another day; carrying forward doesn't count). When two devices' copies differ, the later `updatedAt` wins, with comments and tags from both kept. Copies with no `updatedAt` (not changed since 1.23.0) fall back to the older rules: completed beats shelved beats open, then more comments, then the later day, and on a full tie each device keeps its own copy. Import All (merge) uses the same rule; a merge import doesn't stamp, so an old backup can't outrank newer edits
- **Sign out** clears this device's sync marker, so the next sign-in starts with a full sync
- **Typing is never interrupted** — a sync (or a change from another tab) redraws the board only when something changed, and waits while you're typing a comment, editing a task, or adding to a column; it lands when you click or tab away. Unsent comments, edits, and the cursor position survive the redraw
- **Offline** — nothing leaves the browser; use Export All for backups

### Insights

- **Lingering Tasks ignores the period** — it always shows what's open right now; tasks on future days and tasks created today are left out
- **Shelved Review dates** — tasks are grouped by the day they sit on, because the app doesn't record when a task was shelved
- **Bring back** — moves the task (same ID, not a copy) to today's Active column and clears its carry stamp, so it isn't counted as a carry-over
- **Month chart trimming** — the Daily breakdown skips empty days after today, and, when Quieter weekends covers the desk, empty Saturdays and Sundays (no tasks, notes, or comments). A note under the legend counts the hidden weekend days and links to the setting. Totals, the pie chart, the heatmap, and the Day-by-day table still include every day
- **Comparisons in progress** — Month and Year compare against the same number of days at the start of the previous period until the period ends; Week compares full weeks
- **Recurring chances** — a due day counts when the desk was used that day (something was created on it or sits on it), from the template's creation date on, skipping holidays when the template skips them. Copies are matched by the day they were created, since carrying moves them. Missed = chances − done − still open, so it covers deleted, shelved, and never-done copies. Rows with no chances in the period are hidden
- **Carry stamps** — carrying moves a task, so each carry now adds to `carryCount` and the first carry sets `carryStart` (alongside the existing `carriedFrom`, the most recent source day). Tasks carried before 1.23.0 read as one carry. Moving by hand, sending to the other desk, and *Bring back* clear all three. Sync keeps them, and when two copies of a task merge, the higher count and earlier start win
- **Carry Chains period** — a chain shows when its run (`carryStart` to `carriedFrom`) overlaps the period; *Still open* always means open today
- **Tag Trend rules** — shares are of all tasks on days in each period (a task with two tags counts under both, so shares can add past 100%). Week compares with last week, Month with last month, Year with last year, to the same point while the period is in progress. Under 10 tasks on either side shows shares without arrows; no tasks at all in the previous period says so

### Deleting

- **Undo** — the toast after a delete offers *Undo* for 8 seconds

### Layout and controls

- **Desktop scrolling** — the desk scrolls like a normal page: the date / progress / add-task card scrolls away at the top, and the sidebar scrolls on its own
- **Patterned background** — Options → Appearance → Background. Twelve line-based patterns (Graph paper, Plus grid, Isometric, Diagonal, Pinstripe, Crosshatch, Hexagon, Herringbone, Basketweave, Chevron, Greek key, Dot grid) at 2–45% strength. Drawn in the theme's text color so it follows theme changes; only the page behind the board is patterned, cards stay solid. Off by default
- **Sidebar at the top or bottom** — above 768px the sidebar becomes a horizontal bar (one row from 1280px, two below). The week strip replaces the calendar, the account button sits at the right end (its menu opens downward from a top bar), the collapse button is hidden, and with a bottom bar search results open upward and toasts sit above it. Phones keep their normal layout whatever the setting, including Right, even when it syncs from another device
- **Column lanes when dragging** (desktop, 1025px and wider, where the columns sit side by side) — while you drag a task, the space under each column all the way down the page belongs to that column: New, Active, or Completed (the Completed / Shelved column marks it done; drop on the Shelved box to shelve). The far left margin counts as New and the far right as Completed. The column's box gets the dashed outline and, below it, a strip runs from the box to your cursor. Gaps between columns and the Notes area don't accept drops, and the boxes keep their normal size when you're not dragging. Phones and tablets stack the columns, so there are no lanes there
- **Completed tasks collapse** — once a day has 5 completed tasks (adjustable 3–20, or off, in Options → Behavior) they fold into a *Completed (N)* row you can tap to open
- **Tag box** — clicking *tag* on a card opens a text field with your two most-used tags; it stays open until you add a tag, press Esc, or click outside it
- **Today's Progress** — the sidebar card always shows today, whichever day you're viewing
- **What's new** — the link under the subtitle appears once per new version and disappears after you close the changelog
- **Help** — the **?** beside the title opens a short guide in folding sections, all open each time Help opens (tap a heading to fold it away). **T** / **N** start a new task / note and **[** / **]** change the day whenever you aren't typing. The search box at the top filters every section down to the matching lines, and the grid of short section names under it (four across, three on a phone) jumps to a section. Esc in the search box clears it; Esc again closes Help. The mechanics on this page live here rather than in Help
- **Local history** — every day is kept in this browser's copy; the storage warning tells you when it's getting full

## Tech stack

- Single-file app: `index.html` / `work-desk.html` (vanilla JS, no build required to run)
- `localStorage` for local state; Supabase for optional cloud
- CSS variables for theming
- Optional Node test tooling (`tests/`, Playwright `e2e/`)

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
├── tests/desk-logic.test.mjs  # Unit tests; loads the real functions from work-desk.html
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
| Start a new task / note (when not typing) | `T` / `N` |
| Previous / next day (when not typing) | `[` / `]` |
| Add task / note | `Ctrl/Cmd + Enter` |
| Add comment / update | `Ctrl/Cmd + Enter` |
| Save an edit (task, note, comment, recurring task) | `Ctrl/Cmd + Enter` |
| Bold / Italic / Underline | `Ctrl/Cmd + B` / `I` / `U` |
| Reorder a project, note, or project task | `Alt + ↑` / `Alt + ↓` |
| Move around a menu (card ⋮, recurring ⋮, account, project More) | `↑` / `↓` (`Home` / `End` for first / last) |
| Cancel / close a menu, or leave the add box | `Escape` |

## Data storage

| Store | Contents |
|-------|----------|
| Local | `work-desk-data-work`, `work-desk-data-personal`, projects + recurring keys, preferences, and `work-desk-sb-sync` (the signed-in account's last-seen cloud time and upload fingerprint) |
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


E2E covers add → New, complete/uncomplete, reload persistence, export tombstones, move-to-date ID uniqueness, hashtag tagging (extraction, case-insensitivity, add/remove via the tag button), search overlay (result count, `#tagname` filtering, close/outside-click), project tasks (mid-edit preservation, empty-save deletion, cancel revert, tombstone tracking, double-click editing), dynamic add-form placeholder, project note list padding, settings popout 3-tab split (Themes/Appearance/Behavior), theme filter buttons (Light/Med/Dark/Custom switching), custom theme builder (add/edit/delete/apply/persist/max-5 cap), comments (add/edit/delete/badge/collapse/split to task or note/undo/text hover actions), recurring templates (add/edit/delete/persist), Insights tab (period selector, navigation, charts, summary stats, day-by-day date labels), streak weekend toggle (default, effect on streaks, persistence), Desk vs Projects view separation, project lifecycle (empty state, rename, delete confirm/cancel, notes, tabs, persistence, sidebar counts), Work/Personal context isolation, day navigation and Back to today, desk notes, carry forward, and the Help / What's New modals. The auth modal is dismissed via **Continue offline**. `e2e/sync.spec.ts` runs cloud sync and account creation against a stand-in for the Supabase project (`FakeCloud`): sign-in and sign-out, uploads and downloads, outages, and **Create account** with email confirmation on or off, form validation, and server errors.

## Browser support

- Chrome / Edge 90+
- Firefox 90+
- Safari 14+
- Mobile browsers with PWA support

## Themes

108 presets — 36 light + 36 medium + 36 dark — browsable as mini wireframe previews in Options → Themes, filterable by Light/Med/Dark.

**Light (36):** Default, Slate, Arctic, Paper, Latte, Sand, Coral, Rose, Sakura, Mint, Sage, Lavender, Catppuccin Latte, Solarized, Sepia, Tokyo Day, Nord Light, Honey, Cloud, Peach, Olive, Seafoam, Citrus, Everforest, Mediterranean, Gruvbox Light, Rosé Pine Dawn, Vaporwave, Synthwave, Cyberpunk, Outrun, Retro, Unit Zero, Unit One, Unit Two, Unit Eight

**Medium (36):** Fog, Overcast, Steel, Fjord, Nimbus, Pewter, Horizon, Solarized Mid, Denim, Lichen, Fern, Tundra, Moss, Basalt, Dot Matrix, Driftwood, Clay, Sandstone, Umber, Terracotta, Gruvbox Mid, Flint, Twilight, Haze, Plum Mid, Mulberry, Merlot, Rosewood, Catppuccin Frappé, Ash, Graphite, Concrete, Unit Zero, Unit One, Unit Two, Unit Eight

**Dark (36):** Default, OLED, Nord, Dracula, Catppuccin, Tokyo Storm, Solarized, Gruvbox, Ocean, Forest, Everforest, Dusk, Warm, Midnight, Noir, Kanagawa, Mocha, Rose, Ember, Glacier, Plum, Storm, One Dark, Phosphor, Monokai, Monokai Pro, Rosé Pine, Rosé Pine Moon, Synthwave, Cyberpunk, Outrun, Vaporwave, Unit Zero, Unit One, Unit Two, Unit Eight

**Unit themes** — one per pilot (Zero: prototype blue and white; One: purple and neon green; Two: production red and orange; Eight: pink and mint), each in all three tiers, with a thin color stripe across the top header. **Dot Matrix** was called Game Boy before 1.14.0; a saved selection carries over automatically.

## Future ideas

- **Data encryption** — opt-in PIN or passphrase (AES-256) encryption of stored data so the database owner can't read tasks in plain text; a 4–6 digit PIN blocks casual viewing, a full passphrase blocks determined attacks
- **Local weather** — an opt-in readout like 72°F ☀️ in the header or sidebar from Open-Meteo (free, no API key); off by default because it asks for your location
- **Faster edge scrolling while dragging** — scroll the page quickly when a dragged task nears the top or bottom of the window, so reaching a column far up the page doesn't rely on the browser's slow built-in scrolling
- **Settings window with search** — a wider Options panel with every category (Themes, Appearance, Behavior) in one list down the left and a search box that finds any setting by name, highlighting matches. A natural next step after the 1.17.0 summary-list Options once there are many more settings; on phones it would be a full-screen sheet
- **Suggested colors for custom themes** — next to the five manual pickers, a *Suggest from a color* option: pick a color (color wheel or hex) or a mood (e.g. calm, cozy, energetic, focused), choose dark or light, and the app fills in background, surface, sidebar, accent, and text from color-harmony rules, with readable contrast enforced. A *Surprise me* button rolls a random harmonious set. Every suggestion stays editable with the existing pickers. Roughly 100–150 lines and no new files, so low overhead
## License

Personal use. Feel free to fork and customize for your own productivity needs.
