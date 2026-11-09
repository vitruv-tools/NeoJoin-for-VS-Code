/**
 * ESLint configuration for the project.
 *
 * Code quality only. The formatting (indentation, quotes, commas, line breaks) is checked by Prettier, see package.json
 * (script format:check) and .editorconfig. See https://typescript-eslint.io for additional linting options.
 */
// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["**/out", "dist"],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,
    {
        rules: {
            curly: "warn",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/naming-convention": [
                "warn",
                {
                    selector: "import",
                    format: ["camelCase", "PascalCase"],
                },
            ],
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
    {
        files: ["**/*.cjs"],
        languageOptions: {
            globals: globals.node,
        },
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    }
);
