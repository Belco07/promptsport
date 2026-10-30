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

test("WP49 — publication sans visuel : réservée à la veille et confirmée", async () => {
  const { canPublishWithoutCover } = load("src/lib/publish-policy.ts");
  assert.equal(canPublishWithoutCover({ status: "PUBLISHED", coverImageUrl: null, confirmed: true, isVeille: true }), true);
  assert.equal(canPublishWithoutCover({ status: "PUBLISHED", coverImageUrl: null, confirmed: false, isVeille: true }), false);
  assert.equal(canPublishWithoutCover({ status: "PUBLISHED", coverImageUrl: null, confirmed: true, isVeille: false }), false);
  assert.equal(canPublishWithoutCover({ status: "DRAFT", coverImageUrl: null, confirmed: true, isVeille: true }), false);
  assert.equal(canPublishWithoutCover({ status: "PUBLISHED", coverImageUrl: "/uploads/x.jpg", confirmed: true, isVeille: true }), false);
});
