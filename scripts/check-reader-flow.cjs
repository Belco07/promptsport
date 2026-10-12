// Local integration checks. Port 3002 only; owns and removes only its test account.
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('pg');
process.loadEnvFile();
const base = 'http://localhost:3002';
const cookies = new Map();
const email = `reader-test-${randomUUID()}@example.invalid`;
const password = `Test-${randomUUID()}`;
let id;
let count = 0;
const db = new Client({ connectionString: process.env.DATABASE_URL });
function check(label, ok) { assert.ok(ok, label); count++; console.log(`OK ${label}`); }
async function request(path, options = {}) {
  const response = await fetch(base + path, { ...options, redirect: 'manual', headers: { cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), origin: base, ...options.headers } });
  for (const value of response.headers.getSetCookie()) { const pair = value.split(';')[0]; const index = pair.indexOf('='); cookies.set(pair.slice(0,index), pair.slice(index+1)); }
  return { status: response.status, location: response.headers.get('location'), body: await response.text() };
}
function formFrom(html) {
  const form = new FormData();
  for (const match of html.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]+)"/)?.[1];
    const value = match[0].match(/value="([^"]*)"/)?.[1] ?? '';
    if (name?.startsWith('$ACTION')) form.append(name, value.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#x27;', "'"));
  }
  assert.ok([...form.keys()].length, 'Server Action form metadata');
  return form;
}
(async () => {
  await db.connect();
  try {
    const signup = await request('/inscription');
    check('inscription disponible', signup.status === 200 && signup.body.includes('Créer un compte'));
    const form = formFrom(signup.body);
    form.set('name', 'Lecteur Test'); form.set('email', email); form.set('password', password); form.set('terms', 'on'); form.set('role', 'ADMIN');
    const registered = await request('/inscription', { method: 'POST', body: form });
    const row = (await db.query('SELECT id, role, "passwordHash", "welcomeCompleted" FROM "Author" WHERE email = $1', [email])).rows[0];
    id = row?.id;
    check('création publique force le rôle lecteur', row?.role === 'READER');
    check('mot de passe haché', row.passwordHash !== password && await require('bcryptjs').compare(password, row.passwordHash));
    check('redirection de première connexion', registered.status === 303 && registered.location === '/bienvenue');
    const session = JSON.parse((await request('/api/auth/session')).body);
    check('session lecteur active', session.user?.id === id && session.user.role === 'READER');
    check('studio inaccessible au lecteur', (await request('/studio')).status === 307);
    check('backoffice inaccessible au lecteur', (await request('/backoffice')).status === 307);
    const welcome = await request('/bienvenue');
    check('écran de bienvenue', welcome.status === 200 && welcome.body.includes('Bienvenue sur PromptSport'));
    const preferences = await request('/bienvenue?etape=preferences');
    const favorite = (await db.query('SELECT slug FROM "Competition" ORDER BY name LIMIT 1')).rows[0].slug;
    const prefs = formFrom(preferences.body); prefs.set('competition', favorite); prefs.append('competition', 'invalid-competition'); prefs.set('intent', 'save');
    const saved = await request('/bienvenue?etape=preferences', { method: 'POST', body: prefs });
    check('préférences enregistrées', saved.status === 303);
    const updated = (await db.query('SELECT "favoriteCompetitions", "welcomeCompleted" FROM "Author" WHERE id=$1', [id])).rows[0];
    check('favoris validés en base', updated.favoriteCompetitions.length === 1 && updated.favoriteCompetitions[0] === favorite);
    check('bienvenue terminée', updated.welcomeCompleted === true);
    check('bienvenue non répétée', (await request('/bienvenue')).location === '/mon-compte');
    const account = await request('/mon-compte/favoris');
    check('favoris accessibles dans le compte', account.status === 200 && account.body.includes(`/competition/${favorite}`));
    const duplicate = formFrom(signup.body); duplicate.set('name','Doublon'); duplicate.set('email',email); duplicate.set('password',password); duplicate.set('terms','on');
    const repeated = await request('/inscription', { method:'POST', body:duplicate });
    check('doublon refusé', repeated.body.includes('Inscription impossible'));
    console.log(`${count} contrôles réussis`);
  } finally {
    if (id && process.argv.includes('--keep-ui-fixture')) {
      await db.query('UPDATE "Author" SET "welcomeCompleted"=false WHERE id=$1', [id]);
      console.log(JSON.stringify({ testOnly: true, id, email, password }));
    } else if (id) await db.query('DELETE FROM "Author" WHERE id=$1 AND email=$2', [id, email]);
    await db.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
