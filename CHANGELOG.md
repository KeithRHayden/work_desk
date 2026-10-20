# Changelog

All notable changes to **Work Desk** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with semantic versioning.

---

## [1.18.4] — 2026-10-20

### Improved
- **Complete edge on project tasks** — project tasks use the same left-edge complete button as desk tasks, in whichever style is picked in Options → Appearance → Card layout → *Complete button* (wider on touch screens). Finishing one still moves it to the project's Archived list, where the edge shows as done. *Checkbox* brings back the project checkbox too
- **Project header buttons** — the ✏️ and 🗑️ emoji are now plain *Rename* and *Delete* text buttons, the same height as the gear beside them (Delete turns red on hover)
- **Possible future improvements (Help)** — trimmed to data encryption, local weather, and suggested colors for custom themes. Dropped Google Assistant integration

### Fixed
- **Archived project items lost on import** — importing a Projects backup, or the projects part of an Import All backup, dropped each note's and task's archived flag, so archived items came back as active ones. They now stay in Archived

## [1.18.3] — 2026-10-15

### Fixed
- **Completed tasks wobbling while scrolling** — with a long, expanded Completed list, dimmed completed cards could jitter or paint over each other mid-scroll. The board now scrolls on its own layer (`will-change: scroll-position` on the main area) instead of Chrome repainting it on every scroll step

## [1.18.2] — 2026-10-15

### Improved
- **Options lists say what's inside** — each row on the Appearance and Behavior lists now has a short note of the settings it holds (e.g. *Card layout: Density, complete button, tag spot*) instead of the gray current value. Hover a row to see its current settings
- **‹ Back** — the back link in every Options section reads *‹ Back* instead of *‹ Appearance* / *‹ Behavior*, so longer section titles no longer run into it
- **Settings spacing** — a little more room and a faint divider between settings inside each Options section
- **Calendar legend Left open dot** — same size as the Has items and Holiday dots, and the same amber (rose on amber-accent themes) as the left-open numbers on the calendar, instead of a larger faint pill

## [1.18.1] — 2026-10-15

### Fixed
- **Calendar legend Left open sample** — the sample badge is now an empty color swatch. It used to show a fixed *2*, which read like a count of your open tasks even when nothing was left open. The real per-day numbers on past days are unchanged

## [1.18.0] — 2026-10-14

### Added
- **Complete button on the card edge** — a task card's left edge (18px; 40px on touch screens) is now its complete button: click to finish, click again to reopen. It covers the task text and action links only, stopping above an open comments panel. A press that moves more than 4px counts as an attempted drag, not a click; keyboard users get a focus ring and the same *Mark complete / Mark incomplete* label as before
- **Complete button styles** — Options → Appearance → Card layout → *Complete button*: *"Done" label* (default; reads DONE → DONE? on hover/focus → DOING while the card is dragged → DONE! when finished → UNDO? on hover of a finished card), *Bar*, *Raised bar*, *Switch*, *Circle*, *Square*, *Diamond*, *Faint ✓*, *Plain edge*, or *Checkbox* to bring back the old checkbox. Compact cards show a bar instead of the label. Synced and reset with Appearance
- **Tag position** — Options → Appearance → Card layout → *Tag position*: *Own row* (default, as before), *Slim headroom* (every task reserves a 14px tag row with smaller chips, so text starts at the same height with or without tags; long tags shorten with …), or *Action bar* (chips sit next to ⋮; on narrow cards, such as phones, chips and ⋮ move to a second line together, right-aligned). Slim headroom needs the edge button; compact cards always keep chips on their own line. Synced and reset with Appearance

### Improved
- **More room for task text** — without the checkbox row above it, task text starts at the top of the card
- **Card layout summary** — the Options row reads e.g. *Comfortable · Done label*, adding *Slim tags* or *Tags in bar* when you move tags

## [1.17.2] — 2026-10-14

### Added
- **Open desk** — Options → Behavior → General → *Open desk* chooses the desk the app starts on: *Last used* (default, the old behavior), *Work*, or *Personal*. It works alongside *On launch* (last viewed day vs. Today), syncs, and resets with Behavior
- **Calendar legend and Today's Progress switches** — Options → Appearance → Layout can hide the key under the sidebar calendar and the sidebar's Today's Progress card. Both default on, sync, and reset with Appearance; the Layout summary notes *No legend* / *No progress* when either is off

### Improved
- **New tags go away once seen** — opening a section remembers its *New* tags (stored per section and version in `work-desk-seen-new-tags`); they stay up for that visit and are gone when you go back, including the tag on the section's row. Tags still expire on their own at the next minor version
- **Shorter Options summaries** — e.g. *Last viewed · Sun* and *Weekends skipped*. The gray value now wraps to a second line instead of being cut off with an ellipsis
- **Quieter weekends label** — the *New* tag sits inline after the name instead of pushing it onto three lines, the hint is shorter (*Gray Sat/Sun on the calendar*), and the *Work desk only* choice is now *Work only* so the select leaves room for the name
- **No more 📝 on notes** — the note icon and its grid column are gone (desktop, compact, phone, with or without tags), so note text starts at the card's left edge

## [1.17.1] — 2026-10-14

### Improved
- **Options fits its list** — the Appearance and Behavior panes dropped their fixed minimum height (up to 400px), which left empty space under the shorter summary lists. The panel now sizes to each tab's list; opening a section sets the pane's minimum height to the list's height, so a short section (e.g. Layout) doesn't shrink the panel, and returning to the list clears it

---

## [1.17.0] — 2026-10-14

### Added
- **Summary-list Options** — the Appearance and Behavior tabs open on a short list of sections, each row showing its current value (e.g. *Typography: Default · System font*, *Tasks: 3 of 6 on*). Appearance: Card layout, Typography, Layout, Effects, Background, Tags. Behavior: General, Tasks, Projects, Insights, Holidays. Clicking a row opens that section with a *‹ Appearance* / *‹ Behavior* back button; Esc goes back first and closes the panel second. Switching tabs or reopening Options returns to the list. The panes keep a fixed minimum height so the panel doesn't jump. Settings introduced in the current minor release show a small *New* tag (computed from `APP_VERSION`, so the tags disappear on the next minor release). The Themes tab and the *Reset … to defaults* buttons are unchanged
- **Account menu** — the bottom of the sidebar is one button: avatar, email (or Offline Mode / Not signed in), sync status text (*Synced*, *Syncing…*, *Sync error*, *Not syncing*, *This browser only*), and a ⋯. It opens a menu with Options, Help & shortcuts, What's new (with the new-version dot, also mirrored on the button), Export and Import (the Work Desk / All Desks choices open inline), Repair duplicates, Sign in / Sign out, and the version. Click outside or press Esc to close. Choosing Options from Insights or Projects opens the panel in the top-right corner. With the sidebar at the top or bottom the button sits at the right end of the bar and the menu opens downward / upward. The phone menu sheet keeps its existing layout. The logo's `?` button and the Desk/Insights and Work/Personal/Projects tabs are unchanged
- **Calendar Today chip** — browsing the sidebar calendar to another month shows a *Today* chip beside the month title; clicking it jumps back to today
- **Calendar legend** — a one-line key under the sidebar calendar: *Has items · Left open · Holiday*
- **Quieter weekends** — Options → Behavior → General: *Off* (default), *Work desk only*, or *Both desks*. When active, Saturday and Sunday numbers on the sidebar calendar turn gray (selected days and holidays keep their colors). Synced like the other preferences; *Reset Behavior to defaults* turns it off

### Improved
- **Switches** — Options on/off settings are pill switches instead of checkboxes (same controls underneath)
- **Background pattern picker** — tiles are three across and swatch-only, with *Selected: [name]* under the grid. Arrow keys still move between patterns
- **Selected calendar day** — a solid fill in the theme's calendar color (including themes with custom calendar hues), with text that flips between dark and light for contrast
- **Left-open color** — calendar badges and Insights *carried over* share one `--carried` color: amber by default, rose (`#fb7185`) on the amber-accent themes Clay, Flint, Denim, Warm, Noir, and Mocha

---

## [1.16.2] — 2026-10-14

### Improved
- **Simpler tag color names** — the Tag colors options are now *Single color (accent)*, *Shades of accent* (was *Analogous (shades of accent)*), and *Multi-color* (was *Multi-color (from theme)*). All three modes derive from the theme's accent — Multi-color keeps the accent's lightness and saturation and rotates the hue — so "(from theme)" didn't distinguish anything, and "Analogous" was design jargon. The hint and Help text match, and Help now notes that each mode has 8 colors, so with more tags some share one (pin a color to change it). Stored values (`theme` / `analogous` / `palette`) are unchanged, so saved and synced settings carry over

---

## [1.16.1] — 2026-10-13

### Added
- **Patterned backgrounds** — Options → Appearance → *Background* adds a *Patterned background* toggle. Turning it on shows a 4×3 grid of patterns — Graph paper, Plus grid, Isometric, Diagonal, Pinstripe, Crosshatch, Hexagon, Herringbone, Basketweave, Chevron, Greek key, Dot grid — and a *Strength* slider (2–45%, default 10%). Patterns are tiny inline SVG tiles drawn in the theme's text color, so they recolor when you switch themes (light or dark). The pattern sits on the page behind the board; cards, columns, the header, and the sidebar stay solid. Arrow keys move between patterns. Turning it off keeps your last pattern and strength. Synced like the other preferences; *Reset Appearance to defaults* turns it off and restores Graph paper at 10%. (Shipped as a patch release by choice; it would normally be a minor bump)

### Improved
- **Drop anywhere below a column** — the 1.16.0 lanes stopped 24px under the tallest column, so on a short board there was little room to drop. Lanes now run from the top of the columns to the bottom of the page (or to the top of the Notes section when there are notes). The outer margins count too: the far left of the page drops into New and the far right into Completed. Beside a column the column's own outline is the cue; below it the *Drop in …* strip still follows the cursor. The 14px gaps between columns still don't accept drops

---

## [1.16.0] — 2026-10-13

### Added
- **Drop below a column** — on desktop (columns side by side, 1025px and wider), while dragging a task, the empty space under each column down to the bottom of the board accepts drops for that column: New, Active, or Completed (the Completed / Shelved column marks the task done; shelving still means dropping on the Shelved box). The column's box shows its usual dashed outline, and a faint dashed strip labeled *Drop in Active* (or New / Completed) runs from the box down to the cursor. The 14px gaps between columns and the Notes section below the board don't accept drops. Boxes keep their normal size when not dragging; touch devices are unchanged
- **Sidebar at the top or bottom** — Options → Appearance → Sidebar position adds *Top* and *Bottom*. Above 768px the sidebar becomes a horizontal bar: logo and help, Desk/Insights and Work/Personal/Projects tabs, search, a compact Today's Progress, Export / Import with Repair duplicates as a 🔧 icon, and the account area pushed right. It stays on one row from 1280px and wraps to two below that. In Projects the list runs sideways and scrolls. The calendar gives way to the week strip, the collapse button is hidden, and the Export menu opens downward from a top bar. With a bottom bar, search results open upward and toasts sit above it. Phones (768px and narrower) keep their existing layout. Synced like the other preferences; *Reset Appearance to defaults* returns it to Left

### Fixed
- **Tags narrowing card text** — tagged cards reserved a 96px gutter on the right of the text for the absolutely positioned tag chips, so adding a tag re-wrapped the text into a visibly narrower column (and three or more chips could still overlap it). The chips now sit in their own grid area on the top row beside the checkbox / note icon, and the text spans the same width with or without tags. Many or long tags wrap onto extra chip lines (a single overlong tag is shortened with an ellipsis); in Compact layout the chips get their own line above the one-line row. Applies to tasks and notes, desktop and phone

---

## [1.15.1] — 2026-10-13

### Improved
- **Current theme name** — Options → Themes shows "Current: Monokai · Dark" under the filter. When the current theme is in another group, a *Show* link jumps there
- **Tag color list** — shows the 8 most-used tags with *Show all (N)* / *Show fewer* instead of a 180px scrolling box inside the scrolling menu. The per-tag button is now labeled *Reset* (was "auto") and only appears when a color is pinned
- **Confirm before delete** — moved from General into the Tasks section of Options → Behavior
- **Custom holidays** — dates read like "Sat, Oct 31, 2026"; past holidays are hidden behind *Show past (N)* (adding a past date opens it); the label box sits on its own line above the date and Add button so the placeholder isn't cut off
- **Reset to defaults** — *Reset Appearance to defaults* and *Reset Behavior to defaults* at the bottom of those tabs, after a confirm prompt. Each setting goes back to its new-install value through its normal handler, so the change saves and syncs. Theme, pinned tag colors, and custom holidays are kept

### Fixed
- **Custom holiday labels** were inserted as HTML; they're now set as plain text

---

## [1.15.0] — 2026-10-06

### Added
- **Insights: click a day to open it** — Day-by-day table rows, breakdown chart bars (Week and Month), the streak strip, and the Year heatmap now open that day on the Desk. In Year view, a month bar opens that month in Insights. Bars and table days are keyboard-reachable (Enter / Space)
- **Insights: back to the current period** — after stepping away with the arrows, a *This week* / *This month* / *This year* button appears beside them and returns to the period containing today. It also shows on an empty period
- **Insights: Month-over-Month and Year-over-Year** — the comparison card now appears in every view. While a month or year is still in progress it's compared with the same number of days at the start of the previous one (e.g. Oct 1–6 vs Sep 1–6), noted under the title; finished periods compare in full. Week-over-Week is unchanged
- **Insights: Tasks by Tag** — done / open / shelved / carried counts per tag for tasks on days in the period, with a stacked bar per tag. A task with several tags counts under each; untagged tasks show as *No tag*; the top 8 show by default with *Show all (N)* / *Show fewer*
- **Insights: Lingering Tasks** — the five oldest open tasks right now, regardless of period: days open, created date, the day it was last carried from, and *Open* to jump to it (highlighted on the Desk). Tasks scheduled on a future day and tasks created today are left out
- **Insights: Shelved Review** — shelved tasks on days in the period, oldest first. *Bring back* unshelves a task and moves it to today's Active column, keeping the same ID and clearing its carry stamp (like a manual move, so it isn't counted as a carry-over); *Open* jumps to the day it's on. The footer shows the all-time shelved count and oldest date. Top 8 by default with *Show all*. Tasks are dated by the day they sit on, since shelve dates aren't recorded
- **Ctrl+Enter adds comments** — Ctrl+Enter (Cmd+Enter on Mac) in a comment or note-update box adds it, matching the task/note add box. It does nothing while the box is empty, and also works in a draft restored after a sync

## [1.14.0] — 2026-10-06

### Added
- **12 Unit themes** — four themes, one per pilot, each in light, medium, and dark, bringing the total to 96 (32 light + 32 medium + 32 dark). Each tier uses the same four names, like Synthwave and Cyberpunk do
  - **Unit Zero** — prototype blue and white with a pale-blue accent; red is saved for the today ring and delete
  - **Unit One** — purple with a neon green accent and an orange highlight
  - **Unit Two** — production red with an orange accent; in dark, delete turns orange so it doesn't blend into the red
  - **Unit Eight** — plugsuit pink with mint for completed tasks and notes
  - Every Unit theme draws a thin stripe across the top header in that unit's colors (like Retro's controller stripe). Turning on the gradient header replaces it, same as Retro
  - Bright accents (medium and dark Zero, One, and Eight; medium Two) use dark text on primary buttons

### Improved
- **Game Boy theme renamed to Dot Matrix** — same colors, new name and theme id (`dot-matrix`). A saved `gameboy` selection is moved over on load, and synced preferences from devices still on the old name are mapped too, so nobody gets bumped back to the default theme

## [1.13.4] — 2026-10-06

### Improved
- **Help: when recurring tasks appear** — the Recurring tasks section now explains that a due task is added to today on open/refresh, on sync (every 5 minutes and when switching back to the tab, if signed in), or when switching Work/Personal; that you don't need to be viewing today; that each is added once per day; that skipped days aren't backfilled and future days don't preview; and how offline mode behaves overnight
- **README: How it behaves** — new section covering recurring timing, carry forward (what counts as unfinished, auto carry across all past days, when it runs), sync timing, the delete Undo window, desktop scrolling, completed-task collapse, the tag box, Today's Progress, the What's new link, and local history pruning

## [1.13.3] — 2026-10-01

### Fixed
- **Desktop page scroll** — the desk now scrolls like a normal page: the date / progress / add-task card sits at the top of the page and scrolls away as you scroll down, and the columns no longer slide underneath it. Since 1.4.2 the card had been pinned with the board scrolling in its own box below it, which was a misread of the original request. `.main` is now the scroll container and the board area no longer scrolls separately; space for its scrollbar is always reserved (`scrollbar-gutter: stable`) so the board doesn't shift sideways when a day gets long enough to scroll, and the Options panel's max height was trimmed so opening it never makes the page scroll. The sidebar still scrolls on its own, and phones are unchanged

## [1.13.2] — 2026-10-01

### Improved
- **Version number moved to the sidebar footer** — the `v1.x.x` button now sits at the very bottom of the sidebar, under the account section, so the subtitle row is just "Work tasks & notes ?"
- **What's new link** — after an update, a highlighted *What's new* link with the pulsing dot appears under the subtitle. It opens the changelog and disappears when the changelog is closed (×, Got it, a click outside, or Esc), returning the header to its normal height. Phones are unchanged: What's new stays in the menu

### Fixed
- **Subtitle wrapping** — with wider fonts such as JetBrains Mono, the unread-update dot made the subtitle row too wide, so "Work tasks & notes" wrapped onto two lines and pushed the sidebar down until the changelog was opened

## [1.13.1] — 2026-10-01

### Fixed
- **Tag box closing instantly** — clicking *tag* on a card opened the box and closed it right away whenever another card had an unsent comment draft or a column's inline add box was open, because those boxes take focus back on every redraw and the tag box closed when it lost focus. The tag box now closes only when you add a tag, press Esc, or click outside it, and its text field gets focus after the other boxes so you can type right away

## [1.13.0] — 2026-10-01

### Added
- **Phone menu** — at 768px and narrower, the sidebar's account, Export / Import, and Repair duplicates rows move into a bottom sheet opened from a menu button at the top right, along with Options and What's new. Tabs, search, and Help stay in the header. Close it with ×, a tap outside, Esc, or a swipe down on the handle. The existing sections are moved into the sheet while it's open and put back when it closes, so no buttons are duplicated
- **Sync dot** beside the menu button — filled when synced, outlined while syncing, red on a sync error, hollow when not signed in; the menu button shows a small dot when you're not signed in

### Improved
- **Options on phones** opens as a bottom sheet over a dimmed backdrop and is reachable from Desk, Insights, and Projects (the header gear is hidden on phones)
- **Today's Progress card** is hidden on phones; the desk header's progress bar and Back to today button already cover it
- Desktop and tablet are unchanged — verified with pixel screenshot baselines captured before the change

### Fixed
- **Collapsed sidebar on phones** — a sidebar collapsed on a wider screen stayed at zero width on phones, where the collapse button is hidden, leaving no tabs; phones now always show it, and widening the window restores the collapsed state

## [1.12.1] — 2026-09-30

### Improved
- **Streak bar labels** — weekday names (Week), day numbers every 7 days (Month), or month names (Year) under the blocks, plus a note that each block is a day and darker means more tasks
- **Year carry-over chart** hides future months with no carry-overs
- **Search results** show a `✓ Done` or `Shelved` label and dimmed text for finished tasks
- **Touch targets** — on touch screens, checkboxes are 28px, card links and comment actions are ~33px tall, tabs/toggles/"+ Add task" are at least 36px, and small icon buttons (tag ×, ⋮, ?, version, week arrows, search scope, close ×) get an invisible 10px tap halo so the layout doesn't change
- **Calendar badges** (open tasks left on past days) use the carry-over amber instead of red
- **Phone week strip** fades at both edges and snaps to whole days
- **Recurring icon** is now a drawn icon that follows the theme's text color (the 🔁 emoji was always blue)
- **Top progress bar** — Done uses the solid accent; Active and New are 55% and 22% accent strength (themes with their own progress colors keep them)

### Fixed
- **Tag box layout** — board columns are capped at their share (`minmax(0, …fr)`) and the card action row wraps, so the tag box no longer widens a column on desktop or pushes cards off-screen on phones
- **Week-over-week colors** — changes are colored by good/bad instead of up/down; carry-over is lower-is-better, so an increase is red
- **Insights stat tiles** — 8 tiles laid out 8, 4, or 2 per row so no row is left partly empty; the duplicate Completion rate tile was removed (it's in Productivity Summary)
- **Week-over-week on phones** — the "(N last week)" text no longer wraps
- **Theme names** — names longer than 11 characters (e.g. Mediterranean) use a slightly smaller font and the label uses the full swatch width, so none are cut off
- **Help** now describes the board as New, Active, and Completed / Shelved columns

## [1.12.0] — 2026-09-30

### Added
- **Update prompt** — when the app returns to the foreground (at most every 15 minutes) it checks the deployed version; if it's newer, a *Work Desk x.y.z is available* toast with a **Reload** button appears. Installed phone apps can otherwise stay on an old version for days

### Improved
- **New app icon** — `icon-192.png` and `icon-512.png` (home screen, installed app, Apple touch icon) replaced with the lilac marble bust artwork

### Fixed
- **Several refreshes needed to see a deploy** — the service worker served the saved copy first and updated it in the background, and GitHub Pages' 10-minute browser cache could make that background update stale too. `sw.js` now loads pages network-first (revalidating past the HTTP cache) and uses the saved copy only offline; it's registered with `updateViaCache: 'none'` and uses a new cache name so the old saved copy is cleared. **Requires deploying the new `sw.js` alongside `index.html`**
- **Stale copy of the app changing data on sync** — a phone still running a months-old saved copy (e.g. 1.6.0, before Auto carry off was respected during sync) could auto-carry tasks and reset the theme. Synced data now records `appVersion`; a client that sees cloud data from a newer version stops syncing and reloads (once per session, so an intentional rollback can't loop)
- **Search missing matches** — words on separate lines were fused together (`vendor` + `about` → `vendorabout`) and non-breaking spaces from mobile keyboards didn't match a typed space; both now match
- **Deleted tasks coming back from another device** — a device that still had a local copy of a task deleted elsewhere kept it (and could auto-carry and re-push it), because sync let any local copy beat a deletion. Deletes now also write a `purgedIds` record that beats stale copies on every device, and Undo writes a `restoredIds` record that beats any earlier delete (so an undone delete also syncs correctly to devices without a copy). Tombstones from before 1.12.0 keep the old local-copy-wins rule, because older Undo never recorded a restore

## [1.11.1] — 2026-09-30

### Fixed
- **Carry-over by day of week** bars now stretch the full width of the card and line up edge to edge with the by-week (or by-month) bars. The dates moved inside each bar: just past the fill, or inside the fill in dark text when the bar is more than 60% full

## [1.11.0] — 2026-09-30

### Added
- **Quick-pick tags** — clicking `tag` on a task or note shows your two most-used tags as one-click chips (in their tag colors) beside the text box. Picks skip tags already on the card (the next most-used fills in), narrow to matching tags as you type, and are hidden when you have no tags yet. Typing a new tag and pressing Enter works as before

### Fixed
- Reopening the tag box right after adding a tag no longer closes it immediately (a leftover close timer from the previous box is now ignored)

## [1.10.1] — 2026-09-30

### Improved
- **Carry-over by day of week** is more compact: each weekday's dates now sit on the same line as its bar instead of on a line underneath (the full list is in the row's tooltip when it's too long to fit), and the bars are slimmer

### Fixed
- **Tag pill text centering** — tag labels are trimmed to cap height and baseline, so uppercase text is centered vertically regardless of the selected font (previously 1–1.5px high in Nunito, JetBrains Mono, and Merriweather). Chips without a × now have even left/right padding (text was ~3px right of center)

## [1.10.0] — 2026-09-30

### Added
- **Analogous tag colors** — new *Tag colors* mode that gives each tag a lighter, darker, or neighboring shade of the theme accent (e.g. rose, dark rose, light rose); lightness is clamped so chips stay readable, and colors follow the theme when you switch

### Improved
- Tag color modes renamed: **Single color (accent)** (was Theme color), **Analogous (shades of accent)** (new), **Multi-color (from theme)** (was Palette). Saved settings carry over unchanged

### Fixed
- Color boxes in the Options → Appearance tag list now show the color each tag is actually displaying (resolved from the live chip), and refresh when you change mode or theme

## [1.9.1] — 2026-09-30

### Fixed
- **Font resetting on refresh** — applying a theme cleared every inline CSS variable on the page, including the chosen font; the font selector still showed your choice while the page fell back to the default. Theme changes now leave the font alone, so it survives refreshes and theme switches
- Switching from a custom theme to a preset now clears the custom theme's inline light/dark color scheme

## [1.9.0] — 2026-09-30

### Added
- **Tag colors** — new Options → Appearance → Tags section with a *Tag colors* setting:
  - **Theme color** (default) — every tag uses the theme accent, same as before
  - **Palette** — each tag gets its own color by rotating the theme accent's hue (same lightness and saturation), so tags stay on-theme and change with it; the color is derived from the tag name, so it's stable across devices
- **Custom tag colors** — click any tag chip on a card to open a color popover (12 preset swatches, custom picker, Reset to auto); a custom color overrides either mode, and its text is blended toward the theme's text color so it stays readable on light, medium, and dark themes
- **Tag list** — Options → Appearance lists every tag in the current list with its use count, a color picker, and an *auto* reset
- Tag color mode and custom colors sync with your other preferences

## [1.8.1] — 2026-09-30

### Improved
- **Carry-Over Analysis trend** — Month view adds a Carry-Over by Week chart; Year view adds a Carry-Over by Month chart
- **Dates behind each weekday bar** — on Month and Year views, each weekday row lists the specific dates and counts (e.g. Wed: Sep 9 (2) · Sep 23 (1)), capped at 6 with "+N more"

### Fixed
- Carry-overs are counted on the day a task was **left unfinished** (its `carriedFrom` date) instead of the day it landed, so "Wed" now means tasks left open on Wednesdays

## [1.8.0] — 2026-09-29

### Added
- **12 new themes** — 4 per tier, bringing the total to 84 (28 light + 28 medium + 28 dark)
  - **Light:** Retro (SNES console gray, purple buttons, red/yellow/green/blue controller stripe across the desk header), Seafoam, Mediterranean, Citrus
  - **Medium:** Dot Matrix (classic four-shade handheld green; renamed in 1.14.0), Denim, Terracotta, Merlot
  - **Dark:** Monokai, One Dark, Phosphor (green-screen CRT glow), Rosé Pine
- Bright-accent themes (Dot Matrix, Phosphor, Denim, Terracotta, Merlot, Rosé Pine) use dark text on primary buttons for readability

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
