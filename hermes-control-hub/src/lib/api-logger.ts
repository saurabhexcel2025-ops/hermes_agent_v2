// ═══════════════════════════════════════════════════════════════
// API Logger — consistent error logging for API routes
// ═══════════════════════════════════════════════════════════════

/**
 * Log an API error with context. Use in catch blocks instead of
 * empty `catch {}` to ensure errors are visible during debugging.
 *
 * @param route - API route name (e.g., "GET /api/cron")
 * @param context - What was being done (e.g., "reading jobs.json")
 * @param error - The caught error
 */
export function logApiError(route: string, context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[API ${route}] Error ${context}: ${message}`);
}
