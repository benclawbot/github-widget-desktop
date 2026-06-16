# GitHub Widget Desktop

A lightweight GitHub dashboard widget for Windows — always accessible on your desktop, hides to the system tray when minimized or closed.

## Screenshots

![GitHub Widget](./screenshots/widget.png)

## Features

- **Activity heatmap** — commit history visualization (Feb–Jun 2026)
- **Active repos** — recently pushed repositories with language, stars, and issues
- **Quick stats** — total repos, stars, open issues, and contributions
- **Trending repos** — today's trending GitHub projects
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

- Run `dist\GitHub Widget Setup 1.0.0.exe` to install, or
- Run `dist\win-unpacked\GitHub Widget.exe` directly for portable use

## Controls

| Action | Result |
|--------|--------|
| Minimize button | Hides to system tray |
| Close button | Hides to system tray |
| Double-click tray icon | Restore widget |
| Right-click tray icon | Show menu (Show, Toggle Always on Top, Quit) |
| Quit menu item | Fully exits the app |

## Recent Changes

- [1.0.0] Initial release — Electron desktop widget with activity map, active repos, quick stats, trending repos, and system tray integration (2026-06-16)