# Changelog

All notable changes to **Work Desk** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with semantic versioning.

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
- **What's New changelog** — version button in the sidebar opens a changelog modal

### Improved
- Behavior tab reorganized into General, Tasks, Projects, and Holidays sections
- Recurring panel restructured — add form at top, existing templates listed below
- Checkbox contrast improved on dark themes
- Recurring template tombstoning — deleted templates stay deleted across syncs
- Context-aware recurring modal — closes after editing from a task card, returns to panel from sidebar

### Fixed
- Sync icon stuck spinning when a merge error occurred
- Duplicate recurring template detection with cleanup hints
- Font family selection not applying to the page

---

## [1.3.0] — 2026-09-03

### Added
- **Export All / Import All** — single-file backup across Work, Personal, and Projects
- **Import context safeguard** — warns when importing a file from a different desk
- **Project tabbed layout** — Notes and Tasks in separate tabs per project
- **Project archiving** — completed tasks auto-archive; manual archive for notes
- **Note truncation** with show more / show less toggle
- **Customize (gear) button** added to project tab header
- **Double-click to edit** project notes and tasks
- **Date-aware add placeholder** — shows "Add a task for tomorrow…" when viewing future days

### Improved
- Export / Import buttons renamed to "Export [current] Desk" and "Import [current] Desk"
- Sidebar backup section streamlined — side-by-side Export and Import buttons
- Project item tombstoning — deleted items stay deleted across syncs
- Bullet-point styling fixed in project note content

### Fixed
- Project tasks disappearing mid-typing due to background sync re-render
- Deleted project items reappearing after refresh

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
- Carry button only visible when there's something to carry
- Help modal fully updated with tag, search, and layout documentation

### Fixed
- Tag search failing when combining a `#tag` with additional words
- Move-task calendar ignoring week-start-day setting
- Comment text selection triggering drag instead of highlight

---

## [1.1.0] — 2026-08-19

### Added
- **Insights tab** — weekly, monthly, and yearly views with productivity metrics
- **Week-over-week comparison**, carry-over analysis, and streak tracking
- **Hoverable charts** — bar, line, stacked, pie with tooltips
- **Activity heatmap** — GitHub-style grid in the year view
- **Carry-over tracking** with `carriedFrom` field
- **Remember last tab and date** on refresh
- **40 themes** — 20 light, 20 dark with mini wireframe swatches
- **Confetti toggle**, week start day, and startup view options

### Improved
- Shelved tasks excluded from completion percentage
- Auto-collapse threshold now user-selectable (3–20)
- Persistent expanded comment IDs across navigation and refresh
- Options menu tabbed into Appearance and Behavior

### Fixed
- Duplicate recurring tasks on multi-device sync
- Cloud merge producing stale data on secondary devices
- Comments collapsing after page refresh

---

## [1.0.0] — 2026-08-14

### Added
- Daily task and note desk with New / Active / Done / Shelved columns
- Work, Personal, and Projects contexts
- Supabase cloud sync with offline-first support
- Recurring task templates with daily, weekly, and custom schedules
- Comments and timestamped updates on tasks and notes
- Calendar navigation with open-task badges on past days
- PWA installable on desktop and mobile
- Dark and light themes

---

_For commit-level detail, see the [commit history](https://github.com/KeithRHayden/work_desk/commits/main/)._
