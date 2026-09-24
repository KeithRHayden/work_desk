# Changelog

All notable changes to **Work Desk** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with semantic versioning.

---

## [1.7.0] — 2026-09-22

### Added
- **Comment → Task / Note** — hover any comment and click **→ task** or **→ note** to split it into its own item on the same day; parent tags carry over, a breadcrumb comment links back to the source task, and the original comment is annotated with "→ moved to…"
- **Undo support** — confirmation toast with Undo reverses the split instantly, removing the new item and restoring the original comment
- **Weekends don't break streaks** — new Options → Behavior → Insights toggle (on by default); Fri → Mon stays consecutive for streak counting, and active weekend days still count toward the streak

### Improved
- **Insights day-by-day labels** — rows show the real date (e.g. `Mon, Sep 21`); today is labeled `Tue, Sep 22 (Today)` instead of bare "Today" / "Yesterday"
- **Comment hover actions** — edit / delete / → task / → note are all plain text links in one consistent row

### Fixed
- **Projects tab now fully hides the daily desk** — switching to Projects no longer shows the date header, progress bar, and kanban board above the project view (CSS specificity fix where `#desk-view`'s ID-level `display:flex` overrode the `.hidden` class)
- **Auto carry off is now respected when signed in** — cloud sync (on sign-in, window focus, and every 5 minutes) was carrying unfinished tasks forward even with Auto carry turned off; it now only carries when the toggle is on, and still adds due recurring tasks either way
- **Project sidebar counts update live** — adding, saving, or deleting a project note/task now refreshes the "1 note · 2 tasks" line in the sidebar instead of showing "Empty" until you switch projects

---

## [1.6.0] — 2026-09-16

### Added
- **24 medium themes** — a new brightness tier between Light and Dark: Fog, Overcast, Steel, Fjord, Nimbus, Pewter, Horizon, Lichen, Fern, Tundra, Moss, Basalt, Driftwood, Clay, Sandstone, Umber, Flint, Twilight, Haze, Plum Mid, Mulberry, Ash, Graphite, Concrete
- **"Med" filter** in the theme picker — browse medium-tone themes grouped by color family (Blue/Cool, Green/Earth, Warm/Earthy, Purple/Pink, Neutral/Gray)

### Improved
- Theme count raised to **72** (24 light + 24 medium + 24 dark) plus unlimited custom themes
- **"All" filter removed** — replaced with dedicated Light | Med | Dark | Custom filters for faster browsing

---

## [1.5.1] — 2026-09-16

### Fixed
- **Strikethrough text** — `<s>` and `<del>` tags were not in the `sanitizeHtml` whitelist, so any re-render (adding a tag, comment, or triggering `render()`) silently stripped strikethrough formatting, altering visible text and breaking word-wrap

---

## [1.5.0] — 2026-09-16

### Added
- **8 new themes** — Honey, Cloud, Peach, Olive (light) and Ember, Glacier, Plum, Storm (dark); total now 48 (24 light + 24 dark)
- **Custom Theme Builder** — create up to 5 fully custom themes by choosing 5 colors (Background, Surface, Sidebar, Accent, Text) plus light/dark mode; all remaining ~30 CSS variables are automatically derived
- **"Custom" filter tab** in the theme picker — browse, apply, edit, and delete custom themes alongside the 48 presets
- **Native OS color picker + hex text input** for each color with a real-time live preview of the full app layout
- **Cloud sync** for custom themes via the existing Supabase preferences system

### Improved
- **Settings popout** split into three tabs — Themes, Appearance, Behavior — so themes get dedicated space and layout/effects are easier to find

---

## [1.4.3] — 2026-09-13

### Improved
- **Settings icon** — theme/behavior button changed from horizontal-sliders to a standard gear icon (Material Design)
- **Password autofill** — login form fields now have `aria-label` and `name` attributes so password managers can identify them

### Fixed
- **Board width** — a stale `max-width: 1240px` on `#desk-view` was narrowing the desk on wide screens; removed

---

## [1.4.2] — 2026-09-10

### Fixed
- **Mobile sidebar** — Help (`?`) and version button were hidden because the entire subtitle row was `display: none`; the row is visible again with a compact layout
- **Mobile Export / Import** — buttons were squished to the left; they now span the card in equal-width columns
- **Comment save ghost form** — saving a comment no longer re-opens a pre-filled Add form with the same text
- **Holiday calendar dates** — fixed-date holidays (e.g. Independence Day) now highlight on the actual calendar date; when federal observance shifts (Sat→Fri / Sun→Mon), the observed day is also marked so skip-holidays still covers the day off
- **Desktop sticky header** — date/add-form card stays pinned while only the task board scrolls (flex layout on `#desk-view`)
- **Desktop scroll regression** — an earlier flex-pin attempt targeted a non-existent `.desk-view` class and blocked scrolling; selector corrected to `#desk-view`
- **Layout / CSS tests** — Playwright checks for desktop board scroll + pinned header, and mobile help/version + backup button width; unit invariants cover the `#desk-view` selector and mobile media rules

---

## [1.4.1] — 2026-09-09

### Added
- **What's New changelog** — version button next to the help `?` opens a modal with full version history, collapsible "Older versions" accordion, and a link to the GitHub changelog
- **CHANGELOG.md** — permanent version history file for the GitHub repo

### Improved
- Add-task text field stretches to fill available horizontal space on desktop
- Changelog modal shows last 5 versions in full detail; older ones collapse into an accordion capped at 3
- Version button relocated from sidebar footer to the subtitle row next to the `?` help button

### Fixed
- Extra divider line between v1.0.0 and the Older Versions accordion in the changelog modal
- **Comment draft lost on background sync** — typing a comment and clicking away (or waiting for the 5-minute auto-sync) no longer destroys unsaved text; drafts are captured before render and restored after

---

## [1.4.0] — 2026-09-09

### Added
- **Holiday-aware recurring tasks** — skip US federal holidays or custom dates you define
- **Custom holidays** — add your own dates in Options → Behavior → Holidays
- **Recurring task editing** — edit templates from the card overflow menu or the recurring panel
- **Tags on recurring templates** — tag a template and every injected task inherits the tags
- **Confirm before delete** — optional prompt in Options → Behavior → General
- **Font picker** — choose from 8 font families in Options → Appearance
- **Text size selector** — Small / Default / Large
- **Sidebar position** — move the sidebar to the left or right
- **Card glow effect** — accent-colored hover glow (Options → Appearance → Effects)
- **Gradient header** — subtle accent tint on the sticky header bar

### Improved
- Behavior tab reorganized into General, Tasks, Projects, and Holidays sections
- Recurring panel restructured — add form at top, existing templates listed below
- Checkbox contrast improved on dark themes (derived from text color, not border)
- Recurring template tombstoning — deleted templates stay deleted across syncs
- Context-aware recurring modal — closes after editing from a task card, returns to panel from sidebar
- Duplicate recurring template detection with visual cleanup hints

### Fixed
- Sync icon stuck spinning when `mergeDeletedIds` was undefined (added function + try/catch)
- Font family selection not applying due to CSS specificity (switched to CSS variable on body)
- Recurring edit form layout breaking when tag chips forced vertical text wrapping

---

## [1.3.0] — 2026-09-03

### Added
- **Export All / Import All** — single-file backup across Work, Personal, and Projects
- **Import context safeguard** — warns when importing a file from a different desk
- **Project tabbed layout** — Notes and Tasks in separate tabs per project
- **Project archiving** — completed tasks auto-archive; manual archive for notes
- **Note truncation** with show more / show less toggle (configurable in Behavior tab)
- **Customize (gear) button** added to project tab header
- **Double-click to edit** project notes and tasks
- **Date-aware add placeholder** — shows "Add a task for tomorrow…" when viewing future days

### Improved
- Export / Import buttons renamed to "Export [current] Desk" and "Import [current] Desk"
- Sidebar backup section streamlined — side-by-side Export and Import buttons, dropdown for all options
- Project item tombstoning — deleted items stay deleted across syncs
- Bullet-point styling fixed in project note content (no longer bleeds into border)

### Fixed
- Project tasks disappearing mid-typing due to background sync re-render
- Deleted project items reappearing after refresh (tombstone tracking added)

---

## [1.2.0] — 2026-08-21

### Added
- **Tags** — type `#word` inline or use the tag button; chips appear top-right of cards
- **Tag search** — search `#tagname` to filter; combine with text for narrower results
- **Search overlay** — floating results dropdown that doesn't cover the search input
- **In-column quick add** — add tasks directly inside New and Active columns

### Improved
- Sticky header restyled — background tint, shadow, rounded top corners, carded add form
- Progress bar layout — legend moved right, done count moved left
- Carry button only visible when there's something to carry; dropdown removed for single action
- "WORK" and "Today" badges unified in size and capitalization
- Help modal and README fully updated with tag, search, and layout documentation

### Fixed
- Tag search failing when combining a `#tag` with additional words (split into tag + text filter)
- Tag search not working when `#tag` appears mid-query (now scans entire query)
- Move-task calendar ignoring week-start-day setting (replaced native input with custom calendar)
- Comment text selection triggering drag instead of highlight

---

## [1.1.0] — 2026-08-19

### Added
- **Insights tab** — weekly, monthly, and yearly views with productivity metrics
- **Week-over-week comparison** — compares completions, carry-overs, and rates against prior week
- **Carry-over analysis** — bar chart showing which days carry over most
- **Streak tracking** — current/longest streaks with a period-matched activity heatmap
- **Hoverable charts** — bar, line, stacked, and pie with interactive tooltips
- **Activity heatmap** — GitHub-style grid in the year view, themed to active palette
- **Carry-over tracking** with `carriedFrom` field for accurate counting
- **Remember last tab and date** on refresh (tab + date persistence)
- **40 themes** — 20 light, 20 dark with mini wireframe swatch previews
- **Theme swatch wireframes** — replaced color bars with mini app layout previews
- **Confetti toggle**, week start day, and startup view options
- **Auto-collapse threshold** now user-selectable (3–20)

### Improved
- Shelved tasks excluded from completion percentage (neutral treatment)
- Persistent expanded comment IDs across navigation and refresh
- Options menu tabbed into Appearance and Behavior
- Color swatch accuracy — all 40 theme previews now match actual CSS variables
- Pie chart: removed static legend, added hover tooltips, smart percentage display
- Streak heatmap: flexbox layout fills full card width

### Fixed
- Comments collapsing after page refresh (persistent expanded comment state)
- `keepCommentsOpen` not surviving day navigation (jump-to-today now respects setting)
- Streak chart overflowing card width

---

## [1.0.0] — 2026-08-14

### Added
- **Auto-collapse Completed column** — configurable threshold (default 5), toggle in Customize
- **Sign-in from offline mode** — "Sign in to sync" button in sidebar account footer
- **Sticky mobile add bar** — on ≤768px, the add form docks to the bottom of the screen

### Improved
- Theme + density + preferences now sync to the cloud (last change wins via `prefs.updatedAt`)

### Fixed
- README formatting corrected

---

## [0.9.0] — 2026-08-13

### Added
- **Persistent theme sync** — theme, density, Keep comments open, Auto-collapse, and Auto carry follow your account across devices

### Fixed
- Recurring task sync stripping `recurringTemplateId` during normalize — inject couldn't detect existing instances, causing duplicates
- Completing or deleting a recurring task now stamps the template as done for today
- Repair duplicates also collapses same-day copies of the same recurring template

---

## [0.8.0] — 2026-08-12

### Added
- **Keep Comments Open** toggle — multiple comment panels can stay open at once
- **Help modal** ("How to use Work Desk") — comprehensive in-app documentation

### Fixed
- Merge no longer resurrects tasks on old days if they already live on another day locally
- Deletes are remembered (tombstones) so sync doesn't undo them
- Carry-forward clears leftover copies from the source day
- Delete removes the ID from all days, not just the current one
- Repair now cleans cross-day duplicate IDs
- Various bug fixes: inject-before-carry order reversed, past-day recurring completion stamping, sync merge scoring (completed/shelved now weighted higher)
- Import merge keeps tombstones and strips resurrected IDs
- Backup JSON now includes `deletedIds`
- `moveItem` removes duplicate IDs from every day before placing on target
- Auto-carry pulls from all past days (not just one)
- Completing preserves New/Active column; uncomplete returns to original column

---

## [0.7.0] — 2026-08-10 – 2026-08-11

### Added
- **Comment indentation** — comments sit slightly indented under the card so they read as replies
- **Bullet points** in tasks, comments, and notes

### Fixed
- Word wrapping for comments

---

## [0.6.0] — 2026-08-06 – 2026-08-07

### Added
- **Smart merge sync** — instead of "last timestamp wins," sync now unions items from both devices and keeps the version with more comments or completed status
- **Auto sync triggers** — window focus and periodic 5-minute silent sync

---

## [0.5.0] — 2026-08-03 – 2026-08-04

### Added
- **Projects tab** — long-term notes and tasks for project ideas that aren't time-sensitive
- **Text-based action buttons** — replaced icon buttons with cleaner text labels; destructive actions hidden behind ⋮ overflow menu

### Fixed
- Race condition with Supabase sync — local timestamp now updates immediately on save
- Object reference issue during move — items are now deep-cloned
- Email signup redirect — Supabase confirmation URLs now point to the correct domain
- Note comments not saving (normalizeItem was stripping comments from notes)
- Projects tab UI fixes (padding, counter spacing)

---

## [0.4.0] — 2026-07-21

### Added
- **Comments on notes** — timestamped updates and threaded follow-ups on notes
- **Paragraph spacing** in notes

### Improved
- Comment look and feel refined for both tasks and notes

### Fixed
- Note comments not being saved correctly (multiple rounds of fixes)

---

## [0.3.0] — 2026-07-20 – 2026-07-21

### Added
- **Theme favicons** — each theme gets a matching favicon
- **Task deduplication** — logic to prevent duplicates on sync
- **Repair duplicates button** — manual cleanup for users who encounter duplicates
- **Sign-out button** made more obvious, especially on mobile
- **Mobile sidebar icons**

### Improved
- Light theme color swatches adjusted to be less dark

---

## [0.2.0] — 2026-07-18

### Added
- **Multiple themes** — light and dark presets with auto-archive support
- **Mobile calendar navigation** — week strip with ‹/› buttons, smooth scrolling
- **Calendar highlighting** and sidebar width adjustments

### Fixed
- Timezone issues — switched from UTC to device local timezone
- Calendar spacing on the sidebar
- Mobile calendar scrolling

---

## [0.1.0] — 2026-07-16

### Added
- **Initial release** — daily task and note desk with New / Active / Done / Shelved columns
- **Supabase cloud sync** — device-wide syncing via cloud database
- **Email sign-in / sign-out** — replaced anonymous Supabase auth with email-based auth
- **PWA support** — installable as a home screen app on desktop and mobile (service worker + manifest)
- **In-app documentation** — "How to use Work Desk" help section

---

_For commit-level detail, see the [commit history](https://github.com/KeithRHayden/work_desk/commits/main/)._
