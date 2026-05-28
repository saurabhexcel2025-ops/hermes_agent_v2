// ═══════════════════════════════════════════════════════════════
// CredentialPicker — choose an existing credential or "Create new"
// ═══════════════════════════════════════════════════════════════
//
// Used inside ModelEditor to attach a stored credential row to a
// model. Filtering by provider keeps the dropdown sensible.
//
// Two-mode interaction:
//   - "use existing"  → emit credentialsId, hide API key input
//   - "create new"    → caller renders an inline API key input and
//                        creates the credential before saving the model
//
// API key is NEVER edited or echoed here.

"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";

export interface CredentialOption {
  id: string;
  label: string;
  provider: string;
  keyHint: string;
}

interface CredentialPickerProps {
  credentials: CredentialOption[];
  selected: string | null;
  /** When `null`, the caller is adding a new credential. */
  onChange: (credentialId: string | null) => void;
  /** Restrict listing to a single provider (model.provider). */
  providerFilter?: string;
  disabled?: boolean;
}

const NEW_CREDENTIAL = "__new__";

export default function CredentialPicker({
  credentials,
  selected,
  onChange,
  providerFilter,
  disabled = false,
}: CredentialPickerProps) {
  const selectId = useId();
  const filtered = providerFilter
    ? credentials.filter((c) => c.provider === providerFilter)
    : credentials;

  const value = selected ?? NEW_CREDENTIAL;

  return (
    <div className="space-y-1.5">
      <label htmlFor={selectId} className="text-sm font-medium text-white/70">
        Credential
      </label>
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === NEW_CREDENTIAL ? null : v);
          }}
          disabled={disabled}
          className="w-full bg-dark-900/50 border border-white/10 rounded-lg px-3 py-2 pr-8 text-sm text-white outline-none transition-colors font-mono appearance-none cursor-pointer focus:border-neon-purple/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <option value={NEW_CREDENTIAL} className="bg-dark-900">
            + Create new credential
          </option>
          {filtered.map((c) => (
            <option key={c.id} value={c.id} className="bg-dark-900">
              {c.label} ({c.keyHint || "no hint"})
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
      </div>
      <p className="text-xs text-white/30 font-mono">
        {selected
          ? "Reusing an existing credential row from the registry."
          : "A new credential will be created and stored alongside this model."}
      </p>
    </div>
  );
}

CredentialPicker.NEW_CREDENTIAL = NEW_CREDENTIAL;
