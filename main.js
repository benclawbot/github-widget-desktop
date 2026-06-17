const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

let win, tray;
let isQuitting = false;

function fetchGitHub(reqPath, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'GitHub-Widget-Desktop' };
    if (token) headers['Authorization'] = `token ${token}`;
    const options = {
      hostname: 'api.github.com',
      path: reqPath,
      method: 'GET',
      headers
    };
    const req = https.request(options, (res) => {
      if (res.statusCode === 403 && res.headers['x-ratelimit-remaining'] === '0') {
        const reset = res.headers['x-ratelimit-reset'];
        const waitSec = reset ? Math.max(1, parseInt(reset) - Math.floor(Date.now() / 1000)) : 60;
        res.resume();
        reject({ rateLimited: true, waitSec });
        return;
      }
      if (res.statusCode === 403) {
        res.resume();
        reject({ rateLimited: true, waitSec: 60 });
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = { error: 'Parse error', raw: data }; }
        if (res.statusCode >= 400) {
          reject({ httpError: true, status: res.statusCode, message: parsed.message || parsed.error || `HTTP ${res.statusCode}`, data: parsed });
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Fetch github.com/trending HTML — GitHub's search API can't replicate the
// "most stars gained today" feed, so we scrape the trending page directly.
function fetchTrendingPage() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'github.com',
      path: '/trending?since=daily',
      method: 'GET',
      headers: { 'User-Agent': 'GitHub-Widget-Desktop', 'Accept': 'text/html' }
    }, (res) => {
      if (res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Trending page fetch timed out')));
    req.end();
  });
}

// Regex-based parser for github.com/trending. Returns the same shape the
// widget's buildTrending() expects: { html_url, full_name, name, owner, ... }.
function parseTrendingHtml(html) {
  const items = [];
  const articleRe = /<article[^>]*class="Box-row"[\s\S]*?<\/article>/g;
  const articles = html.match(articleRe) || [];

  for (const article of articles) {
    // The repo link is the first <a> inside the article's <h2> with exactly two path segments.
    const hrefMatch = article.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"\/]+)\/([^"\/]+)"[^>]*>/);
    if (!hrefMatch) continue;
    const owner = hrefMatch[1];
    const name = hrefMatch[2];
    const fullName = `${owner}/${name}`;

    const descMatch = article.match(/<p\s+class="col-9[^"]*">\s*([\s\S]*?)\s*<\/p>/);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const langMatch = article.match(/<span\s+itemprop="programmingLanguage">\s*([^<]+?)\s*<\/span>/);
    const language = langMatch ? langMatch[1].trim() : null;

    // Star count lives after the closing </svg> of the stargazers <a>.
    const starsMatch = article.match(/<a\s+href="\/[^"]+\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)\s*<\/a>/);
    const stargazers_count = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ''), 10) : 0;

    // "stars today" span has data-view-component before class on GitHub's current markup.
    const todayMatch = article.match(/<span[^>]*class="[^"]*d-inline-block[^"]*"[^>]*>[\s\S]*?([\d,]+)\s+stars?\s+(?:today|this week)\s*<\/span>/);
    const stars_today = todayMatch ? parseInt(todayMatch[1].replace(/,/g, ''), 10) : 0;

    items.push({
      html_url: `https://github.com/${fullName}`,
      full_name: fullName,
      name,
      owner: { login: owner },
      description,
      language,
      stargazers_count,
      stars_today,
    });
  }
  return items;
}

async function fetchTrending(token) {
  try {
    const html = await fetchTrendingPage();
    const items = parseTrendingHtml(html).slice(0, 6);
    if (items.length === 0) throw new Error('No items parsed from trending page');
    return { items, source: 'scrape' };
  } catch (err) {
    console.warn('[trending] scrape failed, falling back to search:', err.message);
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const search = await fetchGitHub(
        `/search/repositories?q=pushed:>${sevenDaysAgo.toISOString().split('T')[0]}+stars:>100&sort=stars&order=desc&per_page=6`,
        token
      );
      const items = (search.items || []).map(r => ({
        html_url: r.html_url,
        full_name: r.full_name,
        name: r.name,
        owner: { login: r.owner?.login },
        description: r.description,
        language: r.language,
        stargazers_count: r.stargazers_count,
        stars_today: 0,
      }));
      return { items, source: 'search' };
    } catch (fallbackErr) {
      console.warn('[trending] search fallback also failed:', fallbackErr.message);
      return { items: [], source: 'none' };
    }
  }
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

  win.on('close', () => {
    if (!isQuitting) {
      isQuitting = true;
      if (tray) tray.destroy();
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
      canvas[i] = 88;
      canvas[i + 1] = 166;
      canvas[i + 2] = 255;
      canvas[i + 3] = 255;
    }
    trayIcon = nativeImage.createFromBuffer(canvas, size);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('GitHub Widget');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Widget', click: () => { if (win) { win.show(); win.focus(); } } },
    { label: 'Toggle Always on Top', type: 'checkbox', checked: false, click: (m) => { if (win) win.setAlwaysOnTop(m.checked); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
}

app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.on('minimize-window', () => { if (win) win.hide(); });
ipcMain.on('close-window', () => { if (win) win.hide(); });

// Standard fetch — used for live updates (delta)
ipcMain.handle('github-fetch-data', async (event, { username, token }) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const sinceStr = since.toISOString();

    // Recent events only (delta)
    let allEvents = [];
    for (let page = 1; page <= 5; page++) {
      const ev = await fetchGitHub(`/users/${username}/events?per_page=100&page=${page}&since=${sinceStr}`, token);
      if (Array.isArray(ev) && ev.length > 0) allEvents = allEvents.concat(ev);
      else break;
    }

    // Recent repos — /user/repos (with token) returns ALL repos incl. private;
    // /users/{user}/repos only returns public. 57 vs 44.
    let allRepos = [];
    for (let page = 1; page <= 5; page++) {
      const r = await fetchGitHub(`/user/repos?sort=pushed&per_page=100&page=${page}&type=all`, token);
      if (Array.isArray(r) && r.length > 0) allRepos = allRepos.concat(r);
      else break;
    }

    const user = await fetchGitHub(`/users/${username}`, token);
    const trending = await fetchTrending(token);

    return { events: allEvents, repos: allRepos, trending, user };
  } catch (err) {
    if (err.rateLimited) {
      return { error: `Rate limited. Retry in ${err.waitSec}s.`, rateLimit: true, waitSec: err.waitSec };
    }
    return { error: err.message };
  }
});

// Full sync — fetches commit history from every repo to build complete activity map
ipcMain.handle('github-full-sync', async (event, { username, token, cachedActivity }) => {
  const progressCallback = event.sender;

  try {
    // Fetch all repos first — /user/repos (with token) returns all incl. private;
    // /users/{user}/repos only returns public.
    let allRepos = [];
    for (let page = 1; page <= 10; page++) {
      const r = await fetchGitHub(`/user/repos?sort=pushed&per_page=100&page=${page}&type=all`, token);
      if (Array.isArray(r) && r.length > 0) allRepos = allRepos.concat(r);
      else break;
    }

    const activityByDate = cachedActivity ? { ...cachedActivity } : {};
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(now.getDate() - 90);
    const ninetyDaysStr = ninetyDaysAgo.toISOString();

    let reposProcessed = 0;
    const totalRepos = allRepos.length;

    for (const repo of allRepos) {
      reposProcessed++;
      progressCallback.send('sync-progress', { current: reposProcessed, total: totalRepos, repo: repo.name });

      // Use repo.owner.login (not username) so repos owned by other orgs work.
      // Example: benclawbot has a fork of DgenKing/trendboss — /repos/benclawbot/trendboss/commits 404s.
      const owner = repo.owner?.login || username;
      const fullName = `${owner}/${repo.name}`;

      // Fetch commits for this repo (last 90 days, paginated)
      let page = 1;
      let hasMore = true;
      let repoPageCount = 0;
      let skipRepo = false;

      while (hasMore) {
        try {
          const commits = await fetchGitHub(
            `/repos/${fullName}/commits?since=${ninetyDaysStr}&per_page=100&page=${page}`,
            token
          );

          if (!Array.isArray(commits)) {
            // Non-array response (404, 401, 403) — skip this repo, continue loop
            skipRepo = true;
            hasMore = false;
            break;
          }

          if (commits.length === 0) break;

          for (const commit of commits) {
            const date = commit.commit?.author?.date;
            if (date) {
              const dateStr = date.split('T')[0];
              activityByDate[dateStr] = (activityByDate[dateStr] || 0) + 1;
            }
          }

          page++;
          repoPageCount++;
          hasMore = commits.length === 100 && page <= 10;

          // Small delay to avoid hitting rate limits
          await sleep(100);
        } catch (err) {
          if (err.rateLimited) {
            // Wait and retry
            await sleep(err.waitSec * 1000);
          } else if (err.httpError && (err.status === 404 || err.status === 401 || err.status === 403)) {
            // Repo inaccessible (private without access, deleted, forbidden) — skip it
            skipRepo = true;
            hasMore = false;
          } else {
            hasMore = false;
          }
        }
      }

      if (skipRepo) {
        console.log(`[sync] skipping ${fullName} (inaccessible)`);
      }

      // Small inter-repo delay
      await sleep(50);
    }

    const totalCommits = Object.values(activityByDate).reduce((a, b) => a + b, 0);
    const trending = await fetchTrending(token);

    return {
      activity: activityByDate,
      repos: allRepos,
      trending,
      lastSync: now.toISOString(),
      totalCommits
    };
  } catch (err) {
    if (err.rateLimited) {
      return { error: `Rate limited. Retry in ${err.waitSec}s.`, rateLimit: true, waitSec: err.waitSec };
    }
    return { error: err.message };
  }
});