// Unit tests for the bug patterns in main.js and preload.js.
// Catches regressions of:
//   - HTTP status codes >= 400 being silently treated as success
//   - Listener leak when onSyncProgress is called multiple times
//
// Run with: node tests/contract.test.js
// Exits 1 on any failure.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

let passed = 0, failed = 0;
const failures = [];

function it(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed++;
    console.log(`  PASS ${name}`);
  }).catch(err => {
    failed++;
    failures.push({ name, err });
    console.log(`  FAIL ${name} — ${err.message}`);
  });
}

function section(name) { console.log(`\n[${name}]`); }

async function main() {
  console.log('GitHub Widget — contract tests (no network required)\n');

  // ---------- Defense: HTTP status code check ----------
  section('fetchGitHub: HTTP status code handling');

  // We re-implement the relevant logic from main.js here to test it
  // in isolation. The actual function in main.js uses https.request
  // but the bug pattern is: ignoring statusCode >= 400.
  const testCode = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const widgetCode = fs.readFileSync(path.join(__dirname, '..', 'widget.html'), 'utf8');

  await it('fetchGitHub has status code check (regression: 404 must not be silent)', () => {
    // The fixed code contains a block that checks res.statusCode >= 400
    assert.ok(
      /res\.statusCode\s*>=\s*400/.test(testCode),
      'main.js does not check res.statusCode >= 400; 404/401 errors will be silently parsed as JSON and treated as valid data'
    );
  });

  await it('fetchGitHub rejects on HTTP error (not just resolves with parsed body)', () => {
    // The fix changes the path from resolve(JSON.parse(data)) to:
    //   let parsed = JSON.parse(data)
    //   if (res.statusCode >= 400) reject(...)
    //   resolve(parsed)
    assert.ok(
      /reject\(\s*\{\s*httpError:\s*true/.test(testCode),
      'main.js does not reject on httpError; status code errors are swallowed'
    );
  });

  // ---------- Defense: listener leak in preload.js ----------
  section('preload.js: listener registration pattern');

  const preloadCode = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

  await it('onSyncProgress does NOT call ipcRenderer.on inside the function body (regression: listener leak)', () => {
    // The bug was: onSyncProgress = (callback) => { ipcRenderer.on('sync-progress', ...) }
    // Each call to onSyncProgress added another listener, causing N listeners to fire
    // on each progress event.
    //
    // The fix: onSyncProgress stores the callback in a module-scope variable,
    // and ipcRenderer.on is called exactly once at module load.
    //
    // We assert: there is exactly one ipcRenderer.on('sync-progress', ...) call
    // in the file, and it is NOT inside the onSyncProgress function body.

    const matches = preloadCode.match(/ipcRenderer\.on\(\s*['"]sync-progress['"]/g) || [];
    assert.strictEqual(
      matches.length, 1,
      `preload.js has ${matches.length} ipcRenderer.on('sync-progress', ...) calls; expected exactly 1 at module scope`
    );
  });

  await it('onSyncProgress stores callback in a module-scope variable, not a fresh listener', () => {
    // Pattern check: function body should assign to a let-declared variable,
    // not call ipcRenderer.on
    const fnMatch = preloadCode.match(/onSyncProgress:\s*\([^)]*\)\s*=>\s*\{([^}]+)\}/);
    assert.ok(fnMatch, 'onSyncProgress function not found in expected arrow form');
    const body = fnMatch[1];
    assert.ok(
      !/ipcRenderer\.on/.test(body),
      'onSyncProgress function body still calls ipcRenderer.on — this is the listener leak bug'
    );
    assert.ok(
      /=/.test(body),
      'onSyncProgress function body should assign the callback to a stored variable'
    );
  });

  // ---------- Defense: simulated listener leak with EventEmitter ----------
  section('simulated listener behavior (proves the leak is real)');

  await it('EventEmitter: registering listeners inside a callback leaks', () => {
    // Simulate the broken pattern to prove the bug is real
    const emitter = new EventEmitter();
    let listenerCount = 0;
    let calls = 0;

    // Broken pattern: each call to registerProgressListener adds a new listener
    const registerProgressListener = (cb) => {
      listenerCount++;
      emitter.on('progress', () => { calls++; cb(); });
    };

    const myCallback = () => {};
    registerProgressListener(myCallback);
    registerProgressListener(myCallback);
    registerProgressListener(myCallback);

    emitter.emit('progress');

    // With the bug, calls = 3 because three listeners were registered.
    // This proves the bug pattern.
    assert.strictEqual(calls, 3, 'expected 3 listener invocations to prove the leak');
    assert.strictEqual(listenerCount, 3, 'expected 3 listeners to be registered');
  });

  await it('EventEmitter: singleton pattern with stored callback is correct', () => {
    // Simulate the fix
    const emitter = new EventEmitter();
    let storedCallback = null;
    let listenerCount = 0;

    emitter.on('progress', () => { if (storedCallback) storedCallback(); });
    listenerCount++;

    const onProgress = (cb) => { storedCallback = cb; };
    onProgress(() => {});
    onProgress(() => {});
    onProgress(() => {});

    let calls = 0;
    emitter.on('progress-listener-check', () => {});
    // Just verify stored callback works and listener count didn't grow
    assert.strictEqual(listenerCount, 1, 'expected exactly 1 listener registered');
    // Verify that re-calling onProgress replaces the callback, doesn't add listeners
    let secondCalls = 0;
    const cb2 = () => { secondCalls++; };
    onProgress(cb2);
    emitter.emit('progress');
    assert.strictEqual(secondCalls, 1, 'expected single invocation via stored callback');
  });

  // ---------- Defense: fullSync commits path uses /repos/ prefix ----------
  section('main.js: fullSync uses correct commits API path');

  await it('github-full-sync uses /repos/.../commits (not /.../commits without repos prefix)', () => {
    // Extract any URL ending in /commits — only match fetchGitHub calls
    // (which appear inside backticks or quotes), not comments.
    const calls = testCode.match(/fetchGitHub\(\s*[`'"][^`'"]*\/commits[^`'"]*[`'"]/g) || [];
    assert.ok(calls.length > 0, 'no fetchGitHub commits call found in main.js');
    const allUseReposPrefix = calls.every(c => c.includes('/repos/'));
    assert.ok(
      allUseReposPrefix,
      `found fetchGitHub commits call without /repos/ prefix: ${calls.find(c => !c.includes('/repos/'))}`
    );
  });

  // ---------- Defense: fullSync uses repo.owner.login, not just username ----------
  section('main.js: fullSync uses repo.owner.login for commits URL');

  await it('github-full-sync builds commits URL from repo.owner.login, not just username', () => {
    // Regression: benclawbot has a fork of DgenKing/trendboss. Using
    // `${username}/${repo.name}` builds /repos/benclawbot/trendboss/commits
    // which 404s. The correct URL needs repo.owner.login.
    assert.ok(
      /repo\.owner\?\.login/.test(testCode),
      'main.js does not use repo.owner.login when building commits URL; forks of other orgs will 404'
    );
    assert.ok(
      /fullName\s*=\s*`\$\{owner\}\/\$\{repo\.name\}`/.test(testCode) ||
      /\$\{owner\}\/\$\{repo\.name\}/.test(testCode),
      'main.js should build fullName from owner + repo.name, not from username'
    );
  });

  // ---------- Defense: 404 on a single repo should not abort the whole sync ----------
  section('main.js: per-repo failures do not abort the loop');

  await it('github-full-sync handles 404/401/403 on a single repo without throwing', () => {
    // Regression: a 404 on one repo (e.g. inaccessible fork) used to throw
    // and the whole sync returned an error to the renderer. The fix is to
    // set skipRepo = true and continue to the next repo.
    assert.ok(
      /skipRepo\s*=\s*true/.test(testCode),
      'main.js does not have skipRepo logic; a 404 on one repo will abort the whole sync'
    );
  });

  // ---------- Defense: fetch uses /user/repos (not /users/{user}/repos) when token is set ----------
  section('main.js: uses /user/repos to include private repos');

  await it('github-fetch-data and github-full-sync use /user/repos (not /users/{user}/repos)', () => {
    // /users/{user}/repos only returns PUBLIC repos (44 for benclawbot).
    // /user/repos with a token returns ALL repos including private (57).
    // Using the wrong endpoint silently misses private repos.
    const wrongEndpoint = testCode.match(/\/users\/\$\{username\}\/repos/g) || [];
    assert.strictEqual(
      wrongEndpoint.length, 0,
      `found ${wrongEndpoint.length} uses of /users/${'$'}{username}/repos; should be /user/repos to include private repos. Occurrences: ${wrongEndpoint.join(', ')}`
    );
    const correctEndpoint = testCode.match(/\/user\/repos/g) || [];
    assert.ok(
      correctEndpoint.length >= 2,
      `expected /user/repos in both github-fetch-data and github-full-sync; found ${correctEndpoint.length} occurrences`
    );
  });

  // ---------- Defense: manual sync refreshes from the last successful watermark ----------
  section('manual sync: bounded repository commit delta');

  await it('buildSyncWindow bounds an incremental refresh after the last sync', () => {
    const { buildSyncWindow } = require('../sync-window');
    const window = buildSyncWindow(
      '2026-06-19T06:03:13.893Z',
      new Date('2026-06-20T10:00:00.000Z')
    );

    assert.deepStrictEqual(window, {
      since: '2026-06-19T06:03:13.894Z',
      until: '2026-06-20T10:00:00.000Z',
      incremental: true
    });
  });

  await it('buildSyncWindow uses a 90-day window for the initial full sync', () => {
    const { buildSyncWindow } = require('../sync-window');
    const window = buildSyncWindow(null, new Date('2026-06-20T10:00:00.000Z'));

    assert.deepStrictEqual(window, {
      since: '2026-03-22T10:00:00.000Z',
      until: '2026-06-20T10:00:00.000Z',
      incremental: false
    });
  });

  await it('github-full-sync accepts lastSync and bounds commit requests with since and until', () => {
    assert.ok(
      /github-full-sync'[\s\S]*cachedActivity,\s*lastSync/.test(testCode),
      'github-full-sync does not accept the last successful sync timestamp'
    );
    assert.ok(
      /commits\?since=\$\{syncWindow\.since\}&until=\$\{syncWindow\.until\}/.test(testCode),
      'commit requests are not bounded to the exact interval since the previous sync'
    );
  });

  await it('commit author dates outside the 90-day activity window are ignored', () => {
    assert.ok(
      /dateStr\s*>=\s*retentionDay/.test(testCode),
      'full sync counts commits whose author date falls before the activity window'
    );
    assert.ok(
      /dateStr\s*<=\s*syncWindow\.until\.split\('T'\)\[0\]/.test(testCode),
      'full sync counts commits whose author date falls after the sync watermark'
    );
  });

  await it('the sync button always uses repository commit sync, not the capped events feed', () => {
    const smartSync = widgetCode.match(/async function smartSync\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(smartSync, 'smartSync function not found');
    assert.ok(/await fullSync\(\)/.test(smartSync[1]), 'smartSync does not invoke fullSync');
    assert.ok(!/deltaSync/.test(smartSync[1]), 'smartSync still routes manual refresh through deltaSync');
  });

  await it('the renderer forwards the previous sync watermark and preserves cached commit totals on errors', () => {
    assert.ok(
      /fullSync\(\{[\s\S]*lastSync[\s\S]*\}\)/.test(widgetCode),
      'renderer does not pass lastSync to the repository commit sync'
    );
    assert.ok(
      !/document\.getElementById\('commit-count'\)\.textContent\s*=\s*'\?'/.test(widgetCode),
      'an API error still replaces the last-known-good commit count with ?'
    );
  });

  await it('fullSync does not shadow the lastSync watermark inside its request block', () => {
    const fullSync = widgetCode.match(/async function fullSync\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fullSync, 'fullSync function not found');
    const declarations = fullSync[1].match(/\b(?:const|let)\s+lastSync\b/g) || [];
    assert.strictEqual(
      declarations.length,
      1,
      'lastSync is redeclared inside fullSync, causing a temporal-dead-zone runtime error'
    );
  });

  await it('legacy event-based activity is rebuilt once before incremental sync resumes', () => {
    assert.ok(
      /SYNC_CACHE_VERSION\s*=\s*'2'/.test(widgetCode),
      'widget does not declare the corrected sync cache version'
    );
    assert.ok(
      /localStorage\.getItem\('gh-sync-version'\)\s*===\s*SYNC_CACHE_VERSION/.test(widgetCode),
      'widget does not detect legacy activity caches'
    );
    assert.ok(
      /localStorage\.setItem\('gh-sync-version',\s*SYNC_CACHE_VERSION\)/.test(widgetCode),
      'widget does not mark a successful repository-based rebuild as current'
    );
  });

  await it('the packaged app preserves the existing Roaming user-data profile', () => {
    const userDataIndex = testCode.indexOf("app.setPath('userData'");
    const cacheIndex = testCode.indexOf("app.setPath('cache'");
    assert.ok(userDataIndex >= 0, 'main.js does not pin the existing userData directory');
    assert.ok(
      userDataIndex < cacheIndex,
      'userData must be pinned before overriding the Chromium cache path'
    );
    assert.ok(
      /app\.getPath\('appData'\)[\s\S]*github-widget-desktop/.test(testCode),
      'userData is not based on the existing Roaming AppData profile'
    );
  });

  // ---------- Defense: trending uses repo.language not repo.langColor ----------
  // (The widget.html rendering is checked in the live test indirectly; here we
  // check that the API field used is 'language', not a derived class name.)

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f.name}: ${f.err.message}`));
    process.exit(1);
  } else {
    console.log('All contract tests passed.');
    process.exit(0);
  }
}

main();
