// Le serveur de développement permet le stockage local ; aucun upload Blob réel.
process.env.E2E_VISUAL_LOCAL = '1';
if (process.argv.length === 2) process.argv.push('tests/e2e/visual-studio.spec.ts', '--config', 'playwright.visual-studio.config.ts');
require('./test-distribution.cjs');
