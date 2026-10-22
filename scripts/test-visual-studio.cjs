// Build optimisé, PostgreSQL Docker et API Blob locale : aucun upload réel.
process.env.E2E_VISUAL_LOCAL = '1';
process.env.E2E_VISUAL_BLOB_STUB = '1';
if (process.argv.length === 2) process.argv.push('tests/e2e/visual-studio.spec.ts', 'tests/e2e/visual-workflow.spec.ts', '--config', 'playwright.visual-production.config.ts');
require('./test-distribution.cjs');
