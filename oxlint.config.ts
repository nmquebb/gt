import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["react", "react-hooks", "jsx-a11y", "typescript"],
  rules: {
    curly: "error",
    "func-style": [
      "error",
      "declaration",
      { overrides: { namedExports: "declaration" } },
    ],
    "jsx-a11y/alt-text": "error",
    "jsx-a11y/anchor-has-content": "error",
    "jsx-a11y/anchor-is-valid": "error",
    "no-restricted-properties": [
      "error",
      {
        object: "Promise",
        property: "reject",
        message: "Return a Result instead of rejecting a promise.",
      },
    ],
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/rules-of-hooks": "error",
    "typescript/consistent-type-imports": "error",
  },
});
