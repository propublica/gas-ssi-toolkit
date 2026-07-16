import { defineConfig, globalIgnores } from "eslint/config";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([globalIgnores(["**/dist/", "**/node_modules/", "**/*.js"]), {
    extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),

    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        globals: {
            ...globals.node,
        },

        parser: tsParser,
    },

    rules: {
        "@typescript-eslint/no-unused-vars": ["error", {
            argsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
        }],

        "@typescript-eslint/explicit-function-return-type": "warn",
        "@typescript-eslint/no-explicit-any": "warn",
    },
}, {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/safe-writes.ts"],
    rules: {
        "no-restricted-syntax": ["error", {
            selector:
                "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(setValue|setValues|setRichTextValue|setRichTextValues)$/]",
            message:
                "Raw Sheets write calls are restricted to src/server/safe-writes.ts. Route this write through writeSafeValue/writeSafeValueGrid/writeSafeRichText/writeSafeRichTextGrid. See docs/threat_models/ssi-toolkit-threat-model.md, T6.",
        }],
    },
}]);
