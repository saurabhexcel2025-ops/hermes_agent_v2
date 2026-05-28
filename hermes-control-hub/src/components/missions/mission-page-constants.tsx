"use client";

import type { ReactNode } from "react";
import { Clock, Loader2, CheckCircle2, XCircle } from "lucide-react";

export interface StatusConfig {
  dot: "online" | "warning" | "error" | "idle";
  bg: string;
  text: string;
  icon: ReactNode;
  columnDot: string;
}

export const STATUS_CONFIG: Record<string, StatusConfig> = {
  draft: {
    dot: "idle",
    bg: "bg-white/5",
    text: "text-white/50",
    icon: <Clock className="w-3.5 h-3.5 text-white/40" />,
    columnDot: "bg-white/30",
  },
  queued: {
    dot: "warning",
    bg: "bg-neon-orange/10",
    text: "text-neon-orange",
    icon: <Clock className="w-3.5 h-3.5 text-neon-orange" />,
    columnDot: "bg-neon-orange",
  },
  dispatched: {
    dot: "online",
    bg: "bg-neon-cyan/10",
    text: "text-neon-cyan",
    icon: <Loader2 className="w-3.5 h-3.5 text-neon-cyan animate-spin" />,
    columnDot: "bg-neon-cyan",
  },
  successful: {
    dot: "online",
    bg: "bg-neon-green/10",
    text: "text-neon-green",
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-neon-green" />,
    columnDot: "bg-neon-green",
  },
  failed: {
    dot: "error",
    bg: "bg-red-500/10",
    text: "text-red-400",
    icon: <XCircle className="w-3.5 h-3.5 text-red-400" />,
    columnDot: "bg-red-400",
  },
};

export const CATEGORY_ACTIVE_CLASSES: Record<string, string> = {
  cyan: "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40",
  purple: "bg-neon-purple/20 text-neon-purple border border-neon-purple/40",
  pink: "bg-neon-pink/20 text-neon-pink border border-neon-pink/40",
  green: "bg-neon-green/20 text-neon-green border border-neon-green/40",
  orange: "bg-neon-orange/20 text-neon-orange border border-neon-orange/40",
};
