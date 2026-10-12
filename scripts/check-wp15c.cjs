/**
 * WP15c — Embeds multi-réseaux sociaux.
 *
 * Vérifie :
 *   1) le registre de plateformes et la validation des adresses ;
 *   2) le branchement du plugin remark et du composant dans le rendu public ;
 *   3) l'enregistrement de la directive et du bouton dans l'éditeur, y compris
 *      dans le bundle de production quand un build existe ;
 *   4) le rendu réel d'un article contenant des directives.
 *
 * Le serveur doit tourner sur le port 3002 (celui de promptsport) :
 *   PORT=3002 node scripts/check-wp15c.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3002);
const BASE = `http://localhost:${PORT}`;

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

function readSource(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

/** Contenu de test : deux plateformes embarquables, une sans embed, une invalide. */
const CONTENT = [
  "Un paragraphe avant les embeds.",
  "",
  '::social{platform="instagram" url="https://www.instagram.com/p/ABC123/"}',
  "",
  '::social{platform="bluesky" url="https://bsky.app/profile/promptsport.bsky.social/post/abc"}',
  "",
  '::social{platform="youtube" url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}',
  "",
  '::social{platform="instagram" url="https://exemple-malveillant.test/p/1"}',
  "",
  "Un paragraphe après.",
].join("\n");

async function main() {
  /* ------------------------------------------------ 1) registre de plateformes */
  section("Registre de plateformes et validation des adresses");
  const registry = readSource("src/lib/social-embeds.ts");
  const expectedPlatforms = [
    "youtube",
    "x",
    "instagram",
    "facebook",
    "tiktok",
    "linkedin",
    "pinterest",
    "bluesky",
  ];
  check(
    "les huit plateformes du brief sont déclarées",
    expectedPlatforms.every((id) => registry.includes(`id: "${id}"`)),
    expectedPlatforms.join(", "),
  );
  check(
    "les plateformes sans composant d'embed sont signalées (hasEmbed: false)",
    /hasEmbed: false/.test(registry),
  );
  check(
    "validation : protocole limité et domaine vérifié",
    registry.includes('parsed.protocol !== "http:"') && registry.includes("platform.domains.some"),
  );

  /* ------------------------------------------------------- 2) rendu public */
  section("Branchement du rendu public");
  // Depuis le WP15d, le rendu Markdown est partagé par la page article et
  // l'aperçu de l'éditeur : les plugins et les composants vivent dans
  // `MarkdownRenderer`, que la page article consomme.
  const renderer = readSource("src/components/MarkdownRenderer.tsx");
  const articlePage = readSource("src/app/article/[slug]/page.tsx");
  check(
    "plugin remark branche après remark-directive",
    /remarkPlugins=\{\[remarkGfm, remarkDirective, remarkQuotes, remarkSocialEmbeds\]\}/.test(renderer),
  );
  check(
    "la page article utilise le rendu partagé",
    articlePage.includes("<MarkdownRenderer") && !articlePage.includes("markdownComponents"),
  );
  check(
    "composant SocialEmbed branché sur les div marqués",
    renderer.includes("SocialEmbed platform={platform} url={url}"),
  );
  check(
    "plugin remark : directives transformées en div porteurs des attributs",
    readSource("src/lib/remark-social-embeds.ts").includes('hName: "div"'),
  );
  const embedComponent = readSource("src/components/embeds/SocialEmbed.tsx");
  check(
    "Client Component : imports dynamiques sans SSR",
    (embedComponent.match(/ssr: false/g) ?? []).length >= 1 &&
      embedComponent.includes('"use client"'),
  );
  check(
    "thème sombre : fond clair pour les embeds conçus pour le jour",
    embedComponent.includes("LIGHT_CHROME_PLATFORMS") && embedComponent.includes("social-embed--dark"),
  );
  check(
    "repli en carte de lien quand la plateforme n'a pas d'embed",
    embedComponent.includes("SocialEmbedLink"),
  );

  /* ----------------------------------------------------------- 3) éditeur */
  section("Éditeur MDXEditor");
  const editor = readSource("src/components/RichTextEditor.tsx");
  check(
    "directivesPlugin enregistré avec le descripteur social",
    editor.includes("directiveDescriptors: [socialEmbedDescriptor, quoteDescriptor]"),
  );
  check("bouton d'insertion dans la toolbar", editor.includes("<SocialEmbedButton />"));
  check(
    "dialogue : plateforme + adresse + insertion de la directive",
    readSource("src/components/embeds/SocialEmbedButton.tsx").includes("socialDirective(platformId, normalised)"),
  );
  check(
    "directive visible et modifiable dans l'éditeur",
    readSource("src/components/embeds/social-embed-directive.tsx").includes("useMdastNodeUpdater"),
  );
  // L'éditeur est rendu DANS le formulaire de l'article : un <form> imbriqué
  // produit du HTML invalide et une erreur d'hydratation, et un <button> sans
  // type soumet le formulaire par accident.
  const embedSources = [
    readSource("src/components/embeds/SocialEmbedButton.tsx"),
    readSource("src/components/embeds/social-embed-directive.tsx"),
  ];
  // Les commentaires citent la balise : ils sont retirés avant le contrôle.
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(
    "aucun <form> imbriqué dans le dialogue ou la directive",
    embedSources.every((source) => !stripComments(source).includes("<form")),
  );
  check(
    "tous les boutons déclarent leur type",
    embedSources.every((source) => !/<button(?![^>]*\btype=)/.test(stripComments(source))),
  );

  const chunksDir = path.join(ROOT, ".next/static/chunks");
  if (fs.existsSync(chunksDir)) {
    const bundle = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js")) bundle.push(fs.readFileSync(full, "utf8"));
      }
    };
    walk(chunksDir);
    const joined = bundle.join("\n");
    check(
      "bundle client : bouton d'insertion présent",
      joined.includes("Insérer un embed social"),
    );
    check("bundle client : dialogue présent", joined.includes("social-embed-dialog"));
    check("bundle client : carte de repli présente", joined.includes("Voir la publication sur"));
  } else {
    console.log("   (aucun build dans .next : contrôle du bundle ignoré — lancez `npm run build`)");
  }

  /* ------------------------------------------------- 4) rendu réel d'un article */
  section("Rendu d'un article contenant des embeds");
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const slug = `test-embed-wp15c-${Date.now().toString(36)}`;
  const author = (await db.query('SELECT id FROM "Author" ORDER BY "createdAt" LIMIT 1')).rows[0];
  const category = (await db.query('SELECT id FROM "Category" ORDER BY "createdAt" LIMIT 1')).rows[0];
  check("fixture : un auteur et une catégorie existent", Boolean(author && category));

  try {
    await db.query(
      `INSERT INTO "Article" (id, title, slug, content, status, "publishedAt", "authorId", "categoryId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PUBLISHED', now(), $5, $6, now(), now())`,
      [
        `test-embed-${Date.now().toString(36)}`,
        "Test embeds sociaux WP15c",
        slug,
        CONTENT,
        author.id,
        category.id,
      ],
    );

    const response = await fetch(`${BASE}/article/${slug}`, { redirect: "manual" });
    const html = response.status === 200 ? await response.text() : "";
    // Le Markdown brut voyage dans la charge RSC : les contrôles de texte
    // portent sur le HTML visible.
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, "");

    check(`GET /article/${slug}`, response.status === 200, `status=${response.status}`);
    check("embed Instagram rendu", html.includes('data-social-embed="instagram"'));
    check("groupe accessible nommé", html.includes('aria-label="Publication Instagram"'));
    check("fond clair en thème sombre", /class="social-embed social-embed--light"/.test(html));
    check("embed YouTube rendu", html.includes('data-social-embed="youtube"'));
    check(
      "Bluesky : carte de lien au lieu d'un cadre vide",
      visible.includes("social-embed-link") && visible.includes("Bluesky"),
    );
    check(
      "directive valide consommée (aucun texte brut visible)",
      !visible.includes('::social{platform="instagram"'),
    );
    check(
      "adresse hors domaine refusée : directive laissée visible",
      visible.includes("exemple-malveillant.test"),
    );
  } finally {
    await db.query('DELETE FROM "Article" WHERE slug = $1', [slug]);
    const left = await db.query('SELECT count(*)::int AS n FROM "Article" WHERE slug LIKE $1', [
      "test-embed-wp15c-%",
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
