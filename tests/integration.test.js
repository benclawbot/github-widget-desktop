// Live integration test — hits the real GitHub API for every endpoint
// the app uses. Run with: node tests/integration.test.js
// Fails the process (exit 1) if any endpoint returns unexpected data.
//
// Why this exists: I shipped code 4 times in a row in this project that
// assumed API behavior I hadn't verified. This test makes those mistakes
// fail loudly at commit time instead of at user-runtime.

const https = require('https');
const fs = require('path');

// Optional: export GITHUB_TOKEN=<your token> before running. Never hardcode it.
// Without a token the test still works, but is limited to 60 requests/hour.
const TOKEN = process.env.GITHUB_TOKEN || '';
const USERNAME = 'benclawbot';

let passed = 0, failed = 0;
const failures = [];

function fetch(path) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'GitHub-Widget-Integration-Test' };
    if (TOKEN) headers['Authorization'] = `token ${TOKEN}`;
    const req = https.request({ hostname: 'api.github.com', path, method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, data: null }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function assert(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  FAIL ${name} — ${detail}`);
  }
}

function section(name, fn) {
  console.log(`\n[${name}]`);
  return fn();
}

async function main() {
  console.log('GitHub Widget — live integration test\n');

  await section('User endpoint', async () => {
    const r = await fetch('/user');
    assert('returns 200', r.status === 200, `status=${r.status}`);
    assert('has login field', r.data?.login === USERNAME, `login=${r.data?.login}`);
    assert('has public_repos', typeof r.data?.public_repos === 'number', `public_repos=${r.data?.public_repos}`);
  });

  let allRepos = [];
  await section('Repos endpoint (paginated, per_page=100)', async () => {
    for (let page = 1; page <= 3; page++) {
      const r = await fetch(`/users/${USERNAME}/repos?sort=pushed&per_page=100&page=${page}&type=all`);
      assert(`page ${page} returns 200`, r.status === 200, `status=${r.status}`);
      assert(`page ${page} is an array`, Array.isArray(r.data), `type=${typeof r.data}`);
      if (Array.isArray(r.data) && r.data.length > 0) allRepos = allRepos.concat(r.data);
      else break;
    }
    assert('finds at least 1 repo', allRepos.length > 0, `count=${allRepos.length}`);
    if (allRepos[0]) {
      assert('repo has name', typeof allRepos[0].name === 'string', `name=${allRepos[0].name}`);
      assert('repo has pushed_at', typeof allRepos[0].pushed_at === 'string', `pushed_at=${allRepos[0].pushed_at}`);
      assert('repo has language (not langColor)', 'language' in allRepos[0], `keys=${Object.keys(allRepos[0]).slice(0,5).join(',')}`);
      assert('repo has stargazers_count', typeof allRepos[0].stargazers_count === 'number', `stargazers_count=${allRepos[0].stargazers_count}`);
    }
  });

  await section('CRITICAL: Commits endpoint path', async () => {
    // This is the bug that took 4 attempts to find: /{user}/{repo}/commits is 404,
    // correct path is /repos/{user}/{repo}/commits
    const testRepo = allRepos[0];
    if (!testRepo) { assert('has a repo to test', false, 'no repos returned'); return; }

    const wrong = await fetch(`/${USERNAME}/${testRepo.name}/commits?per_page=3`);
    assert('wrong path /{user}/{repo}/commits returns 404 (confirms the bug we are protecting against)',
      wrong.status === 404, `status=${wrong.status}`);

    const right = await fetch(`/repos/${USERNAME}/${testRepo.name}/commits?per_page=3`);
    assert('correct path /repos/{user}/{repo}/commits returns 200', right.status === 200, `status=${right.status}`);
    assert('commits response is an array', Array.isArray(right.data), `type=${typeof right.data}`);
    if (Array.isArray(right.data) && right.data[0]) {
      assert('commit has commit.author.date', typeof right.data[0].commit?.author?.date === 'string',
        `date=${right.data[0].commit?.author?.date}`);
    }
  });

  await section('Events endpoint (for quick refresh delta)', async () => {
    const r = await fetch(`/users/${USERNAME}/events?per_page=10`);
    assert('returns 200', r.status === 200, `status=${r.status}`);
    assert('is an array', Array.isArray(r.data), `type=${typeof r.data}`);
    // Events API only retains ~300 most recent — document this constraint
    if (Array.isArray(r.data) && r.data[0]) {
      assert('event has type', typeof r.data[0].type === 'string', `type=${r.data[0].type}`);
      assert('event has created_at', typeof r.data[0].created_at === 'string', `created_at=${r.data[0].created_at}`);
    }
  });

  await section('Trending endpoint', async () => {
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const r = await fetch(`/search/repositories?q=created:>${sevenDaysAgo.toISOString().split('T')[0]}+stars:>10&sort=stars&order=desc&per_page=6`);
    assert('returns 200', r.status === 200, `status=${r.status}`);
    assert('has items array', Array.isArray(r.data?.items), `items type=${typeof r.data?.items}`);
    if (r.data?.items?.[0]) {
      assert('trending repo has full_name', typeof r.data.items[0].full_name === 'string', `full_name=${r.data.items[0].full_name}`);
      assert('trending repo has description (may be null)', 'description' in r.data.items[0], `description present`);
      assert('trending repo has language (may be null)', 'language' in r.data.items[0], `language present`);
      assert('trending repo has stargazers_count', typeof r.data.items[0].stargazers_count === 'number', `stargazers_count=${r.data.items[0].stargazers_count}`);
    }
  });

  await section('Rate limit visibility', async () => {
    const r = await fetch('/rate_limit');
    assert('returns 200', r.status === 200, `status=${r.status}`);
    const remaining = r.data?.rate?.remaining;
    const limit = r.data?.rate?.limit;
    console.log(`    rate: ${remaining}/${limit} remaining`);
    assert('rate limit exposed in response', typeof remaining === 'number' && typeof limit === 'number',
      `remaining=${remaining}, limit=${limit}`);
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  } else {
    console.log('All integration tests passed.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
