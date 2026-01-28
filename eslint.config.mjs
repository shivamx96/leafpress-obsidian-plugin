import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**", "*.mjs"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        setInterval: "readonly",
        window: "readonly",
        document: "readonly",
        require: "readonly",
        module: "readonly",
        navigator: "readonly",
        NodeJS: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
]);
