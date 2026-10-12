import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Scripts Node en CommonJS : require() y est la syntaxe d'import normale.
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // Build de production (distDir, voir next.config.ts) et client Prisma
      // généré : des milliers de fichiers produits, pas du code source.
      ".next-production/**",
      "src/generated/**",
      "backups/**",
      "tmp-results/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
