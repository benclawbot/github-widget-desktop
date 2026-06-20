# GitHub Widget Desktop

A lightweight GitHub dashboard widget for Windows — always accessible on your desktop, hides to the system tray when minimized or closed.

## Screenshots

![GitHub Widget](./screenshots/widget.png)

## Features

- **Cumulative activity chart** — a smooth commit-growth timeline with every day's commit value available on hover or keyboard focus
- **Active repos** — recently pushed repositories with language, stars, and issues
- **Quick stats** — total repos, stars, open issues, and contributions
- **Trending repos** — today's trending GitHub projects
- **Reliable incremental sync** — the sync button refreshes repository metadata, trending projects, and commits added since the last successful sync. The first sync rebuilds the 90-day activity timeline.
- **System tray integration** — double-click tray icon to restore, right-click for menu
- **Custom title bar** — minimize and close buttons (hide to tray, don't quit)
- **Toggle always-on-top** — right-click tray → Toggle Always on Top

## Setup

```bash
cd github-widget-desktop
npm install
npm run build
```

## Usage

```bash
npm run dev     # development mode
npm run build   # build .exe installer
```

- Run `dist\GitHub Widget Setup 1.0.6.exe` to install, or
- Run `dist\win-unpacked\GitHub Widget.exe` directly for portable use

## Controls

| Action | Result |
|--------|--------|
| Sync button | Refresh all widget data and fetch repository commits since the last successful sync |
| ⚙ button | Settings — GitHub username and personal access token |
| Minimize / Close button | Hides to system tray |
| Double-click tray icon | Restore widget |
| Right-click tray icon | Show menu (Show, Toggle Always on Top, Quit) |

## Notes

- A GitHub token with `repo` scope is required to access private repositories and to avoid rate limits. Get one at GitHub → Settings → Developer Settings → Personal Access Tokens.
- The first sync may take a few minutes because it rebuilds 90 days of commit history. Subsequent syncs query only repositories pushed since the previous successful sync.
- The activity line is cumulative across the retrieved date range. Hover a point, or focus the chart and use the arrow keys, to see that day's commits and running total.
- Activity data is cached in `localStorage` so it persists between launches.

## Testing

```bash
npm test               # contract tests (no network, runs on every commit)
npm run test:integration  # live tests against GitHub API (28 tests)
npm run test:all       # both
```

A pre-commit hook runs the contract tests on every commit. If a regression is detected, the commit is blocked. Bypass with `git commit --no-verify` only if absolutely necessary.

The contract tests are the regression guards for bugs that shipped in earlier versions:
- Wrong API path (`/repos/` prefix required)
- Listener leak in preload (singleton pattern required)
- Missing HTTP status code check (4xx errors must reject, not resolve)

## Recent Changes

- [1.0.7] Replace the activity dot map with a smooth cumulative commit chart, daily hover values, keyboard inspection, and exact retrieved-date boundaries (2026-06-20)
- [1.0.6] Fix manual sync to use bounded repository commit deltas, refresh every widget section, preserve cached values on errors, and rebuild legacy event-based caches once (2026-06-20)
- [1.0.3] Fix activity map month labels (CSS Grid so labels line up with their week column) and trending repos (now scrapes github.com/trending daily feed with search-API fallback) (2026-06-17)
- [1.0.2] Add contract + integration tests, pre-commit hook guards regressions (2026-06-17)
- [1.0.1] Fix full sync API path (`/users/{u}/repos/{r}/commits` → `/repos/{u}/{r}/commits`) and fix listener leak in preload (2026-06-17)
- [1.0.0] Initial release — Electron desktop widget with activity map, active repos, quick stats, trending repos, and system tray integration (2026-06-16)
