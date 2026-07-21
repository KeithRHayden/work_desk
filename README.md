# Work Desk

A personal task and notes management app with cloud sync, designed for daily productivity tracking.

![Work Desk Screenshot](https://img.shields.io/badge/PWA-Ready-blue) ![Self Hosted](https://img.shields.io/badge/Self--Hosted-GitHub%20Pages-green)

## Features

### Task Management
- **Kanban-style board** — tasks flow through New → Active → Completed columns
- **Drag and drop** — reorder tasks or move between columns
- **Shelving** — temporarily set aside tasks without deleting them
- **Carry forward** — automatically or manually bring unfinished tasks to today
- **Recurring tasks** — create templates that auto-inject on specific days/intervals

### Notes
- **Quick notes** — capture thoughts alongside tasks
- **Updates/comments** — append timestamped follow-up entries to notes (like a mini-journal)
- **Rich text** — bold, italic, underline formatting
- **Paragraph spacing** — multi-paragraph notes render with proper breathing room

### Organization
- **Date-based navigation** — calendar picker and week strip for quick date access
- **Work/Personal contexts** — separate lists with one-click switching
- **Search** — find tasks and notes across all dates and contexts

### Insights
- **Daily/Monthly/Yearly views** — track completion rates over time
- **Activity heatmap** — GitHub-style visualization of your productivity
- **Progress bar** — visual breakdown of task states per day

### Customization
- **32 themes** — 16 light and 16 dark themes (Synthwave, Nord, Dracula, Forest, etc.)
- **Dynamic favicons** — browser tab icon changes with your theme
- **Comfortable/Compact density** — toggle card layout density
- **Collapsible sidebar** — maximize board space when needed

### Cloud Sync (Optional)
- **Supabase integration** — sync across devices with email sign-in
- **Automatic sync** — changes push to cloud within seconds
- **Offline-first** — works without internet, syncs when reconnected
- **Local backup** — export/import JSON backups anytime

### Mobile & PWA
- **Responsive design** — adapts to phone, tablet, and desktop
- **Installable** — add to home screen for app-like experience
- **Offline support** — service worker caches the app for offline use
- **Touch-friendly** — swipe week strip, tap-to-complete

## Tech Stack

- **Single HTML file** — entire app in one `index.html` (~8,000 lines)
- **Vanilla JS** — no frameworks, no build step
- **CSS Variables** — theming via custom properties
- **localStorage** — primary data store
- **Supabase** — optional cloud backend (PostgreSQL + Auth)
- **Web Crypto API** — secure ID generation

## Getting Started

### Local Use (No Setup)
1. Download `index.html` (or `work-desk.html`)
2. Open in any modern browser
3. Start adding tasks

### GitHub Pages Deployment
1. Create a new GitHub repository
2. Upload these files:
   - `index.html`
   - `manifest.json`
   - `sw.js`
   - `icon-192.png`
   - `icon-512.png`
3. Go to Settings → Pages → Deploy from `main` branch
4. Access at `https://yourusername.github.io/repo-name/`

### Supabase Cloud Sync Setup
1. Create a free [Supabase](https://supabase.com) project
2. Run this SQL in the SQL Editor:
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
3. In Authentication → Providers, ensure Email is enabled
4. In Authentication → Settings, disable "Confirm email" for easier signup
5. Update the `SB_URL` and `SB_KEY` constants in the HTML with your project values

## File Structure

```
work-desk/
├── index.html          # Main app (deploy this)
├── work-desk.html      # Development copy
├── manifest.json       # PWA manifest
├── sw.js               # Service worker for offline
├── icon-192.png        # PWA icon (192x192)
├── icon-512.png        # PWA icon (512x512)
└── README.md           # This file
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Add task/note | `Ctrl/Cmd + Enter` |
| Bold | `Ctrl/Cmd + B` |
| Italic | `Ctrl/Cmd + I` |
| Underline | `Ctrl/Cmd + U` |
| Cancel/Close | `Escape` |

## Data Storage

- **Local**: `localStorage` keys `work-desk-data-work` and `work-desk-data-personal`
- **Cloud**: Supabase `user_data` table with JSONB column
- **Auto-pruning**: Days older than 1 year are removed from local cache (cloud retains full history)
- **Backup**: Export/Import JSON files for manual backup

## Browser Support

- Chrome/Edge 90+
- Firefox 90+
- Safari 14+
- Mobile browsers with PWA support

## Themes

### Light
Default, Slate, Arctic, Paper, Latte, Sand, Coral, Rose, Mint, Lavender, Solarized, Tokyo Day, Vaporwave, Synthwave, Cyberpunk, Outrun

### Dark
Default, Nord, Dracula, Solarized, Ocean, Forest, Dusk, Warm, Midnight, Noir, Mocha, Rose, Synthwave, Cyberpunk, Outrun, Vaporwave

## Future Improvements

- **Google Assistant integration** — voice commands for task management
- **Data encryption** — optional PIN/passphrase encryption for cloud data

## License

Personal use. Feel free to fork and customize for your own productivity needs.
