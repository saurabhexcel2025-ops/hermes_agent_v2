// ═══════════════════════════════════════════════════════════════
// DropdownMenu — Shared preset dropdown rendered via portal
// ═══════════════════════════════════════════════════════════════
//
// Renders above or below the anchor element (auto-positions),
// closes on outside click, and escapes parent overflow: hidden.
//
// Consumers: IntervalSelector, ScheduleSelector

"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

export interface Preset {
  value: string;
  label: string;
}

interface DropdownMenuProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  presets: Preset[];
  activePresetValue: string | undefined;
  onSelect: (value: string) => void;
  onClose: () => void;
  width?: number;
}

export function DropdownMenu({
  anchorRef,
  presets,
  activePresetValue,
  onSelect,
  onClose,
  width = 160,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Auto-position: prefer below, flip above when insufficient space
  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const menuH = Math.min(presets.length * 36 + 16, 288);
    const spaceBelow = window.innerHeight - rect.bottom;

    const top = spaceBelow >= menuH
      ? rect.bottom + 4
      : rect.top - menuH - 4;

    setPos({ top, left: rect.left });
  }, [anchorRef, presets.length]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [anchorRef, onClose]);

  if (typeof document === "undefined" || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-dark-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden"
      style={{ top: pos.top, left: pos.left, width }}
    >
      <div className="max-h-72 overflow-y-auto py-1">
        {presets.map((p) => (
          <button
            key={p.value}
            onClick={() => { onSelect(p.value); onClose(); }}
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
              activePresetValue === p.value
                ? "text-neon-cyan bg-neon-cyan/5"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            }`}
          >
            Every {p.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
