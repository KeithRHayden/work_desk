# Work Desk

A personal daily desk for tasks, notes, and light project tracking — with optional cloud sync and a PWA install.

![PWA Ready](https://img.shields.io/badge/PWA-Ready-blue)
![Self Hosted](https://img.shields.io/badge/Self--Hosted-GitHub%20Pages-green)
![Vanilla JS](https://img.shields.io/badge/Stack-Vanilla%20JS-yellow)

## Features

### Task management

- **Kanban board** — New → Active → Completed / Shelved
- **Drag and drop** — reorder within a day or move between columns
- **Shelving** — park a task without deleting it
- **Carry forward** — a one-click button that only appears when there's something to carry; enable auto-carry (Options → Behavior) to pull it in every time you open the desk
- **Recurring templates** — daily / weekdays / weekly / custom; injects once per due day (completed instances count)
- **Comments / updates** — timestamped follow-ups on tasks
- **Move to another day** — keeps a single ID (no dual-day clones)

### Notes and projects

- **Quick notes** — alongside the task board
- **Rich text** — bold, italic, underline, bullets
- **Projects** — third context for longer-lived notes and tasks with updates

### Organization

- **Work / Personal / Projects** — separate contexts
- **Date navigation** — sidebar calendar (desktop) and week strip (narrow screens)
- **Tags** — tag a task or note by typing `#word` inline or clicking the `tag` action; chips render top-right on the card, always uppercase and case-insensitive (`#ACE` == `#ace`)
- **Search** — floating overlay with a result count; search current list or both Work and Personal, and use `#tagname` to filter by tag
- **Repair duplicates** — cleans same-ID and same-day recurring copies left by sync races

### Insights

- Week / month / year views with a period selector and prev/next navigation
- **Productivity summary** — completion rate, average daily completions, carry-over rate, most productive day
- **Week-over-week** comparison (week view)
- **Carry-over analysis** — which weekdays tasks most often carry over from
- **Streak tracking** — current/longest completion streaks with a heatmap matched to the selected period
- **Charts** — bar, line, stacked, and pie, each with hover tooltips
- Activity heatmap (year view) and a day-by-day progress breakdown table

### Customization

- **40 themes** — 20 light + 20 dark (Nord, Dracula, Synthwave, Catppuccin, Gruvbox, etc.), browsed as mini wireframe previews, filterable by Light/Dark/All
- **Options menu** — tabbed **Appearance** / **Behavior** panels (customize button ⊟ near the date)
  - Appearance: theme, Comfortable/Compact density, strike-through completed tasks
  - Behavior: keep comments open, auto-collapse completed (threshold 3–20), auto carry each day, first day of week, startup view (remember last viewed vs. always open Today), celebration confetti
- **Keep comments open** — multiple comment panels at once; now persists correctly across day navigation and refresh
- Collapsible sidebar on desktop, with a "Today's Progress" mini card that always reflects today regardless of which day you're viewing

### Cloud sync and offline

- **Optional Supabase sync** — email sign-in; devices merge rather than overwrite
- **Synced preferences** — theme, density, strike-through, comment/completed/auto-carry toggles, week start day, startup view, and confetti follow your account (last change wins)
- **Continue offline** — use the desk without an account; data stays in this browser only (clearing site data can wipe it). Use **Sign in** in the sidebar account footer when you’re ready to sync.
- Export / import JSON backups (side-by-side buttons in the sidebar; includes delete tombstones)
- Auto-prune of days older than 1 year from the local cache (cloud keeps history)

### Mobile and PWA

- Responsive layout for phone, tablet, and desktop
- **Sticky bottom add bar** on mobile so capture stays reachable while scrolling
- Installable home-screen app and service worker offline shell
- Touch-friendly week strip and tap-to-complete

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
├── playwright.config.ts
├── package.json            # Optional: unit + e2e scripts
└── README.md
```

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| Add task / note | `Ctrl/Cmd + Enter` |
| Bold / Italic / Underline | `Ctrl/Cmd + B` / `I` / `U` |
| Cancel / close | `Escape` |

## Data storage

| Store | Contents |
|-------|----------|
| Local | `work-desk-data-work`, `work-desk-data-personal`, projects + recurring keys, preferences |
| Cloud | Supabase `user_data.data` JSON (work, personal, projects, recurring, prefs) |
| Backup | Export JSON includes `days` + `deletedIds` tombstones |

Tips:

- Prefer signing in if you care about durability across browsers or devices
- Use **Export backup** before clearing site data or switching machines
- **Repair duplicates** if sync ever leaves twin cards

## Testing

Requires Node.js. Unit tests need no extra packages; E2E needs Playwright (and a working npm registry).

```bash
npm test                 # unit tests + init-order (TDZ) audit
npm run test:e2e         # Playwright smoke (serves app on :4173)
npm run test:e2e:ui      # Playwright UI mode
npm run test:all         # unit + e2e
```

E2E covers add → New, complete/uncomplete, reload persistence, export tombstones, move-to-date ID uniqueness, hashtag tagging (extraction, case-insensitivity, add/remove via the tag button), and the search overlay (result count, `#tagname` filtering, close/outside-click). The auth modal is dismissed via **Continue offline**.

## Browser support

- Chrome / Edge 90+
- Firefox 90+
- Safari 14+
- Mobile browsers with PWA support

## Themes

40 presets — 20 light + 20 dark — browsable as mini wireframe previews in Options → Appearance, filterable by Light/Dark/All.

**Light (20):** Default, Slate, Arctic, Paper, Latte, Sand, Coral, Rose, Sakura, Mint, Sage, Lavender, Solarized, Sepia, Tokyo Day, Nord Light, Vaporwave, Synthwave, Cyberpunk, Outrun

**Dark (20):** Default, OLED, Nord, Dracula, Catppuccin, Tokyo Storm, Solarized, Gruvbox, Ocean, Forest, Dusk, Warm, Midnight, Noir, Mocha, Rose, Synthwave, Cyberpunk, Outrun, Vaporwave

## License

Personal use. Feel free to fork and customize for your own productivity needs.
