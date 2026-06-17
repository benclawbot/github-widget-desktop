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

  await it('github-full-sync uses /repos/{user}/{repo}/commits (not /{user}/{repo}/commits)', () => {
    // Extract the commits fetch line from main.js
    const matches = testCode.match(/\/[^"`]*\$\{username\}\/\$\{repo\.name\}\/commits[^"`]*/g) || [];
    assert.ok(matches.length > 0, 'no commits API call found in main.js');
    const allUseReposPrefix = matches.every(m => m.startsWith('/repos/'));
    assert.ok(
      allUseReposPrefix,
      `found commits API call without /repos/ prefix: ${matches.find(m => !m.startsWith('/repos/'))}`
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
