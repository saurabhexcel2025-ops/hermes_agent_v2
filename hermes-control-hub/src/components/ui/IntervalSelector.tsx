"use client";

import { useState, useRef, useCallback } from "react";
import { RefreshCw, ChevronDown } from "lucide-react";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { parseCronExpression } from "@/lib/cron-display";

interface IntervalSelectorProps {
  value: string;
  onChange: (interval: string) => void;
  compact?: boolean;
}

// Presets used when the user selects a value via the dropdown.
// These use the "every N" format that the cron API expects.
const PRESETS = [
  { value: "every 1m",  label: "1 minute"  },
  { value: "every 5m",  label: "5 minutes" },
  { value: "every 10m", label: "10 minutes"},
  { value: "every 15m", label: "15 minutes"},
  { value: "every 30m", label: "30 minutes"},
  { value: "every 1h",  label: "1 hour"    },
  { value: "every 2h",  label: "2 hours"   },
  { value: "every 3h",  label: "3 hours"   },
  { value: "every 4h",  label: "4 hours"   },
  { value: "every 8h",  label: "8 hours"   },
  { value: "every 12h", label: "12 hours"  },
  { value: "every 1d",  label: "1 day"     },
  { value: "every 3d",  label: "3 days"    },
  { value: "every 7d",  label: "7 days"    },
];

export default function IntervalSelector({ value, onChange, compact = false }: IntervalSelectorProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const handleClose = useCallback(() => setOpen(false), []);

  // Parse value for display
  const displayLabel = (() => {
    const stripped = value.replace(/^every\s+/i, "");
    const preset = PRESETS.find((p) => p.value === stripped || p.value === value);
    if (preset) return preset.label;
    const cronLabel = parseCronExpression(value);
    if (cronLabel) return cronLabel;
    return stripped || value;
  })();

  const stripped = value.replace(/^every\s+/i, "");
  const activePresetValue = PRESETS.find(
    (p) => p.value === value || p.value === stripped || stripped === p.value
  )?.value;

  if (compact) {
    return (
      <>
        <button
          ref={buttonRef}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-white/60 hover:border-neon-cyan/50 hover:text-neon-cyan transition-colors"
          title={`Interval: ${displayLabel}`}
        >
          <RefreshCw className="w-3 h-3" />
          {displayLabel}
        </button>
        {open && (
          <DropdownMenu
            anchorRef={buttonRef}
            presets={PRESETS}
            activePresetValue={activePresetValue}
            onSelect={(v) => onChange(v)}
            onClose={handleClose}
            width={160}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white hover:border-white/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-neon-cyan" />
          <div className="text-left">
            <div className="font-medium text-sm">Every {displayLabel}</div>
            <div className="text-[10px] text-white/30">Repeat frequency</div>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <DropdownMenu
          anchorRef={buttonRef}
          presets={PRESETS}
          activePresetValue={activePresetValue}
          onSelect={(v) => onChange(v)}
          onClose={handleClose}
          width={220}
        />
      )}
    </>
  );
}
