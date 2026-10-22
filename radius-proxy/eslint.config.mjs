import js from "@eslint/js"
import tseslint from "typescript-eslint"
export default tseslint.config({ ignores: ["dist/**", "node_modules/**"] }, js.configs.recommended, { files: ["public/*.js"], languageOptions: { globals: { document: "readonly", window: "readonly", fetch: "readonly", FormData: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } } }, ...tseslint.configs.recommended, { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }], "no-empty": ["error", { allowEmptyCatch: true }] } })
