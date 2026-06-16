const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

let win, tray;
let isQuitting = false;

function fetchGitHub(path, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'GitHub-Widget-Desktop' };
    if (token) headers['Authorization'] = `token ${token}`;
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Parse error', raw: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 450,
    height: 700,
    x: sw - 470,
    y: 20,
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    resizable: false,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('widget.html');

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('minimize', (e) => {
    e.preventDefault();
    win.hide();
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  let trayIcon;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('empty');
  } catch {
    trayIcon = nativeImage.createEmpty();
    const size = { width: 16, height: 16 };
    const canvas = Buffer.alloc(size.width * size.height * 4);
    for (let i = 0; i < canvas.length; i += 4) {
      canvas[i] = 88;     // R - GitHub blue
      canvas[i + 1] = 166; // G
      canvas[i + 2] = 255; // B
      canvas[i + 3] = 255; // A
    }
    trayIcon = nativeImage.createFromBuffer(canvas, size);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('GitHub Widget');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Widget',
      click: () => {
        if (win) {
          win.show();
          win.focus();
        }
      }
    },
    {
      label: 'Toggle Always on Top',
      type: 'checkbox',
      checked: true,
      click: (menuItem) => {
        if (win) win.setAlwaysOnTop(menuItem.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on('minimize-window', () => {
  if (win) win.hide();
});

ipcMain.on('close-window', () => {
  if (win) win.hide();
});

ipcMain.handle('github-fetch-data', async (event, { username, token }) => {
  try {
    // Fetch user events (for contribution activity)
    const events = await fetchGitHub(`/users/${username}/events?per_page=100&page=1`, token);

    // Fetch repos (for active repos and stats)
    const repos = await fetchGitHub(`/users/${username}/repos?sort=pushed&per_page=30`, token);

    // Fetch trending (top starred repos created in last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split('T')[0];
    const trending = await fetchGitHub(`/search/repositories?q=created:>${dateStr}+stars:>10&sort=stars&order=desc&per_page=6`, token);

    return { events, repos, trending };
  } catch (err) {
    return { error: err.message };
  }
});