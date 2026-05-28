import { z } from "zod";

/** Whitelisted fields for fallback behaviour config (SQLite + Hermes agent.*). */
export const fallbackConfigPutSchema = z.object({
  restorePrimaryOnFallback: z.boolean().optional(),
  fallbackNotification: z.boolean().optional(),
  apiMaxRetries: z.number().int().min(0).max(10).optional(),
});

export const fallbackSyncPostSchema = z.object({
  config: fallbackConfigPutSchema.optional(),
});

export type FallbackConfigPutInput = z.infer<typeof fallbackConfigPutSchema>;
