// ═══════════════════════════════════════════════════════════════
// StatPillSkeleton — Inline skeleton for Dashboard stat pills
// Used by src/app/page.tsx during its own loading state
// ═══════════════════════════════════════════════════════════════

export function StatPillSkeleton() {
  return (
    <div className="rounded-lg border border-white/10 bg-dark-900/50 px-4 py-3 flex items-center gap-3 animate-pulse">
      <div className="w-4 h-4 rounded bg-white/10" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-16 rounded bg-white/10" />
        <div className="h-5 w-20 rounded bg-white/10" />
      </div>
    </div>
  );
}
