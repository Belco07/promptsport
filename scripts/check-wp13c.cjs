/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS verification script. */
/** WP13c: styles publics, contrastes des palettes et routes (port 3002 par défaut).
 * Aucun formulaire métier n'est soumis. Authentification facultative avec
 * WP13C_TEST_EMAIL / WP13C_TEST_PASSWORD pour les pages de compte.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3002);
const results = [];
function check(label, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK' : 'ECHEC'} | ${label}${detail ? ' | ' + detail : ''}`);
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const fixedColor = /\b(?:bg|text|border|divide|ring|from|to|via|outline|fill|stroke)-(?:white|black|(?:gray|neutral|ink|primary|brand|blue|green|red|amber|danger|success|accent|orange|slate|zinc|stone|emerald|sky|indigo|violet|purple|pink|rose)-\d{2,3})(?:\/\d+)?\b/g;
const pages = walk(path.join(root, 'src/app')).filter(p => p.endsWith('.tsx') &&
  !/[\\/](studio|backoffice|api)[\\/]/.test(p) && !/(layout|opengraph|icon)/.test(path.basename(p)));
const secondary = ['CommentsSection', 'CommentForm', 'CommentReactions', 'ArticleReactions',
  'ReportModal', 'NotificationItem', 'NotificationBadge', 'NewsletterForm', 'SubscriptionStatus',
  'ScoresScroller', 'LiveScoresBar', 'StandingsTable', 'UserMenu', 'ThemeToggle',
  'NotificationPreferences', 'PlanCard'];

function colors(css, dark) {
  css = css.replace(/\/\*[^]*?\*\//g, "");
  const vars = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    if (selector !== '.public-site' && !(dark && selector === '.dark .public-site')) continue;
    for (const [, name, value] of match[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
  }
  return vars;
}
function rgb(value) {
  if (/^#[\da-f]{6}$/i.test(value)) return value.slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
  const [h, s, l] = value.split(/\s+/).map(parseFloat);
  const a = s / 100 * Math.min(l / 100, 1 - l / 100);
  return [0, 8, 4].map(n => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  });
}
function luminance(color) {
  return rgb(color).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
const cookies = new Map();
function request(route, { auth = false, form } = {}) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const headers = {};
    if (auth) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body) Object.assign(headers, { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) });
    const req = http.request({ hostname: 'localhost', port, path: route, method: body ? 'POST' : 'GET', headers }, res => {
      if (auth) for (const raw of res.headers['set-cookie'] || []) {
        const pair = raw.split(';')[0], split = pair.indexOf('=');
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(90000, () => req.destroy(new Error('Délai dépassé : ' + route)));
    req.on('error', reject);
    req.end(body);
  });
}
async function main() {
  for (const file of [...pages, ...secondary.map(n => path.join(root, 'src/components', n + '.tsx'))]) {
    const matches = fs.readFileSync(file, 'utf8').match(fixedColor) || [];
    check('couleurs sémantiques : ' + path.relative(root, file), !matches.length, [...new Set(matches)].join(', '));
  }
  // Ces deux composants servent aussi au CMS : chaque classe historique doit
  // posséder son équivalent public, sans changer les styles hors public-site.
  for (const name of ['SubscriptionTimeline', 'SportTabs']) {
    const source = read('src/components/' + name + '.tsx');
    const fixed = [...source.matchAll(fixedColor)];
    check('isolation CMS : ' + name, fixed.every(m =>
      source.slice(m.index + m[0].length).startsWith(' [.public-site_&]:')));
  }
  const palette = read('src/app/globals.css') + '\n' + read('src/app/editorial.css');
  for (const dark of [false, true]) {
    const v = colors(palette, dark);
    const pairs = [
      ['texte / page', v['--foreground'], v['--background']],
      ['texte / carte', v['--foreground'], v['--card']],
      ['secondaire / page', v['--muted-foreground'], v['--background']],
      ['secondaire / surface', v['--muted-foreground'], v['--muted']],
      ['lien / surface', v['--ed-link'], v['--muted']],
      ['action', '#ffffff', v['--primary']],
      ['action survol', '#ffffff', v['--primary-hover']],
      ['destructif', '#ffffff', v['--destructive']],
      ['action éditoriale', '#ffffff', v['--editorial-action']],
      ...['premium', 'warning', 'success', 'error'].map(t => [t, v[`--status-${t}-foreground`], v[`--status-${t}`]]),
    ];
    for (const [name, fg, bg] of pairs) {
      const ratio = contrast(fg, bg);
      check(`${dark ? 'Nuit' : 'Jour'} contraste ${name}`, ratio >= 4.5, ratio.toFixed(2) + ':1');
    }
  }
  if (process.argv.includes('--static')) return;
  const home = await request('/');
  check('serveur PromptSport port ' + port, home.status === 200 && home.body.includes('PromptSport'));
  const routes = ['/scores', '/abonnement', '/abonnement/success', '/abonnement/cancel', '/login',
    '/newsletter', '/mentions-legales', '/confidentialite', '/newsletter/confirm/wp13c-invalid',
    '/newsletter/unsubscribe/wp13c-invalid', '/newsletter/preferences/wp13c-invalid'];
  for (const kind of ['article', 'competition', 'match', 'auteur']) {
    const m = home.body.match(new RegExp('href="(/' + kind + '/[^"?#]+)"'));
    check('lien réel ' + kind, Boolean(m));
    if (m) routes.push(m[1]);
  }
  for (const route of routes) {
    const response = await request(route);
    check('GET ' + route, response.status === 200 || (route.includes('wp13c-invalid') && response.status === 404), String(response.status));
  }
  if (process.env.WP13C_TEST_EMAIL && process.env.WP13C_TEST_PASSWORD) {
    const csrf = JSON.parse((await request('/api/auth/csrf', { auth: true })).body).csrfToken;
    await request('/api/auth/callback/credentials', { auth: true, form: {
      csrfToken: csrf, email: process.env.WP13C_TEST_EMAIL, password: process.env.WP13C_TEST_PASSWORD,
      callbackUrl: `http://localhost:${port}/`,
    } });
    for (const route of ['/mon-compte', '/mon-compte/abonnement', '/mon-compte/notifications', '/mon-compte/preferences']) {
      const response = await request(route, { auth: true });
      check('compte authentifié ' + route, response.status === 200 && !response.body.includes('NEXT_REDIRECT'), String(response.status));
    }
  } else console.log('NON VÉRIFIÉ : pages authentifiées (fournir WP13C_TEST_EMAIL/PASSWORD).');
}
main().catch(error => check('exécution', false, error.message)).finally(() => {
  console.log(`RESULTAT : ${results.filter(Boolean).length}/${results.length}`);
  process.exitCode = results.every(Boolean) ? 0 : 1;
});
