import { defineConfig } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  lint: {
    plugins: ["oxc", "typescript", "unicorn", "react"],
    categories: {
      correctness: "warn",
    },
    env: {
      builtin: true,
    },
    ignorePatterns: [
      "dist",
      "coverage",
      ".llm/**",
      ".output/**",
      ".remember/**",
      ".vinxi/**",
      "src/routeTree.gen.ts",
    ],
    overrides: [
      {
        files: ["vitest.config.ts"],
        globals: {
          process: "readonly",
        },
      },
      {
        files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
        globals: {
          vi: "readonly",
          expect: "readonly",
          it: "readonly",
          describe: "readonly",
          beforeEach: "readonly",
          afterEach: "readonly",
          beforeAll: "readonly",
          afterAll: "readonly",
        },
        env: {
          node: true,
        },
      },
      {
        files: ["**/*.{ts,tsx}"],
        rules: {
          "no-array-constructor": "error",
          "no-unused-expressions": "error",
          "no-unused-vars": [
            "error",
            {
              varsIgnorePattern: "^([A-Z_]|_)",
              argsIgnorePattern: "^_",
              caughtErrorsIgnorePattern: "^_",
            },
          ],
          eqeqeq: ["error", "smart"],
          "typescript/ban-ts-comment": "error",
          "typescript/no-duplicate-enum-values": "error",
          "typescript/no-empty-object-type": "error",
          "typescript/no-explicit-any": "off",
          "typescript/no-extra-non-null-assertion": "error",
          "typescript/no-misused-new": "error",
          "typescript/no-namespace": "error",
          "typescript/no-non-null-asserted-optional-chain": "error",
          "typescript/no-require-imports": "error",
          "typescript/no-this-alias": "error",
          "typescript/no-unnecessary-type-constraint": "error",
          "typescript/no-unsafe-declaration-merging": "error",
          "typescript/no-unsafe-function-type": "error",
          "typescript/no-wrapper-object-types": "error",
          "typescript/prefer-as-const": "error",
          "typescript/prefer-namespace-keyword": "error",
          "typescript/triple-slash-reference": "error",
        },
        env: {
          es2022: true,
          node: true,
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
  },
  server: {
    // 7526 = "PLAN" on a phone dialpad. Fixed + strictPort so a clash fails loudly
    // instead of silently falling back to a different port.
    port: Number(process.env["PORT"] ?? 7526),
    strictPort: true,
    host: true,
    allowedHosts: process.env["VITE_ALLOWED_HOSTS"]?.split(",").filter(Boolean) ?? [],
    watch: { ignored: ["**/routeTree.gen.ts"] },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
