// ═══════════════════════════════════════════════════════════════
// TypingIndicator — Animated "thinking" indicator for chat
// ═══════════════════════════════════════════════════════════════

"use client";

import { Bot } from "lucide-react";

export default function TypingIndicator() {
  return (
    <div className="flex gap-3 justify-start">
      <div className="w-8 h-8 rounded-lg bg-neon-purple/20 border border-neon-purple/30 flex items-center justify-center shrink-0 mt-1">
        <Bot className="w-4 h-4 text-neon-purple" />
      </div>
      <div className="max-w-[70%] rounded-xl px-4 py-3 bg-white/5 border border-white/10">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}
