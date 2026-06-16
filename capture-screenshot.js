const { app, BrowserWindow, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

async function capture() {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 900, height: 1400 }
  });

  const widget = sources.find(s => s.name.includes('GitHub Dashboard'));
  if (widget) {
    const screenshotsDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.writeFileSync(path.join(screenshotsDir, 'widget.png'), widget.thumbnail.toPNG());
    console.log('Captured to screenshots/widget.png');
  } else {
    console.log('Available sources:', sources.map(s => s.name));
  }
  app.quit();
}

app.whenReady().then(capture);