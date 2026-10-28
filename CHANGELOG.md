# Changelog

All notable changes to **Work Desk** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with semantic versioning.

---

## [1.23.0] — 2026-10-27

### Added

- **Recurring Follow-through card in Insights.** Each recurring task gets a Done / Still open / Missed bar for the days it came up in the period, lowest rate first, with "17 of 19 done · 89%". A due day only counts if you used the desk that day, so days away aren't misses, and templates skipping holidays skip them here too. Under 50% after 3 or more chances gets a *Rarely done* flag. *Open Recurring tasks* opens the list. Rows with no chances in the period (say, a monthly task in a week it isn't due) are hidden.
- **Carry Chains card in Insights.** Tasks carried forward 3 or more times whose run overlaps the period, oldest first, with totals (how many, still open, average carries), "Carried 8 times · rolling since Oct 5 · still open", one dot per carry, and *Shelve* / *Open*. With none, the card says "Nothing slipped 3 or more times this week."
- **Tag Trend card in Insights.** Each tag's share of your tasks this period next to the previous one (last week, month, or year; to the same point while the period is still going), with ▲ / ▼ for moves of 5 points or more and a takeaway such as "Biggest shift: IDS dropped 13 points while ACE rose 15." Under 10 tasks on either side shows shares without arrows; a previous period with no tasks says so.
- **Carry counts on tasks.** Carrying forward now records how many times a task has been carried (`carryCount`) and when its run started (`carryStart`). Tasks carried before 1.23.0 count as one carry. Moving a task by hand, sending it to the other desk, or *Bring back* starts it fresh. Sync and merges keep the longer run.

### Improved

- On wide screens, Recurring Follow-through joins the left column, and Carry Chains and Tag Trend join the right. In one column they follow Shelved Review.
- **Phone tabs stack like desktop.** At 600px and narrower, Work / Personal / Projects sit under Desk / Insights instead of sharing one cramped row. Tablets keep the single row.
- **Tests run the real app code.** Unit tests now load sync, merge, carry-forward, move, recurring, and holiday functions straight from `work-desk.html` instead of the separate copy in `lib/desk-logic.mjs`, which was drifting from the app and has been removed. `e2e/layout.spec.ts` now uses the shared fixtures, like the other specs.

### Fixed

- **Task changes didn't reach other devices on a tie.** When two devices had the same task and neither copy was completed, shelved, or had more comments, the sync merge kept each device's own copy. A task moved to Active on the desktop stayed in New on the phone (and the phone uploaded New back), and the same went for text edits and reopening a completed task. Tasks and notes now carry `updatedAt`, stamped by `saveData` when an item's content actually changes (carry-forward fields are ignored, and a hand move stamps it). Sync and Import All (merge) prefer the later stamp and still union comments and tags. Unstamped copies keep the old rules, so existing tasks catch up the next time they're changed.
- **Column add box kept its text after Add.** Adding a task from a column's *+ Add task* box left the text in the box, so tapping Add again added the same task twice. The box now clears after each add and stays open for the next one; Add on an empty box closes it. The 1.20.0 draft-keeping (so a sync redraw doesn't wipe what you're typing) was restoring the just-added text.
- **Project note actions on phones.** *edit · add update · tag · to desk · archive · delete* now wrap onto a second row, and the date gets its own line when space is tight, instead of labels breaking in two and *delete* running off the card.

---

## [1.22.1] — 2026-10-27

### Improved
- **Daily breakdown stops at today** — in Insights → Month, days later in the current month no longer show as rows of zeros in the Bar, Line, and Stacked charts. A future day that already has something on it still shows
- **Empty weekends left out with Quieter weekends** — when Quieter weekends (Options → Behavior → General) covers the desk you're viewing (*Work only* on Work, or *Both desks*), the Month chart drops Saturdays and Sundays with nothing on them; weekends with any task, note, or comment stay. A note under the legend (e.g. *8 empty weekend days hidden · Quieter weekends is on for Work · Change*) appears only when days are actually hidden, and **Change** opens Options at the setting. Changing the setting updates Insights right away, and its hint in Options now reads *On the calendar and in Insights*. Week and Year views, the pie chart, and the Day-by-day table are unchanged
- **Two columns on wide screens** — when the Insights area is at least 1500px wide (a 1920px monitor with the sidebar open, or wider), the cards above the stat tiles split into two independent columns: Summary, Carry-Over Analysis, and Lingering Tasks on the left; Month-over-Month, Tasks by Tag, and Shelved Review on the right. Each card keeps its own height, so nothing is stretched to match its neighbor. Streak Tracking, the stat tiles, the breakdown chart, and the Day-by-day table stay full width, and the panel's cap rises from 1240px to 2000px. Narrower screens (laptops, every tablet, phones) keep the single column in the same order as before. It responds to the space Insights actually has, so collapsing the sidebar or resizing the window switches it live

## [1.22.0] — 2026-10-22

### Added
- **Keyboard shortcuts for a keyboard-only tablet** — **T** starts a new task and **N** a new note (selects the type in the add bar and puts the cursor in it), and **[** / **]** step to the previous / next day. They only fire when you aren't typing in a box, no modifier key is held, and nothing is open on top (Options, Help, search results, menus, dialogs), so they never get in the way of typing
- **Full screen** — a toggle in Options → Behavior → General hides the status bar and app tray; swipe down from the top or up from the bottom to see them. Browsers only allow full screen right after a tap or key press, so with it on, the first tap after the app opens switches to full screen (and so does the next tap if you leave it with Back). Saved on each device and not synced, so a tablet can be full screen while a phone isn't. Hidden where the browser doesn't support full screen

### Improved
- **Help opens fully expanded** — every section starts open each time Help opens, so it reads top to bottom. Tap a heading to fold it; the section links still jump to (and reopen) a section
- **Cleaner Recurring Tasks panel** — a quick-add bar on top: the task text, a **Repeats** dropdown (Daily, Weekdays, Weekly, Custom, Every 2 weeks, Monthly, Quarterly), and **Add** on one line, with no formatting toolbar. Day, date, and month choices only appear for schedules that need them. Below it, your recurring tasks line up in columns: the task and its tags, the schedule (`*` marks one that skips holidays), and **next due** (*Today*, *Tomorrow*, *Tue, Oct 27*), which accounts for holidays and for a task already added today. **Edit**, **Add tag**, and **Delete** moved into a **⋮** menu on each row, the same icon cards use; Add tag opens the tag picker right in the row, and a tag's × removes it. Esc closes an open menu first, then the panel. On a phone each row stacks the schedule and next due under the task
- **Done edge on a tablet in landscape** — touch screens showing the desktop layout (wider than 768px) get a 28px tap-to-complete edge, between the 18px mouse edge and the phone's 40px

### Fixed
- **Card ⋮ menu from the keyboard** — opening it moves focus to the first item; ↑ / ↓ (and Home / End) move between items; Esc closes it and puts focus back on ⋮; tabbing away closes it. The ⋮ button now tells screen readers whether the menu is open. Before, Esc did nothing once you were inside the menu, which Help already promised. The Recurring panel's ⋮ menu gets the same arrow keys, and desk shortcuts are ignored while a card menu is open
- **Account menu from the keyboard** — the menu at the bottom of the sidebar now opens on *Options* instead of leaving focus on its button; ↑ / ↓ / Home / End move through whatever is showing (skipping Sign in or Sign out, whichever is hidden, and stepping into an open Export or Import list); Esc closes an open Export / Import list first, then the menu; tabbing out closes it. It now behaves like the card, recurring, and project menus
- **Esc leaves the add box** — after adding with Ctrl+Enter, focus stays in the add box for the next one; Esc now steps out of it (keeping any text), so T / N / [ / ] work again without tabbing away first
- **Phone messages no longer cover the add bar** — toasts (like *Working offline*) sit just above the pinned add bar, and follow its height as it grows
- **Shortcuts in the phone layout** — T / N / [ / ] checked whether the add bar was showing in a way that always failed once the bar is pinned to the bottom, so they did nothing on a phone-width screen (including a tablet in portrait). They work there now
- **Tags in the recurring Edit form** — pressing Esc in **+ tag** cleared the box, but a delayed save on click-away still added what you'd typed a moment later. That save also re-drew the tag row, so a second **+ tag** opened right after pressing Enter could vanish mid-typing. Enter, Esc, and clicking away now each finish the box once. New E2E tests cover the Edit form's tag row (× removes, + tag on Enter or click-away, Esc cancels, no duplicates, removing every tag saves none), `#tag` in the text becoming a tag on Save, and the empty-description and missing-day guards, which brings the Edit form from 79% to full coverage
- **Account creation is tested** — the sync tests' stand-in Supabase now answers sign-ups, so **Create account** is covered for missing or short passwords (caught before anything is sent), email confirmation on (asks you to check your email, stays signed out) and off (signs in and backs up right away), and a server error like *User already registered*. No app changes
- **Cleanup** — removed three functions nothing called (`makeSection`, `closeThemePicker`, `startTask`) and corrected the comment on the tag color fallback

## [1.21.1] — 2026-10-22

### Improved
- **Shades of accent matches the screen again** — 1.21.0 made the shades distinct, but on themes with a well-known color set (and on gray themes, where the range kept widening) they turned into a full rainbow that didn't look like the theme. Now Shades of accent only uses colors that are always on screen: the accent, plus the tint shared by the theme's backgrounds and text (Monokai's olive, Mediterranean's navy, Nord's slate blue). Colors that only show sometimes, like the calendar's today ring or the Shelved label, are left out. It allows about 24° of hue room around each and separates tags by lightness; on themes with plain gray backgrounds it uses a 60° band around the accent. When the card itself carries the tint (Monokai, Dracula, Nord), tint-colored tags would sink into it, so it leans on the accent (45° of room) and uses at most two brighter, stronger tint colors. Most themes keep 8 clearly different colors; soft blue-violet themes get about 6 and near-gray ones fewer, where Multi-color is the better pick
- **Multi-color takes over the 1.21.0 Shades logic** — each theme's own color set (Monokai, Dracula, Nord, Solarized, Gruvbox, Catppuccin, One Dark, Rosé Pine, Tokyo, Kanagawa, Everforest, Mediterranean) or a blend from the accent toward the theme's second color, checked so no two look alike. Colors are now handed out by use, like Shades of accent, instead of from each tag's name, so two tags no longer share a color until you have more than eight, and your most-used tags get the most distinct colors. Both modes share the same assignments, so a tag keeps its position when you switch. Tag colors in both modes change once with this update; pinned custom colors are untouched
- **Help section links** — the links under the search box were pills of different widths that wrapped into ragged rows. They're now an even grid with short names (*Cards*, *Recurring*, *Sync & data*, *Shortcuts*): four across in reading order (basics, then planning, then setup), three across on a phone. Hover a link for the full section name

### Fixed
- **Theme grid scrolled sideways** — the four theme columns grew to fit the widest name, so longer names (Catppuccin Frappé, Catppuccin Latte, Gruvbox Light, Mediterranean) pushed the grid wider than the Options panel, worst with JetBrains Mono, Merriweather, or Large text. Columns now share the width evenly, names wrap at spaces, and a single word too wide for its column (such as *Mediterranean*) shrinks to fit
- **Installed app didn't rotate** — the app manifest set `"orientation": "portrait-primary"`, which locks an installed app upright on tablets and phones (browser tabs ignore it, so the browser version rotated). It's now `"any"`. An app installed earlier picks up the change when the device next refreshes its copy of the manifest (on Android, usually within a day of opening it), or right away after uninstalling and reinstalling

## [1.21.0] — 2026-10-21

### Added
- **Twelve new themes** — Dark: **Kanagawa** (sumi-ink night, carp-yellow accent), **Monokai Pro** (warm charcoal, soft yellow accent), **Everforest** (mossy slate, sage green), **Rosé Pine Moon** (dusky purple-navy, iris accent). Medium: **Catppuccin Frappé** (Frappé's slate-violet lifted to mid-tone, mauve accent), **Gruvbox Mid** (Gruvbox's warm gray-browns, orange accent), **Solarized Mid** (Solarized's teal-gray, brightened yellow accent), **Rosewood** (dusty rose-brown, gold accent). Light: **Gruvbox Light** (cream paper, faded orange), **Rosé Pine Dawn** (morning parchment, rose-red accent), **Everforest** (soft parchment, forest green), **Catppuccin Latte** (Catppuccin's light flavor, mauve accent). That makes 108 presets, 36 in each of Light, Medium, and Dark, so each group fills the four-column theme grid with no gaps; Solarized, Gruvbox, and Catppuccin now come in all three tiers
- **More recurring schedules** — alongside Daily, Weekdays, Weekly, and Custom:
  - **Every 2 weeks** — pick the first date; it repeats every other week on that weekday
  - **Monthly** — *Day of month* picks one or more dates (the 1st and 15th, or *Last* for the last day; a 29th–31st falls on the last day in shorter months). *Day of week* picks one or more weeks (1st–4th or Last) and a weekday, such as the 3rd Thursday, or the 1st and 3rd Tuesday for twice a month
  - **Quarterly** — the same choices, in one of three month sets (Jan · Apr · Jul · Oct, Feb · May · Aug · Nov, or Mar · Jun · Sep · Dec)
  - The template list shows the schedule in words, e.g. *Monthly on the 3rd Thu* or *Every other Tue*. Older versions of the app won't add these new schedules until they're updated

### Improved
- **Ctrl+Enter saves edits** — Ctrl+Enter (Cmd+Enter on Mac) now saves when you edit a task, note, or comment on the desk, and in the recurring task add and edit forms. Project edits already worked this way
- **Shades of accent tags are easier to tell apart** — the old shades were small lightness and hue nudges of the accent, so on themes like Mediterranean, Seafoam, Graphite, and Plum the tags looked nearly the same, and on Monokai they were all a pink-red that appears nowhere else in the theme. Now:
  - Themes with a well-known color set use their own 8 colors: Monokai, Monokai Pro, Dracula, Nord, Nord Light, Solarized (all three), Gruvbox (all three), Catppuccin (all three), One Dark, Rosé Pine, Rosé Pine Moon, Rosé Pine Dawn, Tokyo Storm, Tokyo Day, Kanagawa, Everforest (both), and Mediterranean
  - Every other theme (including custom themes) blends from the accent toward the theme's second color (taken from its sidebar, calendar, or shelved colors, or 120° around the color wheel when the theme has only one hue), at several lightnesses. Each next color is the one most different from those already picked, and if the six most-used colors would still look alike (common on medium gray themes) the range widens until they don't
  - Colors are darkened or lightened until the text reads on its pill, but never pushed past the contrast of the theme's own accent, so medium themes don't wash out to pastels
- **Most-used tags get the most distinct colors** — the first time you use Shades of accent, tags are given colors in order of use, and a tag keeps its color from then on; new tags take the least-used color. Assignments sync with your preferences (without overriding a settings change made on another device). Existing tags change color once with this update; pinned custom colors are untouched, and Single color and Multi-color work as before
- **Help is shorter and easier to get around** — cut from about 4,700 words to under 1,400, in 12 folding sections. Quick start and Keyboard shortcuts start open; the rest open with a click. A search box at the top shows only the matching lines (and opens their sections), a row of section links jumps to a topic, and Esc clears the search before closing Help. The roadmap moved to the README

### Fixed
- **Stylesheet** — a stray closing brace made the browser skip the style rule that followed it

## [1.20.0] — 2026-10-21

### Added
- **Storage warning** — the desk lives in this browser's storage (about 5 MB per site, shared with any other app on the same address). From 50% full, the account menu shows *Browser storage N% used*; from 80%, a banner at the top suggests **Export All** for a backup, plus **Sign in** when you're not signed in. × hides it for the rest of the browser session unless usage climbs another 5%. If storage fills up, the banner says new changes can't be saved on this device

### Improved
- **Lighter cloud sync** — the 5-minute and tab-focus checks now read only the cloud row's last-updated time. When it matches what this device last saw, there's no download: the device just runs the daily jobs (auto carry, recurring tasks) and uploads only if its own data changed. A full download-and-merge runs when another device or the add-task shortcut has saved, when the app opens, after signing in to a different account, and at least every 4 hours. Uploads are skipped when the data matches what's already in the cloud (compared with key order ignored, since the database reorders keys). Most of the savings show once every device is on 1.20.0
- **Several tabs** — a change saved in one tab reloads into your other open tabs right away, so a background tab no longer saves its older copy over it
- Sync and upload never run at the same time; an upload first checks whether another device saved and merges that in before sending

### Fixed
- **Sync no longer interrupts typing** — every sync redrew the whole board (with Auto carry on, even when nothing moved), which could reset a comment mid-sentence, move the cursor to the start, or drop text typed into a task edit or a column add box. Now a sync or another tab's change redraws only when the desk actually changed, and while you're typing on the desk that redraw waits until you click or tab away (after the click lands, so the button you clicked still works). Redraws also keep the cursor where it was, keep every open comment box rather than just the first, keep the text of task edits and column add boxes, and hold on to a comment draft whose card isn't on screen until it is
- **History is no longer trimmed** — startup used to delete days older than 12 months from the desk (a leftover from before cloud sync). Every day now stays, so Search, Insights, and the calendar reach all of it. Days a signed-in device trimmed earlier come back on its next full sync wherever the cloud still has them
- **Full browser storage** — a save that hit the storage limit used to throw mid-edit and could lose the change. Edits now stay on screen, are included in the next cloud upload and in Export All, and are written to storage as soon as space frees up
- **Failed downloads** — if the cloud download failed, the sync could carry on and upload this device's copy over newer cloud data; it now stops and tries again on the next check

## [1.19.1] — 2026-10-21

### Improved
- **Formatting in projects** — editing a project note, task, or comment now uses the desk's editor: the B / I / U / • toolbar, Ctrl+B / Ctrl+I / Ctrl+U, bullet lists, and the same paste cleanup. Ctrl+Enter saves and Esc cancels. Project notes and tasks used a bare text box and comments a plain textarea
- **Project comments keep their formatting** — comments now store HTML alongside a plain-text copy, so formatting survives sending a card between the desk and a project (it used to be flattened to plain text) and shows up in *Copy as Markdown*. Older versions still read the plain copy; if one of them edits a comment, its plain text wins over the stale formatting

## [1.19.0] — 2026-10-20

### Added
- **Search covers Projects** — the scope chip next to the search box reads *All* (was *Both*) and searches Work, Personal, and Projects together, including project comments and `#tag` searches. Project results show the project's name; clicking one opens the project on the right tab (expanding Archived if needed) and outlines the note or task
- **Send between the desk and projects** — *Send to project…* in a desk card's ⋮ menu moves the task or note into a project you pick from a list (or *+ New project…*); *to desk* on a project card moves it to the Work or Personal desk (new desk tasks land in New). Comments and tags come along. The moved item gets a new ID and the old one is tombstoned so sync can't restore the original; *Undo* in the toast puts it back
- **Tags on project notes and tasks** — *tag* on a project card opens the same tag box as the desk (with your most-used tags as one-click picks), and typing `#word` when writing a project note or task turns it into a tag. Chips sit at the top of the card, use your tag colors, and remove with ×. Project tags count toward the most-used tags in Options → Appearance → Tags, and are kept by backup import
- **Pin and reorder projects** — a pin on each project in the list (shown on hover, always on touch screens and on pinned projects) or *Pin* / *Unpin* in the project header keeps a project at the top, above a thin divider; pinning moves it to the very top. Drag projects to reorder them within their group (pinned or not), in the sidebar or the top/bottom bar; with the keyboard, focus a project and press Alt+↑ / Alt+↓. Pins and order sync, with the most recent reorder winning, and are kept by backup import
- **Reorder notes and tasks inside a project** — drag a note or task card to move it among the active ones (archived items stay in their accordion), or focus a card and press Alt+↑ / Alt+↓. A card that's being edited can't be dragged, so its text can still be selected. The order syncs, with the most recent reorder of each project winning
- **Archive finished projects** — the new *More* menu in the project header has *Archive project*, which unpins the project and moves it into a collapsed *Archived projects (n)* group at the bottom of the list (or the end of the top/bottom bar). Archived projects are left out of *Send to project…* but stay in search; the header shows *Archived*, and *Unarchive project* (or pinning it) brings it back. Synced and kept by backup import
- **Project progress** — the project header shows *3 of 8 tasks done* with a thin accent bar, and each project in the list gets the same bar (hidden in the top/bottom bar). Counts every task, archived ones included
- **Copy as Markdown** — *More → Copy as Markdown* copies the project's name, progress, open tasks as `- [ ]` checkboxes, and active notes, with comments (dated) and `#tags`. Bold, italics, links, and lists in the text carry over
- **Pick a day for *to desk*** — the send dialog for a project note or task has a *Day* picker (today by default, with a *Today* button to reset), and each desk option shows the chosen day. The toast names the day too
- **Move up / Move down** — also in the *More* menu, for reordering projects on touch screens where drag-and-drop isn't available. Each is disabled at the edge of the project's group (pinned, others, or archived)

### Fixed
- **Project renames lost in sync** — sync always kept this device's copy of a project's name, so another device could put an old name back. Projects now record when they were renamed (or pinned), and the newer change wins

## [1.18.4] — 2026-10-20

### Improved
- **Project list counts open work** — each project shows *2 open tasks · 3 notes*, leaving out archived notes and finished tasks; a project with only archived items shows *N archived*
- **Complete edge on project tasks** — project tasks use the same left-edge complete button as desk tasks, in whichever style is picked in Options → Appearance → Card layout → *Complete button* (wider on touch screens). Finishing one still moves it to the project's Archived list, where the edge shows as done. *Checkbox* brings back the project checkbox too
- **Project header buttons** — the ✏️ and 🗑️ emoji are now plain *Rename* and *Delete* text buttons, the same height as the gear beside them (Delete turns red on hover)
- **Possible future improvements (Help)** — trimmed to data encryption, local weather, and suggested colors for custom themes. Dropped Google Assistant integration

### Fixed
- **Archived project items lost on import** — importing a Projects backup, or the projects part of an Import All backup, dropped each note's and task's archived flag, so archived items came back as active ones. They now stay in Archived
- **Deleted projects coming back** — deleting a whole project left no tombstone, so syncing with another device (or the cloud copy) could restore it. Deletes are now recorded, and sync merges plus Projects backup imports (Replace and Merge, including Import All) skip deleted projects, notes, and tasks
- **Reopened project tasks stuck in Archived** — un-completing a finished task now un-archives it too, so it returns to the task list
- **Project comment actions on touch screens** — *edit* / *delete* on project comments were hidden until a mouse hovered them; they're now always shown on touch screens and appear on keyboard focus

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
