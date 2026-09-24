import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(js.configs.recommended, ...ts.configs.recommended, {
  files: ["**/*.ts"],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    // Event-handler signatures often require named params the handler ignores;
    // the _ prefix is the repo's convention for intentionally-unused args.
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
});
