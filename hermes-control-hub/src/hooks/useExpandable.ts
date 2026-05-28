// ═══════════════════════════════════════════════════════════════
// useExpandable — Shared hook for expand/collapse state
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback } from "react";

/**
 * Shared hook for managing expand/collapse state.
 * Returns the expanded state and toggle handler.
 */
export function useExpandable(initialState = false) {
  const [expanded, setExpanded] = useState(initialState);

  const toggle = useCallback((nextState?: boolean) => {
    if (typeof nextState === "boolean") {
      setExpanded(nextState);
    } else {
      setExpanded((prev) => !prev);
    }
  }, []);

  const expand = useCallback(() => {
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
  }, []);

  return { expanded, toggle, expand, collapse };
}
