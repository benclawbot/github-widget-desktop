const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require('electron');
const path = require('path');

let win, tray;
let isQuitting = false;

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