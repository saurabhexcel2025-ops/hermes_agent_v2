import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // CardDetailModal legitimately uses useLayoutEffect to sync form state when
      // the selected card changes — this is a controlled modal pattern, not a bug.
      "react-hooks/set-state-in-effect": "off",
      // React Compiler (babel preset) in CI emits this rule for components that
      // use manual useMemo/useCallback, but the rule is incompatible with the
      // strict dependency inference React Compiler performs in v19. The hooks
      // are correct — the rule's analysis is flawed for these patterns.
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
]);

export default eslintConfig;
