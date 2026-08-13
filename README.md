Work Desk

A personal daily desk for tasks, notes, and light project tracking — with optional cloud sync and a PWA install.

PWA Ready Self Hosted Vanilla JS

Features

Task management





Kanban board — New → Active → Completed / Shelved



Drag and drop — reorder within a day or move between columns



Shelving — park a task without deleting it



Carry forward — manual or auto-carry unfinished open tasks from past days into today



Recurring templates — daily / weekdays / weekly / custom; injects once per due day (completed instances count)



Comments / updates — timestamped follow-ups on tasks



Move to another day — keeps a single ID (no dual-day clones)



Notes & projects





Quick notes — alongside the task board



Rich text — bold, italic, underline, bullets



Projects — third context for longer-lived notes and tasks with updates



Organization





Work / Personal / Projects — separate contexts



Date navigation — sidebar calendar (desktop) and week strip (narrow screens)



Search — current list or both Work & Personal



Repair duplicates — cleans same-ID and same-day recurring copies left by sync races



Insights





Week / month / year completion charts



Activity heatmap (year view)



Day-by-day progress breakdown



Customization





32 themes — light and dark (Nord, Dracula, Synthwave, etc.)



Comfortable / Compact card density



Keep comments open — multiple comment panels at once



Auto-collapse Completed — collapses the Completed list at 5+ items (tap heading to expand)



Collapsible sidebar on desktop



Cloud sync & offline





Optional Supabase sync — email sign-in; devices merge rather than overwrite



Continue offline — use the desk without an account; data stays in this browser only (clearing site data can wipe it — create an account to back up)



Export / import JSON backups (includes delete tombstones)



Auto-prune of days older than 1 year from the local cache (cloud keeps history)



Mobile & PWA





Responsive layout for phone, tablet, and desktop



Sticky bottom add bar on mobile so capture stays reachable while scrolling



Installable home-screen app + service worker offline shell



Touch-friendly week strip and tap-to-complete



Tech stack





Single-file app: index.html / work-desk.html (vanilla JS, no build required to run)



localStorage for local state; Supabase for optional cloud



CSS variables for theming



Optional Node test tooling (lib/, tests/, Playwright e2e/)



Getting started



Local use (no setup)





Open index.html or work-desk.html in a modern browser



Choose Continue offline or create / sign in to an account



Start adding tasks



GitHub Pages





Push at least:





index.html



manifest.json



sw.js



icon-192.png



icon-512.png



Settings → Pages → deploy from main



Visit https://<user>.github.io/<repo>/

Update sw.js / manifest paths if your Pages site is not served under /work_desk/.

Supabase (optional cloud sync)





Create a Supabase project



Run:

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





Enable Email auth; optionally disable “Confirm email” for easier local signup



Set SB_URL and SB_KEY in the HTML to your project values



File structure

work-desk/
├── index.html              # Deployable app
├── work-desk.html          # Dev copy (kept in sync with index.html)
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── icon-192.png / icon-512.png
├── lib/desk-logic.mjs      # Pure sync/recurring helpers (unit-tested)
├── tests/desk-logic.test.mjs
├── e2e/smoke.spec.ts       # Playwright smoke tests
├── playwright.config.ts
├── package.json            # Optional: unit + e2e scripts
└── README.md



Keyboard shortcuts







Action



Shortcut





Add task / note



Ctrl/Cmd + Enter





Bold / Italic / Underline



Ctrl/Cmd + B / I / U





Cancel / close



Escape



Data storage







Store



Contents





Local



work-desk-data-work, work-desk-data-personal, projects + recurring keys, preferences





Cloud



Supabase user_data.data JSON (work, personal, projects, recurring)





Backup



Export JSON includes days + deletedIds tombstones

Tips:





Prefer signing in if you care about durability across browsers or devices  



Use Export backup before clearing site data or switching machines  



Repair duplicates if sync ever leaves twin cards



Testing

Requires Node.js. Unit tests need no extra packages; E2E needs Playwright (and a working npm registry).

npm test                 # unit: node --test tests/desk-logic.test.mjs
npm run test:e2e         # Playwright smoke (serves app on :4173)
npm run test:e2e:ui      # Playwright UI mode
npm run test:all         # unit + e2e

E2E covers add → New, complete/uncomplete, reload persistence, export tombstones, and move-to-date ID uniqueness. The auth modal is dismissed via Continue offline.

Browser support





Chrome / Edge 90+  



Firefox 90+  



Safari 14+  



Mobile browsers with PWA support



Themes

Light: Default, Slate, Arctic, Paper, Latte, Sand, Coral, Rose, Mint, Lavender, Solarized, Tokyo Day, Vaporwave, Synthwave, Cyberpunk, Outrun  

Dark: Default, Nord, Dracula, Solarized, Ocean, Forest, Dusk, Warm, Midnight, Noir, Mocha, Rose, Synthwave, Cyberpunk, Outrun, Vaporwave  

License

Personal use. Feel free to fork and customize for your own productivity needs.
