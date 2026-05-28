"use client";

import { Settings } from "lucide-react";

import DefaultsGrid from "@/components/models/DefaultsGrid";
import type { DefaultsModelOption } from "@/components/models/DefaultsGrid";
import type { TaskType } from "@/lib/hermes-providers";

interface ModelsTaskDefaultsSectionProps {
  defaults: Record<TaskType, string | null>;
  modelOptions: DefaultsModelOption[];
  busyTaskType: TaskType | null;
  onChange: (taskType: TaskType, modelId: string | null) => Promise<void>;
  onSetAllAux: (taskTypes: TaskType[], targetModelId: string) => Promise<void>;
}

export default function ModelsTaskDefaultsSection({
  defaults,
  modelOptions,
  busyTaskType,
  onChange,
  onSetAllAux,
}: ModelsTaskDefaultsSectionProps) {
  return (
    <section data-section="defaults" className="space-y-4">
      <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider flex items-center gap-2">
        <Settings className="w-4 h-4 text-neon-purple/60" />
        Task Defaults
      </h2>
      <DefaultsGrid
        defaults={defaults}
        models={modelOptions}
        onChange={onChange}
        onSetAllAux={onSetAllAux}
        busyTaskType={busyTaskType}
      />
    </section>
  );
}
