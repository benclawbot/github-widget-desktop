// Pre-commit test runner.
// Runs contract tests (no network) on every commit. Blocks the commit
// if any test fails.
//
// Install: this file is wired up by the prepare-commit-msg hook in
// package.json, or can be run manually: node tests/precommit.js
//
// Why this exists: I shipped 4 broken features in a row in one session.
// The user said "make sure you test before saying it's done." A memory
// file is not enough. This is a hard gate at commit time.

const { spawnSync } = require('child_process');
const path = require('path');

console.log('Running pre-commit checks...\n');

const contractTest = spawnSync('node', ['tests/contract.test.js'], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8'
});

console.log(contractTest.stdout);
if (contractTest.stderr) console.error(contractTest.stderr);

if (contractTest.status !== 0) {
  console.error('\nPre-commit check FAILED.');
  console.error('Contract tests are failing. Fix the regressions before committing.');
  console.error('To skip this check (NOT RECOMMENDED): git commit --no-verify');
  process.exit(1);
}

console.log('\nPre-commit checks passed. Proceeding with commit.');
process.exit(0);
