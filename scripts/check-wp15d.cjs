/**
 * WP15d — Citations enrichies et aperçu live.
 *
 * Vérifie le bouton « Insérer une citation », la boîte de dialogue, la directive
 * produite, le composant `BlockquoteEnriched`, le plugin `remark-quotes`, les
 * onglets Éditer / Aperçu (débounce 500 ms), le partage du rendu avec la page
 * article publique, puis le rendu réel d'un article contenant les deux syntaxes.
 *
 * Le serveur doit tourner sur le port 3002 (celui de promptsport) :
 *   PORT=3002 node scripts/check-wp15d.cjs
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z]/.test(line))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`OK    | ${label}${detail ? ` -> ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`ECHEC | ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

const readSource = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function get(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/** Répertoires de chunks client (dev et production séparent leurs builds). */
function chunkDirectories() {
  return [".next-production", ".next"]
    .map((buildDir) => path.join(ROOT, buildDir, "static", "chunks"))
    .filter((dir) => fs.existsSync(dir));
}

/** Contenu de test : les deux syntaxes de citation, un blockquote classique,
 *  et un embed social pour vérifier que la refonte du rendu ne l'a pas cassé. */
const CONTENT = [
  "Un paragraphe avant les citations.",
  "",
  '::quote{#UnMot auteur="Victor Hugo"}',
  "",
  '::quote[Le monde appartient à ceux qui se lèvent tôt]{auteur="Victor Hugo"}',
  "",
  "> Une citation Markdown classique, qui garde son style d'origine.",
  "",
  '::social{platform="youtube" url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}',
].join("\n");

async function main() {
  /* ------------------------------------------------------------ 1) plugin */
  section("Plugin remark des citations");
  const plugin = readSource("src/lib/remark-quotes.ts");
  check("plugin créé", plugin.includes("export function remarkQuotes"));
  check(
    "les deux syntaxes sont lues (crochets et #identifiant)",
    plugin.includes("directive.children") && plugin.includes("attributes?.id"),
  );
  check(
    "auteur lu depuis `auteur` ou `author`",
    plugin.includes("attributes?.auteur ?? directive.attributes?.author"),
  );
  check(
    "marqueur `data-quote` posé pour le rendu",
    plugin.includes('"data-quote": "true"') && plugin.includes('"data-quote-author"'),
  );

  /* --------------------------------------------------------- 2) composant */
  section("Composant BlockquoteEnriched");
  const enriched = readSource("src/components/BlockquoteEnriched.tsx");
  check("composant créé", enriched.includes("export function BlockquoteEnriched"));
  check(
    "structure figure / blockquote / figcaption",
    enriched.includes('className="quote-enriched"') &&
      enriched.includes("quote-enriched-text") &&
      enriched.includes("<figcaption"),
  );
  check("auteur en petites majuscules via la classe dédiée", enriched.includes("quote-enriched-author"));

  /* --------------------------------------------------- 3) rendu partagé */
  section("Rendu partagé avec la page article publique");
  const renderer = readSource("src/components/MarkdownRenderer.tsx");
  check("MarkdownRenderer créé", renderer.includes("export function MarkdownRenderer"));
  check(
    "plugins branchés dans l'ordre : gfm, directive, citations, embeds",
    /remarkPlugins=\{\[remarkGfm, remarkDirective, remarkQuotes, remarkSocialEmbeds\]\}/.test(renderer),
  );
  check(
    "les citations marquées passent par BlockquoteEnriched",
    renderer.includes("BlockquoteEnriched") && renderer.includes('"data-quote"'),
  );
  const articlePage = readSource("src/app/article/[slug]/page.tsx");
  check(
    "la page article utilise le même rendu (aucune copie locale)",
    articlePage.includes("<MarkdownRenderer") && !articlePage.includes("markdownComponents"),
  );
  check(
    "l'aperçu de l'éditeur utilise le même rendu",
    readSource("src/components/RichTextEditor.tsx").includes("<MarkdownRenderer markdown={previewMarkdown}"),
  );

  /* ------------------------------------------------------------ 4) bouton */
  section("Bouton et dialogue de citation");
  const quote = readSource("src/components/editor/quoteDirective.tsx");
  const cleanQuote = stripComments(quote);
  check("composant client", quote.includes('"use client"'));
  check(
    "bouton branché dans la toolbar",
    readSource("src/components/RichTextEditor.tsx").includes("<QuoteButton />"),
  );
  check("icône Quote", quote.includes("Quote") && quote.includes("lucide-react"));
  check(
    "deux champs : citation et auteur (optionnel)",
    cleanQuote.includes("Texte de la citation") && cleanQuote.includes("Auteur (optionnel)"),
  );
  check(
    "directive du brief produite pour un mot unique",
    cleanQuote.includes("::quote{#${cleanText}") || cleanQuote.includes("`::quote{#${cleanText}"),
  );
  check(
    "forme entre crochets pour une phrase (le #id ne garde qu'un mot)",
    cleanQuote.includes("::quote[${cleanText}]"),
  );
  check(
    "descripteur enregistré (MDXEditor exige un descripteur par directive)",
    readSource("src/components/RichTextEditor.tsx").includes(
      "directiveDescriptors: [socialEmbedDescriptor, quoteDescriptor]",
    ) && quote.includes("export const quoteDescriptor"),
  );
  check(
    "aucun <form> imbriqué et boutons typés",
    !cleanQuote.includes("<form") && !/<button(?![^>]*\btype=)/.test(cleanQuote),
  );

  /* ----------------------------------------------------------- 5) aperçu */
  section("Onglets Éditer / Aperçu");
  const editor = readSource("src/components/RichTextEditor.tsx");
  check(
    "deux onglets déclarés",
    editor.includes('role="tablist"') &&
      editor.includes("Éditer") &&
      editor.includes("Aperçu") &&
      editor.includes('role="tabpanel"'),
  );
  check("débounce de 500 ms", editor.includes("PREVIEW_DEBOUNCE_MS = 500"));
  check("message « Rendu en cours… »", editor.includes("Rendu en cours…"));
  check(
    "l'éditeur reste monté quand l'aperçu est affiché (pas de perte de contenu)",
    editor.includes('className={tab === "edit" ? undefined : "hidden"}'),
  );

  /* ------------------------------------------------------------ 6) styles */
  section("Styles");
  const css = readSource("src/app/globals.css");
  check(
    "citation : bordure d'accent, italique, auteur en majuscules",
    css.includes(".quote-enriched-text") &&
      css.includes("border-left: 4px solid var(--ed-link") &&
      css.includes("font-style: italic") &&
      css.includes("text-transform: uppercase"),
  );
  check(
    "onglets et aperçu stylés avec les jetons de thème",
    css.includes(".editor-tabs") &&
      css.includes(".editor-tab--active") &&
      css.includes(".editor-preview") &&
      css.includes("hsl(var(--card))"),
  );

  /* ------------------------------------------------------------ 7) bundle */
  section("Bundle client");
  const dirs = chunkDirectories();
  if (dirs.length > 0) {
    const bundle = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js")) bundle.push(fs.readFileSync(full, "utf8"));
      }
    };
    for (const dir of dirs) walk(dir);
    const joined = bundle.join("\n");
    check("bouton de citation présent", joined.includes("Insérer une citation"));
    check("aperçu présent", joined.includes("Rendu en cours…") && joined.includes("editor-preview"));
  } else {
    console.log("   (aucun build trouvé : contrôle du bundle ignoré — lancez `npm run build`)");
  }

  /* ------------------------------------------------------- 8) rendu réel */
  section("Rendu d'un article contenant les deux syntaxes");
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const slug = `test-quote-wp15d-${Date.now().toString(36)}`;
  const author = (await db.query('SELECT id FROM "Author" ORDER BY "createdAt" LIMIT 1')).rows[0];
  const category = (await db.query('SELECT id FROM "Category" ORDER BY "createdAt" LIMIT 1')).rows[0];

  try {
    await db.query(
      `INSERT INTO "Article" (id, title, slug, content, status, "publishedAt", "authorId", "categoryId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PUBLISHED', now(), $5, $6, now(), now())`,
      [
        `test-quote-${Date.now().toString(36)}`,
        "Test citations WP15d",
        slug,
        CONTENT,
        author.id,
        category.id,
      ],
    );

    const page = await get(`/article/${slug}`);
    const html = page.body;
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, "");
    const enrichedBlocks = (visible.match(/class="quote-enriched"/g) ?? []).length;

    check("article de test rendu", page.status === 200, `status=${page.status}`);
    check("deux citations enrichies", enrichedBlocks === 2, `${enrichedBlocks} bloc(s)`);
    check(
      "forme `#mot` rendue (texte lu depuis l'identifiant)",
      visible.includes("UnMot"),
    );
    check(
      "forme entre crochets rendue en entier",
      visible.includes("Le monde appartient à ceux qui se lèvent tôt"),
    );
    check(
      "auteur affiché sous la citation",
      (visible.match(/class="quote-enriched-author">Victor Hugo</g) ?? []).length === 2,
    );
    check(
      "la citation Markdown classique garde son style d'origine",
      visible.includes("Une citation Markdown classique") &&
        !/class="quote-enriched"[\s\S]{0,200}citation Markdown classique/.test(visible),
    );
    check(
      "l'embed social fonctionne toujours (WP15c non régressé)",
      visible.includes('data-social-embed="youtube"'),
    );
    // La description SEO de repli reprend le début du Markdown brut (donc la
    // syntaxe des directives) : le contrôle porte sur le corps rendu.
    const renderedBody = visible
      .replace(/<meta[^>]*>/g, "")
      .replace(/<title>[\s\S]*?<\/title>/g, "");
    check("aucune directive brute dans le corps rendu", !renderedBody.includes("::quote"));
  } finally {
    await db.query('DELETE FROM "Article" WHERE slug = $1', [slug]);
    const left = await db.query('SELECT count(*)::int AS n FROM "Article" WHERE slug LIKE $1', [
      "test-quote-wp15d-%",
    ]);
    console.log(`   (article de test supprimé, restants = ${left.rows[0].n})`);
    await db.end();
  }

  console.log(`\nRESULTAT: ${passed}/${passed + failed} vérifications réussies`);
  if (failed > 0) {
    console.log(`ECHEC : ${failed} vérification(s) en échec`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("ECHEC | exécution de la suite :", error);
  process.exitCode = 1;
});
