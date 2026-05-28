// ═══════════════════════════════════════════════════════════════
// App Page Shell — consistent page frame (background + optional FX)
// ═══════════════════════════════════════════════════════════════

import type { ReactNode } from "react";

interface AppPageShellProps {
  children: ReactNode;
  /** Adds `.scanlines` overlay (requires parent `relative` for pseudo-element). */
  variant?: "default" | "scanlines";
  className?: string;
}

/**
 * Standard full-height page wrapper: blue-tinted dark base + subtle grid.
 * Prefer this over ad-hoc `min-h-screen bg-dark-950 grid-bg` on new pages.
 */
export default function AppPageShell({
  children,
  variant = "default",
  className = "",
}: AppPageShellProps) {
  const fx = variant === "scanlines" ? "relative scanlines" : "";
  return (
    <div
      className={`min-h-screen bg-dark-950 grid-bg flex flex-col ${fx} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
