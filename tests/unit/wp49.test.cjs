const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, deps = {}, env = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (!(name in deps)) throw Error("Unexpected import " + name);
        return deps[name];
      },
      module: { exports },
      URL,
      Buffer,
      Date,
      process: { env },
      console,
    },
  );
  return exports;
}

const canon = "Une actualité sportive confirmée par la source. ".repeat(12);
const long = "Une actualité sportive documentée et recoupée. ".repeat(120);

function aiRun(payload) {
  let request;
  class OpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: async (input) => {
            request = input;
            return { choices: [{ message: { content: JSON.stringify(payload) } }] };
          },
        },
      };
    }
  }
  const ai = load("src/lib/ai.ts", { openai: { default: OpenAI } }, { DEEPSEEK_API_KEY: "fixture" });
  return { ai, request: () => request };
}

test("WP49 — le format du modèle est normalisé sans forcer FLASH", async () => {
  const cases = [
    ["flash", canon, "FLASH"],
    ["Flash", canon, "FLASH"],
    ["brève", canon, "FLASH"],
    ["analyse", long, "ANALYSIS"],
    ["analysis", long, "ANALYSIS"],
    ["actu", canon, "NEWS"],
    ["NEWS", canon, "NEWS"],
  ];
  for (const [format, content, expected] of cases) {
    const { ai } = aiRun({ title: "Titre", excerpt: "Extrait", content, format });
    const result = await ai.generateArticleFromAlert({
      title: "Titre",
      sourceName: "Source",
      url: "https://example.test/news",
      viralScore: 3,
    });
    assert.equal(result.format, expected, `${format} → ${expected}`);
  }
});

test("WP49 — un FLASH structuré en intertitres devient un NEWS", async () => {
  const content = `Premier paragraphe factuel. ${"Une phrase de contexte. ".repeat(8)}\n\n## Les faits\n\n${"Le club confirme la signature. ".repeat(8)}`;
  const { ai } = aiRun({ title: "Titre", excerpt: "Extrait", content, format: "FLASH" });
  const result = await ai.generateArticleFromAlert({
    title: "Titre",
    sourceName: "Source",
    url: "https://example.test/news",
  });
  assert.equal(result.format, "NEWS");
});

test("WP49 — sans format, la structure du texte décide", async () => {
  const short = aiRun({ title: "Titre", excerpt: "Extrait", content: canon });
  assert.equal(
    (await short.ai.generateArticleFromAlert({ title: "T", sourceName: "S", url: "https://e.test" })).format,
    "FLASH",
  );
  const headings = `Chapô factuel. ${"Une phrase de contexte. ".repeat(10)}\n\n## Contexte\n\n${"Un paragraphe documenté. ".repeat(80)}\n\n## Enjeux\n\n${"Une mise en perspective. ".repeat(80)}`;
  const structured = aiRun({ title: "Titre", excerpt: "Extrait", content: headings });
  assert.equal(
    (await structured.ai.generateArticleFromAlert({ title: "T", sourceName: "S", url: "https://e.test" })).format,
    "ANALYSIS",
  );
});

test("WP49 — le prompt reçoit tous les éléments de la veille et dissocie score et format", async () => {
  const { ai, request } = aiRun({
    title: "Titre",
    excerpt: "Extrait",
    content: canon,
    format: "NEWS",
  });
  await ai.generateArticleFromAlert({
    title: "Titre original",
    titleFr: "Titre français",
    content: "Extrait source",
    url: "https://example.test/news",
    sourceName: "Média",
    publishedAt: new Date("2026-10-26T10:00:00Z"),
    viralScore: 3,
    imageCredit: "Photo Média",
    imageLicensed: false,
    isOfficial: true,
    categories: [{ slug: "football", name: "Football" }],
    themes: [{ slug: "mercato", name: "Mercato" }],
  });
  const system = request().messages[0].content;
  const user = request().messages[1].content;
  assert.match(system, /Un score de viralité élevé ne justifie jamais un FLASH/);
  assert.match(user, /Titre original : Titre original/);
  assert.match(user, /Titre français : Titre français/);
  assert.match(user, /Score de viralité : 3\/5/);
  assert.match(user, /Crédit visuel fourni par la source : Photo Média/);
  assert.match(user, /Droit de reprise du visuel : référence seule/);
  assert.match(user, /source officielle/);
  assert.match(user, /"slug":"mercato"/);
});

test("WP49 — le titre d'origine reste transmis quand un titre FR existe", async () => {
  const { ai, request } = aiRun({
    title: "Titre",
    excerpt: "Extrait",
    content: canon,
    format: "NEWS",
  });
  await ai.generateArticleFromAlert({
    title: "Titre français",
    originalTitle: "Original headline",
    titleFr: "Titre français",
    sourceName: "Média",
    url: "https://example.test/news",
  });
  const user = request().messages[1].content;
  assert.match(user, /Titre original : Original headline/);
  assert.match(user, /Titre français : Titre français/);
});

test("WP49 — publication sans visuel : réservée à la veille et confirmée", async () => {
  const { canPublishWithoutCover } = load("src/lib/publish-policy.ts");
  assert.equal(canPublishWithoutCover({ status: "PUBLISHED", coverImageUrl: null, confirmed: true, isVeille: true }), true);
  assert.equal(canPublishWithoutCover({ status: "PUBLISHED", coverImageUrl: null, confirmed: false, isVeille: true }), false);
  assert.equal(canPublishWithoutCover({ status: "PUBLISHED", coverImageUrl: null, confirmed: true, isVeille: false }), false);
  assert.equal(canPublishWithoutCover({ status: "DRAFT", coverImageUrl: null, confirmed: true, isVeille: true }), false);
  assert.equal(canPublishWithoutCover({ status: "PUBLISHED", coverImageUrl: "/uploads/x.jpg", confirmed: true, isVeille: true }), false);
});
