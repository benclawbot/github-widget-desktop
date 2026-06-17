// Install the pre-commit hook from tests/hooks/ into .git/hooks/.
// Idempotent: re-running is safe. Run automatically by npm install (postinstall)
// and can be run manually with: node tests/setup-hooks.js

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'hooks', 'pre-commit');
const dest = path.join(__dirname, '..', '.git', 'hooks', 'pre-commit');

try {
  const content = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(dest, content, { mode: 0o755 });
  console.log('Pre-commit hook installed at .git/hooks/pre-commit');
  console.log('It will run on every git commit. Bypass with: git commit --no-verify');
} catch (err) {
  console.error('Failed to install hook:', err.message);
  process.exit(1);
}
