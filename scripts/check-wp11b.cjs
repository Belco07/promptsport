/**
 * Vérification du WP11b — intégration Resend : envoi des campagnes, suivi des
 * interactions, double opt-in et désabonnement.
 * Exécution : PORT=3002 node scripts/check-wp11b.cjs
 *
 * Comment le parcours d'envoi est-il vérifié sans clé Resend ni réseau ?
 *
 *  - la suite démarre un **serveur Resend factice** local (127.0.0.1:3100) qui
 *    accepte `POST /emails`, renvoie un identifiant de message et conserve les
 *    charges utiles reçues ; elle exécute le CLI `scripts/send-campaign.ts` avec
 *    `RESEND_BASE_URL` pointant dessus. Le code d'envoi réel est donc exercé de
 *    bout en bout, y compris le HTML, les en-têtes et les étiquettes ;
 *  - les webhooks sont **signés localement au format Svix** et envoyés au
 *    serveur de développement, qui les vérifie avec la vraie bibliothèque svix ;
 *  - la route de désabonnement, celle de confirmation et le pixel de suivi sont
 *    appelés en HTTP, comme le ferait un client de messagerie.
 *
 * `tsx` démarre esbuild dans un processus enfant : sous le bac à sable restreint
 * du harnais, ce démarrage échoue (spawn EPERM). Lancer cette suite avec un accès
 * élargi.
 *
 * Toutes les données créées sont préfixées « chk11b » et supprimées à la fin.
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync, existsSync } = require("node:fs");
const { spawn } = require("node:child_process");
const bcrypt = require("bcryptjs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);
const ORIGIN = `http://${HOST}:${PORT}`;
const ROOT = path.resolve(__dirname, "..");

/** Port du serveur Resend factice (distinct de l'application). */
const STUB_PORT = Number(process.env.STUB_PORT || 3100);
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
const STUB_API_KEY = "re_stub_local_test";

const dbUrl = readFileSync(path.join(ROOT, ".env"), "utf8").match(
  /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
)[1];
const db = new Database(path.resolve(ROOT, dbUrl.replace(/^file:(\/\/)?/, "")));
db.pragma("foreign_keys = true");

const readSource = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
const resendSource = readSource("src/lib/resend.ts");
const templatesSource = readSource("src/lib/email-templates.ts");
const sendSource = readSource("src/lib/newsletter-send.ts");
const webhookSource = readSource("src/app/api/webhooks/resend/route.ts");
const pixelSource = readSource("src/app/api/newsletter/track-open/[sendId]/route.ts");
const confirmSource = readSource("src/app/newsletter/confirm/[token]/page.tsx");
const unsubscribeSource = readSource("src/app/newsletter/unsubscribe/[token]/page.tsx");
const adminActions = readSource("src/app/backoffice/newsletter/actions.ts");
const adminPage = readSource("src/app/backoffice/newsletter/page.tsx");
const schema = readSource("prisma/schema.prisma");
const packageJson = JSON.parse(readSource("package.json"));
const envFile = readSource(".env");
const cliSource = readSource("scripts/send-campaign.ts");

/** Secret de développement lu dans .env : celui que le serveur de test vérifie. */
const WEBHOOK_SECRET = envFile.match(/RESEND_WEBHOOK_SECRET\s*=\s*"([^"]*)"/)?.[1] ?? "";

const TAG = `chk11b-${crypto.randomBytes(4).toString("hex")}`;
const MARKER = `${TAG}-marqueur`;
const ids = {
  list: `${TAG}-liste`,
  campaign: `${TAG}-campagne`,
  campaignEchec: `${TAG}-campagne-echec`,
  campaignFinale: `${TAG}-campagne-finale`,
  ok: [1, 2, 3].map((n) => `${TAG}-ok-${n}`),
  echec: `${TAG}-echec-1`,
  horsListe: `${TAG}-hors-liste`,
  attente: `${TAG}-attente`,
  desabonne: `${TAG}-desabonne`,
  bounce: `${TAG}-bounce`,
};
const email = (id) => `${id}@example.test`;

/* ------------------------------------------------------------------ outils */

function createJar() {
  const store = new Map();
  return {
    absorb(list) {
      for (const raw of list ?? []) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index > 0) store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header() {
      return [...store.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    has: (name) => Boolean(store.get(name)),
  };
}

function request(method, urlPath, { jar, form, headers: extra, raw, contentType } = {}) {
  const body = raw ?? (form ? new URLSearchParams(form).toString() : null);
  const headers = { ...(extra ?? {}) };
  if (jar?.header()) headers.cookie = jar.header();
  if (body) {
    headers["content-type"] = contentType ?? "application/x-www-form-urlencoded";
    headers["content-length"] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: urlPath, method, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          jar?.absorb(res.headers["set-cookie"]);
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const get = (urlPath, options) => request("GET", urlPath, options);

async function login(emailAddress, password, callbackPath = "/backoffice/newsletter") {
  const jar = createJar();
  await get("/login", { jar });
  const csrfBody = (await get("/api/auth/csrf", { jar })).body;
  if (!csrfBody.includes("csrfToken")) {
    throw new Error(`Le port ${PORT} ne sert pas promptsport (aucun jeton CSRF).`);
  }
  const csrf = JSON.parse(csrfBody).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email: emailAddress, password, callbackUrl: `${ORIGIN}${callbackPath}` },
  });
  return jar;
}

/** Appel direct d'une Server Action (protocole Next-Action). */
function callAction(jar, pagePath, actionId, args = []) {
  return request("POST", pagePath, {
    jar,
    raw: JSON.stringify(args),
    contentType: "text/plain;charset=UTF-8",
    headers: { "next-action": actionId, origin: ORIGIN },
  });
}

/**
 * Signe une charge utile au format Svix, comme le fait Resend.
 * Le secret `whsec_…` contient une clé en base64 ; la signature porte sur
 * « <id>.<horodatage>.<corps> ».
 */
function signWebhook(payload, { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const id = `msg_${crypto.randomBytes(8).toString("hex")}`;
  const signature = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  };
}

/** Envoie un événement Resend signé à la route de webhook. */
function postWebhook(event, { secret, timestamp, signature } = {}) {
  const payload = JSON.stringify(event);
  const headers = {
    "content-type": "application/json",
    ...(signature ? signature : signWebhook(payload, { secret, timestamp })),
  };
  return request("POST", "/api/webhooks/resend", { raw: payload, headers });
}

/**
 * Exécute le CLI d'envoi avec l'environnement Resend pointé sur le serveur
 * factice.
 *
 * Deux pièges, tous deux rencontrés :
 *
 *  - `spawnSync` **gèle la boucle d'événements** du parent, or c'est le parent
 *    qui héberge le serveur Resend factice : le CLI attendait une réponse que
 *    personne ne pouvait plus produire (interblocage). On utilise donc `spawn`
 *    et on attend la sortie du processus ;
 *  - sous Windows, un shim `.cmd` ne s'exécute pas sans shell : on lance
 *    directement `node <tsx>/dist/cli.mjs`.
 *
 * Le bac à sable du harnais peut refuser les tubes (`spawn EPERM`, visant esbuild
 * lancé par tsx) : on rejoue alors en `inherit`, la sortie s'affiche et les
 * assertions portent sur la base.
 */
function runCli(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      NEXT_PUBLIC_SITE_URL: ORIGIN,
      RESEND_API_KEY: STUB_API_KEY,
      RESEND_FROM_EMAIL: "onboarding@resend.dev",
      RESEND_FROM_NAME: "Mon Site d'Actualités",
      RESEND_BASE_URL: STUB_URL,
    };

    const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const cli = path.join(ROOT, "scripts", "send-campaign.ts");

    const attempt = (stdio) => {
      const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd: ROOT, env, stdio });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        child.kill();
        finish({ status: null, stdout, stderr, inherited: false, error: new Error("délai dépassé") });
      }, timeoutMs);

      if (stdio === "pipe") {
        child.stdout?.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr?.on("data", (chunk) => {
          stderr += chunk;
        });
      }

      child.on("error", (error) => {
        if (/EPERM/.test(String(error.message)) && stdio === "pipe") {
          finish({ status: null, stdout, stderr, inherited: false, error, retry: true });
          attempt("inherit");
          return;
        }
        finish({ status: null, stdout, stderr, inherited: stdio === "inherit", error });
      });

      child.on("exit", (status) =>
        finish({ status, stdout, stderr, inherited: stdio === "inherit", error: null }),
      );
    };

    attempt("pipe");
  });
}

/* ----------------------------------------------------- serveur Resend factice */

const received = [];
let stubFailAll = false;
let stubCount = 0;
let stubServer = null;

function startStub() {
  return new Promise((resolve) => {
    stubServer = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (req.method !== "POST" || !req.url.startsWith("/emails")) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "not found" }));
          return;
        }

        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = {};
        }

        const recipients = Array.isArray(parsed.to) ? parsed.to : [parsed.to];
        const shouldFail =
          stubFailAll || recipients.some((address) => String(address).includes("echec"));

        received.push({ payload: parsed, authorization: req.headers.authorization ?? "", failed: shouldFail });

        if (shouldFail) {
          res.writeHead(422, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              statusCode: 422,
              name: "validation_error",
              message: "Adresse destinataire invalide (simulation).",
            }),
          );
          return;
        }

        stubCount += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `stub-${stubCount}` }));
      });
    });
    stubServer.listen(STUB_PORT, "127.0.0.1", resolve);
  });
}

function stopStub() {
  return new Promise((resolve) => {
    if (!stubServer) return resolve();
    stubServer.close(() => resolve());
  });
}

/* ---------------------------------------------------------------- fixtures */

const sendRows = (campaignId) =>
  db
    .prepare(
      "SELECT id, subscriberId, status, sentAt, deliveredAt, openedAt, clickedAt, errorMessage, providerMessageId FROM NewsletterSend WHERE campaignId = ? ORDER BY createdAt",
    )
    .all(campaignId);
const campaignRow = (id) =>
  db
    .prepare(
      "SELECT status, sentAt, recipientCount, deliveredCount, openCount, clickCount, bounceCount FROM NewsletterCampaign WHERE id = ?",
    )
    .get(id);
const subscriberRow = (id) =>
  db.prepare("SELECT status, confirmedAt, unsubscribedAt, confirmationToken FROM NewsletterSubscriber WHERE id = ?").get(id);
const subscriberId = (address) =>
  db.prepare("SELECT id FROM NewsletterSubscriber WHERE email = ?").get(address)?.id ?? null;

function insertSubscriber(id, status, inList) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO NewsletterSubscriber (id, email, name, status, confirmationToken, confirmedAt, unsubscribedAt, userId, source, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'import', ?, ?)`,
  ).run(
    id,
    email(id),
    `Abonné ${id}`,
    status,
    `${TAG}-token-${id}`,
    status === "CONFIRMED" ? now : null,
    status === "UNSUBSCRIBED" ? now : null,
    now,
    now,
  );
  if (inList) {
    db.prepare("INSERT INTO _NewsletterListToNewsletterSubscriber (A, B) VALUES (?, ?)").run(ids.list, id);
  }
}

function insertCampaign(id, subject) {
  const now = new Date().toISOString();
  const admin = db.prepare("SELECT id FROM Author WHERE email = 'admin@example.com'").get();
  db.prepare(
    `INSERT INTO NewsletterCampaign (id, listId, subject, previewText, contentHtml, contentText, status, scheduledAt, sentAt,
       recipientCount, deliveredCount, openCount, clickCount, bounceCount, createdById, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, NULL, 'DRAFT', NULL, NULL, 0, 0, 0, 0, 0, ?, ?, ?)`,
  ).run(
    id,
    ids.list,
    subject,
    "Aperçu de test",
    `<h1>${subject}</h1><p>${MARKER} contenu de la campagne</p><p><a href="${ORIGIN}/scores">Voir les scores</a></p>`,
    admin.id,
    now,
    now,
  );
}

function cleanup() {
  // Nettoyage par préfixe, et non par tag du run courant : une exécution
  // interrompue (délai dépassé, plantage) laisserait sinon ses abonnés et ses
  // campagnes derrière elle, et la base se remplirait au fil des essais.
  const prefix = "chk11b%";
  const campaigns = db
    .prepare("SELECT id FROM NewsletterCampaign WHERE id LIKE ?")
    .all(prefix)
    .map((row) => row.id);
  for (const campaignId of campaigns) {
    db.prepare("DELETE FROM NewsletterSend WHERE campaignId = ?").run(campaignId);
  }
  db.prepare("DELETE FROM NewsletterCampaign WHERE id LIKE ?").run(prefix);
  db.prepare("DELETE FROM NewsletterSend WHERE subscriberId LIKE ?").run(prefix);
  db.prepare("DELETE FROM _NewsletterListToNewsletterSubscriber WHERE A LIKE ? OR B LIKE ?").run(
    prefix,
    prefix,
  );
  db.prepare("DELETE FROM NewsletterSubscriber WHERE id LIKE ?").run(prefix);
  db.prepare("DELETE FROM NewsletterList WHERE id LIKE ?").run(prefix);
}

/* ------------------------------------------------------------------- tests */

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function main() {
  cleanup();

  /* ------------------------------------------------------ 1) Code et schéma */
  console.log("--- Dépendances, configuration et modules ---");
  check(
    "resend et svix installés",
    Boolean(packageJson.dependencies?.resend && packageJson.dependencies?.svix),
    `resend ${packageJson.dependencies?.resend ?? "absent"} / svix ${packageJson.dependencies?.svix ?? "absent"}`,
  );
  check(
    "script npm newsletter:send déclaré",
    String(packageJson.scripts?.["newsletter:send"] ?? "").includes("send-campaign.ts"),
    packageJson.scripts?.["newsletter:send"],
  );
  check(
    ".env : clé, expéditeur, nom et secret de webhook déclarés",
    /^RESEND_API_KEY=/m.test(envFile) &&
      /^RESEND_FROM_EMAIL="[^"]+"/m.test(envFile) &&
      /^RESEND_FROM_NAME="[^"]+"/m.test(envFile) &&
      /^RESEND_WEBHOOK_SECRET="whsec_/m.test(envFile),
  );
  check(
    "lib/resend : client Resend et envoi sans exception",
    resendSource.includes("new Resend(") &&
      resendSource.includes("export async function sendEmail") &&
      resendSource.includes("getResendClient") &&
      /catch \(error\)/.test(resendSource) &&
      resendSource.includes("success: false"),
  );
  check(
    "lib/resend : expéditeur « Nom <adresse> »",
    /return `\$\{name\} <\$\{email\}>`/.test(resendSource),
  );
  check(
    "templates : styles en ligne, échappement, version texte",
    templatesSource.includes("style=\"") &&
      templatesSource.includes("export function escapeHtml") &&
      templatesSource.includes("export function htmlToText") &&
      templatesSource.includes("renderCampaignEmail") &&
      templatesSource.includes("renderConfirmationEmail") &&
      templatesSource.includes("renderWelcomeEmail"),
  );
  check(
    "templates : désabonnement et pixel présents dans l'e-mail de campagne",
    templatesSource.includes("urls.unsubscribeUrl") && templatesSource.includes("urls.trackingPixelUrl"),
  );
  check(
    "lib/newsletter-send : envoi, double opt-in, événements",
    ["sendCampaign", "sendConfirmationEmail", "sendWelcomeEmail", "recordSendEvent", "recountCampaign"].every(
      (name) => sendSource.includes(`export async function ${name}`),
    ),
  );
  check(
    "envoi : délai de 100 ms entre deux messages",
    /SEND_DELAY_MS = 100/.test(sendSource) && sendSource.includes("await sleep(delayMs)"),
  );
  check(
    "envoi : un échec n'interrompt pas la boucle",
    sendSource.includes("failed += 1") && sendSource.includes('status: "FAILED"'),
  );
  check(
    "envoi : seuls les abonnés CONFIRMED de la liste sont visés",
    /status: "CONFIRMED", lists: \{ some: \{ id: campaign\.listId \} \}/.test(sendSource),
  );
  check(
    "envoi : identifiant fournisseur conservé et étiquettes de repli",
    sendSource.includes("providerMessageId: result.id") && sendSource.includes('name: "send_id"'),
  );
  check(
    "envoi : le statut ne recule jamais (rang d'avancement)",
    sendSource.includes("SEND_RANK") && /if \(target > current\)/.test(sendSource),
  );
  check(
    "envoi : compteurs recalculés, donc idempotents",
    sendSource.includes("export async function recountCampaign") &&
      sendSource.includes("prisma.newsletterSend.count({ where: { campaignId, openedAt: { not: null } } })"),
  );
  check(
    "webhook : signature vérifiée avec svix avant traitement",
    webhookSource.includes('from "svix"') &&
      webhookSource.includes("new Webhook(secret).verify(payload, headers)") &&
      webhookSource.indexOf("verify(payload, headers)") < webhookSource.indexOf("recordSendEvent("),
  );
  check(
    "webhook : les cinq événements du brief sont traités",
    ["email.delivered", "email.opened", "email.clicked", "email.bounced", "email.complained"].every((name) =>
      webhookSource.includes(`"${name}"`),
    ),
  );
  check(
    "pixel de suivi : GIF 1×1 sans cache",
    pixelSource.includes("image/gif") && pixelSource.includes("no-store") && pixelSource.includes("recordSendEvent"),
  );
  check(
    "pages publiques : confirmation et désabonnement dynamiques",
    confirmSource.includes('export const dynamic = "force-dynamic"') &&
      unsubscribeSource.includes('export const dynamic = "force-dynamic"') &&
      confirmSource.includes("notFound()") &&
      unsubscribeSource.includes("notFound()"),
  );
  check(
    "backoffice : action d'envoi réservée aux ADMIN",
    adminActions.includes("export async function sendCampaignAction") &&
      adminActions.includes("await requireAdmin();") &&
      adminActions.includes("sendCampaign(campaignId)"),
  );
  check(
    "périmètre : aucun moteur de template ni bibliothèque UI ajoutés",
    !["mjml", "react-email", "@react-email/components", "handlebars", "ejs", "pug", "nodemailer"].some(
      (name) => name in { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) },
    ),
  );
  check(
    "périmètre : aucun modèle Prisma ajouté par ce lot",
    ["model NewsletterSubscriber", "model NewsletterList", "model NewsletterCampaign", "model NewsletterSend"].every(
      (needle) => schema.includes(needle),
    ) && !/model (EmailLog|ResendEvent|NewsletterTemplate)/.test(schema),
  );
  check(
    "périmètre : modules interdits inchangés",
    ["src/lib/prisma.ts", "src/lib/auth.ts", "src/lib/stripe.ts", "src/lib/seo.ts", "src/lib/analytics.ts", "src/lib/engagement.ts", "src/lib/notifications.ts", "src/middleware.ts"].every(
      (file) => !/resend|newsletter-send/i.test(readSource(file)),
    ),
  );
  check("CLI : les trois modes documentés", /--confirmation/.test(cliSource) && /--welcome/.test(cliSource));

  /* ------------------------------------------------------------ 2) Fixtures */
  console.log("\n--- Jeu de test ---");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO NewsletterList (id, name, slug, description, active, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(ids.list, `Liste ${TAG}`, ids.list, "Liste de test", now, now);

  ids.ok.forEach((id) => insertSubscriber(id, "CONFIRMED", true));
  insertSubscriber(ids.echec, "CONFIRMED", true);
  insertSubscriber(ids.horsListe, "CONFIRMED", false);
  insertSubscriber(ids.attente, "PENDING", true);
  insertSubscriber(ids.desabonne, "UNSUBSCRIBED", true);
  insertSubscriber(ids.bounce, "BOUNCED", true);

  insertCampaign(ids.campaign, `Hebdo ${TAG}`);
  insertCampaign(ids.campaignEchec, `Panne ${TAG}`);
  insertCampaign(ids.campaignFinale, `Finale ${TAG}`);
  check(
    "8 abonnés, 3 campagnes et 1 liste créés",
    db.prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE id LIKE ?").get(`${TAG}%`).c === 8 &&
      db.prepare("SELECT COUNT(*) AS c FROM NewsletterCampaign WHERE id LIKE ?").get(`${TAG}%`).c === 3,
    `${db.prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE id LIKE ?").get(`${TAG}%`).c} abonné(s), ` +
      `${db.prepare("SELECT COUNT(*) AS c FROM NewsletterCampaign WHERE id LIKE ?").get(`${TAG}%`).c} campagne(s)`,
  );

  await startStub();

  try {
    /* -------------------------------------------------- 3) Envoi par le CLI */
    console.log("\n--- Envoi d'une campagne (CLI + serveur Resend factice) ---");
    const cli = await runCli([ids.campaign]);
    const rows = sendRows(ids.campaign);
    const campaign = campaignRow(ids.campaign);

    check(
      "CLI : sortie sans erreur",
      cli.status === 0,
      `code=${cli.status}${cli.error ? ` / ${cli.error.message}` : ""}`,
    );
    check(
      "CLI : quatre destinataires confirmés de la liste, les autres écartés",
      rows.length === 4 &&
        !rows.some((row) =>
          [ids.horsListe, ids.attente, ids.desabonne, ids.bounce].includes(row.subscriberId),
        ),
      `${rows.length} envoi(s)`,
    );
    check(
      "trois envois réussis, un en échec (les autres continuent)",
      rows.filter((row) => row.status === "SENT").length === 3 &&
        rows.filter((row) => row.status === "FAILED").length === 1,
      rows.map((row) => row.status).join(", "),
    );
    check(
      "campagne : statut SENT, date d'envoi et nombre de destinataires",
      campaign?.status === "SENT" &&
        Boolean(campaign?.sentAt) &&
        campaign?.recipientCount === 4,
      `${campaign?.status} / ${campaign?.recipientCount} destinataire(s)`,
    );
    check(
      "envoi en échec : message d'erreur conservé",
      String(rows.find((row) => row.status === "FAILED")?.errorMessage ?? "").length > 0,
      rows.find((row) => row.status === "FAILED")?.errorMessage?.slice(0, 60),
    );
    check(
      "identifiant fournisseur enregistré sur les envois réussis",
      rows.filter((row) => row.status === "SENT").length === 3 &&
        rows
          .filter((row) => row.status === "SENT")
          .every((row) => String(row.providerMessageId ?? "").startsWith("stub-")),
      rows.map((row) => row.providerMessageId ?? "—").join(", "),
    );

    const sentEmails = received.filter((item) => !item.failed);
    check("serveur factice : un appel par destinataire visé", received.length === 4, `${received.length} appel(s)`);
    check(
      "appel : clé d'API transmise en en-tête",
      sentEmails.length === 3 && sentEmails.every((item) => item.authorization.includes(STUB_API_KEY)),
    );
    check(
      "appel : expéditeur, sujet et contenu de la campagne",
      sentEmails.length === 3 &&
        sentEmails.every(
          (item) =>
            String(item.payload.from).includes("onboarding@resend.dev") &&
            item.payload.subject === `Hebdo ${TAG}` &&
            String(item.payload.html).includes(MARKER),
        ),
    );
    check(
      "appel : lien de désabonnement unique par abonné",
      sentEmails.length === 3 &&
        sentEmails.every((item) => {
          const address = item.payload.to;
          const expected = `/newsletter/unsubscribe/${TAG}-token-${subscriberId(address)}`;
          return String(item.payload.html).includes(expected);
        }),
    );
    check(
      "appel : pixel de suivi propre à chaque envoi",
      sentEmails.length === 3 &&
        sentEmails.every((item) => {
          const row = rows.find(
            (candidate) => candidate.providerMessageId && candidate.subscriberId === subscriberId(item.payload.to),
          );
          return row ? String(item.payload.html).includes(`/api/newsletter/track-open/${row.id}`) : false;
        }),
    );
    check(
      "appel : en-têtes List-Unsubscribe (RGPD)",
      sentEmails.length === 3 &&
        sentEmails.every(
          (item) =>
            String(item.payload.headers?.["List-Unsubscribe"] ?? "").includes("/newsletter/unsubscribe/") &&
            item.payload.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click",
        ),
    );
    check(
      "appel : étiquettes send_id et campaign_id pour relier les webhooks",
      sentEmails.length === 3 &&
        sentEmails.every(
          (item) =>
            item.payload.tags?.some((tag) => tag.name === "send_id") &&
            item.payload.tags?.some((tag) => tag.value === ids.campaign),
        ),
    );
    check(
      "appel : version texte fournie (délivrabilité)",
      sentEmails.length === 3 &&
        sentEmails.every((item) => String(item.payload.text ?? "").includes("Se désabonner")),
    );

    const again = await runCli([ids.campaign]);
    check(
      "campagne déjà envoyée : second envoi refusé",
      again.status === 1 &&
        sendRows(ids.campaign).length === 4 &&
        /déjà SENT/.test(again.stdout + again.stderr),
      `code=${again.status}, ${received.length} appel(s) au total`,
    );

    /* --------------------------------------------- 4) Pixel de suivi */
    console.log("\n--- Pixel de suivi d'ouverture ---");
    const send = (subscriberIdValue) =>
      rows.find((row) => row.subscriberId === subscriberIdValue);
    const okSend1 = send(ids.ok[0]);
    const okSend2 = send(ids.ok[1]);
    const okSend3 = send(ids.ok[2]);

    const pixel = await get(`/api/newsletter/track-open/${okSend2.id}`);
    check(
      "pixel : image GIF 1×1 servie sans cache",
      pixel.status === 200 &&
        String(pixel.headers["content-type"]).includes("image/gif") &&
        String(pixel.headers["cache-control"]).includes("no-store"),
      `${pixel.status} ${pixel.headers["content-type"]}`,
    );
    const afterPixel = db
      .prepare("SELECT status, deliveredAt, openedAt FROM NewsletterSend WHERE id = ?")
      .get(okSend2.id);
    check(
      "pixel : l'envoi est marqué ouvert (et donc délivré)",
      afterPixel.status === "OPENED" &&
        Boolean(afterPixel.openedAt) &&
        Boolean(afterPixel.deliveredAt),
      afterPixel.status,
    );
    const pixelAgain = await get(`/api/newsletter/track-open/${okSend2.id}`);
    const pixelUnknown = await get(`/api/newsletter/track-open/${TAG}-envoi-inconnu`);
    check(
      "pixel rejoué ou inconnu : toujours une image, aucun double comptage",
      pixelAgain.status === 200 &&
        pixelUnknown.status === 200 &&
        campaignRow(ids.campaign).openCount === 1 &&
        campaignRow(ids.campaign).deliveredCount === 1,
      `ouvertures=${campaignRow(ids.campaign).openCount} délivrés=${campaignRow(ids.campaign).deliveredCount}`,
    );

    /* ------------------------------------------------------- 5) Webhooks */
    console.log("\n--- Webhooks Resend (signature Svix) ---");
    const noSignature = await request("POST", "/api/webhooks/resend", {
      raw: JSON.stringify({ type: "email.delivered", data: { email_id: "x" } }),
      headers: { "content-type": "application/json" },
    });
    check(
      "webhook sans signature : refusé",
      noSignature.status === 400,
      `status=${noSignature.status}`,
    );

    const badSignature = await request("POST", "/api/webhooks/resend", {
      raw: JSON.stringify({ type: "email.delivered", data: { email_id: "x" } }),
      headers: {
        "content-type": "application/json",
        ...signWebhook("{}"),
      },
    });
    check(
      "webhook signé pour un autre corps : refusé",
      badSignature.status === 400,
      `status=${badSignature.status}`,
    );

    const unknownEvent = await postWebhook({
      type: "email.delivered",
      data: { email_id: "inconnu-chez-nous" },
    });
    check(
      "webhook d'un message inconnu : ignoré sans erreur",
      unknownEvent.status === 200 && /ignored/.test(unknownEvent.body),
      `${unknownEvent.status}`,
    );

    const delivered = await postWebhook({
      type: "email.delivered",
      data: { email_id: okSend1.providerMessageId, to: email(ids.ok[0]) },
    });
    const afterDelivered = db
      .prepare("SELECT status, deliveredAt FROM NewsletterSend WHERE id = ?")
      .get(okSend1.id);
    check(
      "email.delivered : statut DELIVERED et date renseignée",
      delivered.status === 200 &&
        afterDelivered.status === "DELIVERED" &&
        Boolean(afterDelivered.deliveredAt),
      afterDelivered.status,
    );
    check(
      "compteur deliveredCount mis à jour",
      campaignRow(ids.campaign).deliveredCount === 2,
      String(campaignRow(ids.campaign).deliveredCount),
    );

    await postWebhook({ type: "email.opened", data: { email_id: okSend1.providerMessageId } });
    const afterOpened = db
      .prepare("SELECT status, openedAt FROM NewsletterSend WHERE id = ?")
      .get(okSend1.id);
    check(
      "email.opened : statut OPENED et date d'ouverture",
      afterOpened.status === "OPENED" && Boolean(afterOpened.openedAt),
      afterOpened.status,
    );
    check(
      "email.opened : compteur d'ouvertures à 2",
      campaignRow(ids.campaign).openCount === 2,
      String(campaignRow(ids.campaign).openCount),
    );

    await postWebhook({ type: "email.clicked", data: { email_id: okSend1.providerMessageId } });
    const afterClicked = db
      .prepare("SELECT status, clickedAt FROM NewsletterSend WHERE id = ?")
      .get(okSend1.id);
    check(
      "email.clicked : statut CLICKED et date de clic",
      afterClicked.status === "CLICKED" && Boolean(afterClicked.clickedAt),
      afterClicked.status,
    );

    await postWebhook({ type: "email.opened", data: { email_id: okSend1.providerMessageId } });
    const counters = campaignRow(ids.campaign);
    check(
      "événement rejoué : aucune double comptabilisation",
      counters.openCount === 2 && counters.clickCount === 1 && counters.deliveredCount === 2,
      `délivrés=${counters.deliveredCount} ouverts=${counters.openCount} clics=${counters.clickCount}`,
    );
    check(
      "un événement tardif ne fait pas reculer le statut",
      db.prepare("SELECT status FROM NewsletterSend WHERE id = ?").get(okSend1.id).status === "CLICKED",
    );

    const bounced = await postWebhook({
      type: "email.bounced",
      data: {
        email_id: okSend3.providerMessageId,
        bounce: { type: "Permanent", message: "Adresse inexistante" },
      },
    });
    const afterBounce = db
      .prepare("SELECT status, errorMessage FROM NewsletterSend WHERE id = ?")
      .get(okSend3.id);
    check(
      "email.bounced : statut BOUNCED avec le motif",
      bounced.status === 200 &&
        afterBounce.status === "BOUNCED" &&
        String(afterBounce.errorMessage ?? "").includes("Adresse inexistante"),
      `${afterBounce.status} / ${afterBounce.errorMessage?.slice(0, 40)}`,
    );
    check(
      "email.bounced : l'abonné passe en BOUNCED et le compteur suit",
      subscriberRow(ids.ok[2]).status === "BOUNCED" && campaignRow(ids.campaign).bounceCount === 1,
      `abonné=${subscriberRow(ids.ok[2]).status} rejets=${campaignRow(ids.campaign).bounceCount}`,
    );

    await postWebhook({ type: "email.complained", data: { email_id: okSend2.providerMessageId } });
    check(
      "email.complained : l'abonné est désabonné d'office",
      subscriberRow(ids.ok[1]).status === "UNSUBSCRIBED" &&
        Boolean(subscriberRow(ids.ok[1]).unsubscribedAt),
      subscriberRow(ids.ok[1]).status,
    );

    /* ------------------------------- 6) Confirmation et désabonnement */
    console.log("\n--- Double opt-in et désabonnement ---");
    const confirmBefore = subscriberRow(ids.attente);
    const confirm = await get(`/newsletter/confirm/${confirmBefore.confirmationToken}`);
    const confirmAfter = subscriberRow(ids.attente);
    check(
      "confirmation : l'abonné passe en CONFIRMED",
      confirm.status === 200 &&
        confirmAfter.status === "CONFIRMED" &&
        Boolean(confirmAfter.confirmedAt),
      `${confirmAfter.status}`,
    );
    check(
      "confirmation : page de succès explicite",
      confirm.body.includes("Inscription confirmée") && confirm.body.includes(email(ids.attente)),
    );
    const confirmAgain = await get(`/newsletter/confirm/${confirmBefore.confirmationToken}`);
    check(
      "confirmation rejouée : message « déjà confirmée », pas d'erreur",
      confirmAgain.status === 200 && confirmAgain.body.includes("déjà confirmée"),
    );
    const confirmInvalid = await get(`/newsletter/confirm/${TAG}-jeton-inconnu`);
    check("jeton de confirmation inconnu : 404", confirmInvalid.status === 404, `status=${confirmInvalid.status}`);

    const unsubscribeToken = subscriberRow(ids.ok[0]).confirmationToken;
    const unsubscribeView = await get(`/newsletter/unsubscribe/${unsubscribeToken}`);
    const beforeUnsubscribe = subscriberRow(ids.ok[0]);
    check(
      "désabonnement : le GET demande confirmation et ne change rien (WP11c)",
      unsubscribeView.status === 200 &&
        unsubscribeView.body.includes("Voulez-vous vraiment vous désabonner") &&
        beforeUnsubscribe.status === "CONFIRMED" &&
        beforeUnsubscribe.unsubscribedAt === null,
      `statut après GET : ${beforeUnsubscribe.status}`,
    );

    // Le bouton de la page appelle la Server Action : c'est la seule voie qui
    // modifie le statut depuis le WP11c.
    const unsubscribeActionId = findActionId("confirmUnsubscribe");
    const unsubscribe = await callAction(null, `/newsletter/unsubscribe/${unsubscribeToken}`, unsubscribeActionId, [
      unsubscribeToken,
    ]);
    const afterUnsubscribe = subscriberRow(ids.ok[0]);
    check(
      "désabonnement : la Server Action passe l'abonné en UNSUBSCRIBED",
      Boolean(unsubscribeActionId) &&
        unsubscribe.status < 400 &&
        afterUnsubscribe.status === "UNSUBSCRIBED" &&
        Boolean(afterUnsubscribe.unsubscribedAt),
      `${afterUnsubscribe.status} (action ${unsubscribeActionId?.slice(0, 8) ?? "introuvable"})`,
    );
    const unsubscribeAgain = await get(`/newsletter/unsubscribe/${unsubscribeToken}`);
    check(
      "désabonnement rejoué : page « déjà désabonné », date conservée",
      unsubscribeAgain.status === 200 &&
        unsubscribeAgain.body.includes("déjà désabonné") &&
        subscriberRow(ids.ok[0]).unsubscribedAt === afterUnsubscribe.unsubscribedAt,
    );
    const unsubscribeInvalid = await get(`/newsletter/unsubscribe/${TAG}-jeton-inconnu`);
    check("jeton de désabonnement inconnu : 404", unsubscribeInvalid.status === 404, `status=${unsubscribeInvalid.status}`);

    /* ------------------------- 7) Un désabonné ou rejeté ne reçoit plus rien */
    console.log("\n--- Exclusion des abonnés sortis de la liste ---");
    received.length = 0;
    const finale = await runCli([ids.campaignFinale]);
    const finaleRows = sendRows(ids.campaignFinale);
    // Sortis de la liste entre-temps : désabonné par le lien, par une plainte,
    // rejeté par le fournisseur, ou déjà désabonné au départ.
    const excluded = [ids.ok[0], ids.ok[1], ids.ok[2], ids.desabonne, ids.bounce];
    check(
      "campagne suivante : désabonnés, rejetés et plaintes exclus",
      finale.status === 0 &&
        finaleRows.length === 2 &&
        !finaleRows.some((row) => excluded.includes(row.subscriberId)),
      `${finaleRows.length} destinataire(s) : ${finaleRows.map((row) => row.subscriberId).join(", ")}`,
    );
    check(
      "campagne suivante : l'abonné confirmé entre-temps est inclus",
      finaleRows.some((row) => row.subscriberId === ids.attente),
    );

    /* ------------------------------------------- 8) Panne du fournisseur */
    console.log("\n--- Panne du fournisseur : la boucle continue ---");
    stubFailAll = true;
    received.length = 0;
    const panne = await runCli([ids.campaignEchec]);
    stubFailAll = false;
    const panneRows = sendRows(ids.campaignEchec);
    check(
      "panne générale : chaque destinataire est marqué FAILED",
      panneRows.length === 2 && panneRows.every((row) => row.status === "FAILED"),
      panneRows.map((row) => row.status).join(", "),
    );
    check(
      "panne générale : la campagne est en échec, pas « envoyée »",
      campaignRow(ids.campaignEchec).status === "FAILED",
      campaignRow(ids.campaignEchec).status,
    );
    check(
      "panne générale : le script se termine sans exception",
      panne.status === 0,
      `code=${panne.status}`,
    );
    check(
      "panne générale : le motif du fournisseur est conservé",
      panneRows.every((row) => String(row.errorMessage ?? "").length > 0),
      panneRows[0]?.errorMessage?.slice(0, 60),
    );

    /* --------------------------------------- 9) Action du backoffice */
    console.log("\n--- Server Action du backoffice ---");
    const adminJar = await login("admin@example.com", "admin123");
    const journalistJar = await login("journalist@example.com", "password123");
    const actionId = findActionId("sendCampaignAction");
    check("action d'envoi exportée", Boolean(actionId), actionId?.slice(0, 8) ?? "introuvable");

    const anonymousCall = await callAction(null, "/backoffice/newsletter", actionId, [ids.campaignFinale]);
    check(
      "visiteur : envoi refusé et redirection vers /login",
      [302, 307].includes(anonymousCall.status) || anonymousCall.body.includes("/login"),
      `status=${anonymousCall.status}`,
    );
    const journalistCall = await callAction(journalistJar, "/backoffice/newsletter", actionId, [ids.campaignFinale]);
    check(
      "JOURNALIST : envoi refusé et redirection vers /studio",
      String(journalistCall.location ?? "").includes("/studio") || journalistCall.body.includes("/studio"),
      `status=${journalistCall.status}`,
    );

    insertCampaign(`${TAG}-campagne-action`, `Action ${TAG}`);
    const adminCall = await callAction(adminJar, "/backoffice/newsletter", actionId, [`${TAG}-campagne-action`]);
    const actionRows = sendRows(`${TAG}-campagne-action`);
    const actionCampaign = campaignRow(`${TAG}-campagne-action`);
    const serviceMode = actionRows.some((row) => row.providerMessageId) ? "service Resend joignable" : "sans clé Resend";
    check(
      "ADMIN : l'envoi crée un envoi par destinataire sans erreur serveur",
      adminCall.status < 400 && actionRows.length === 2,
      `${actionRows.length} envoi(s), statut campagne ${actionCampaign?.status} (${serviceMode})`,
    );
    check(
      "ADMIN : redirection avec compte rendu d'envoi",
      // Next transmet la redirection d'une Server Action appelée en JavaScript
      // par l'en-tête `x-action-redirect` (le `location` n'existe que pour un
      // POST de formulaire classique).
      `${adminCall.location ?? ""}${adminCall.headers?.["x-action-redirect"] ?? ""}${adminCall.body}`.includes(
        "envoi=",
      ),
      `${String(adminCall.headers?.["x-action-redirect"] ?? adminCall.location ?? "—").slice(0, 60)} (status ${adminCall.status})`,
    );
    check(
      "campagne refusée si elle n'est plus un brouillon",
      (await callAction(adminJar, "/backoffice/newsletter", actionId, [ids.campaign])).status < 400 &&
        sendRows(ids.campaign).length === 4,
    );
    check(
      "page d'administration : compteurs et bouton d'envoi",
      adminPage.includes("sendCampaignAction") &&
        adminPage.includes("Envoyer la campagne") &&
        adminPage.includes("envoi="),
    );

    /* -------------------------------------------------- 10) Nettoyage */
    cleanup();
    const leftovers = db
      .prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE id LIKE ?")
      .get(`${TAG}%`).c;
    check("nettoyage : aucune donnée de test laissée en base", leftovers === 0, `${leftovers} restant(s)`);
  } finally {
    await stopStub();
  }

  db.close();

  const failed = results.filter((result) => !result).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

/** Identifiant d'une action serveur, cherché dans les manifestes de Next. */
function findActionId(exportedName) {
  const { readdirSync } = require("node:fs");
  const root = path.join(ROOT, ".next/server/app");
  if (!existsSync(root)) return null;

  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.name !== "server-reference-manifest.json") continue;
      try {
        const manifest = JSON.parse(readFileSync(full, "utf8"));
        for (const [id, value] of Object.entries(manifest.node ?? {})) {
          if (value?.exportedName === exportedName) return id;
        }
      } catch {
        /* manifeste illisible */
      }
    }
  }
  return null;
}

main().catch(async (error) => {
  try {
    cleanup();
  } catch {
    /* nettoyage au mieux */
  }
  await stopStub().catch(() => {});
  console.error("ERREUR:", error.stack);
  process.exit(1);
});
