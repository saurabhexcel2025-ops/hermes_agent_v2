// ═══════════════════════════════════════════════════════════════
// /config/models — registry-backed model + credentials manager
// ═══════════════════════════════════════════════════════════════
//
// Replaces the legacy YAML-direct /config/model editor (deleted in PR 4).
// Two sections:
//   1. My Models  — table of registry rows + Add Model action
//   2. Defaults   — 12-slot grid driving model.* + auxiliary.<task>.*
//                   in ~/.hermes/config.yaml via PR 5's write-through.

"use client";

import { Globe, Loader2, Plus, RefreshCw } from "lucide-react";

import AppPageShell from "@/components/layout/AppPageShell";
import PageHeader from "@/components/layout/PageHeader";
import Button from "@/components/ui/Button";
import { LoadingSpinner, ErrorBanner } from "@/components/ui/LoadingSpinner";
import ModelEditor from "@/components/models/ModelEditor";

import ModelsAgentDefaultSection from "@/components/models/ModelsAgentDefaultSection";
import ModelsDriftBanner from "@/components/models/ModelsDriftBanner";
import ModelsFallbackSection from "@/components/models/ModelsFallbackSection";
import ModelsTableSection from "@/components/models/ModelsTableSection";
import ModelsTaskDefaultsSection from "@/components/models/ModelsTaskDefaultsSection";
import { useModelsPage } from "@/hooks/useModelsPage";

export default function ModelsPage() {
  const {
    models,
    credentials,
    modelOptions,
    credentialOptions,
    defaults,
    loading,
    error,
    drift,
    refreshing,
    busyTaskType,
    fallbackChain,
    fallbackConfig,
    handleFallbackConfigChange,
    fallbackConfigSaving,
    fallbackConfigDirty,
    fallbackConfigError,
    syncingFallback,
    importingFallback,
    editing,
    setEditing,
    editingFallbackEntry,
    editingFallbackUrl,
    setEditingFallbackUrl,
    savingFallbackUrl,
    toastElement,
    handleRefresh,
    handlePush,
    handlePull,
    handleSaved,
    handleDelete,
    handleSetDefault,
    handleBulkAuxiliaryChange,
    handleFallbackReorder,
    handleFallbackToggle,
    handleFallbackDelete,
    handleFallbackEdit,
    handleFallbackEditSave,
    handleFallbackAddFromRegistry,
    handleFallbackAddCustom,
    handleSyncFallbackToHermes,
    handleImportFallbackFromConfig,
    setEditingFallbackEntry,
  } = useModelsPage();

  return (
    <AppPageShell>
      <PageHeader
        icon={Globe}
        title="Models"
        subtitle={`${models.length} model${models.length === 1 ? "" : "s"} in registry · ${credentials.length} credential${credentials.length === 1 ? "" : "s"}`}
        color="purple"
        backHref="/config"
        backLabel="CONFIG"
        actions={
          <>
            <Button
              variant="secondary"
              color="purple"
              icon={refreshing ? Loader2 : RefreshCw}
              onClick={handleRefresh}
              disabled={refreshing}
              title="Sync models from ~/.hermes/config.yaml and ~/.hermes/.env"
            >
              {refreshing ? "Refreshing…" : "Refresh Models"}
            </Button>
            <Button
              variant="primary"
              color="purple"
              icon={Plus}
              onClick={() => setEditing(null)}
            >
              Add Model
            </Button>

          </>
        }
      />

      <div className="max-w-6xl mx-auto px-6 py-6 w-full flex-1 space-y-10">
        <p className="text-xs text-white/40 font-mono border border-white/10 rounded-lg p-3 bg-dark-900/50">
          Control Hub stores mission defaults and the model registry here. Hermes chat/gateway
          runtime defaults live in each profile&apos;s <strong className="text-white/60">config.yaml</strong>{" "}
          (imported via Operations → Agents pull, or <code className="text-white/50">hermes model</code>).
          Seeds never set <code className="text-white/50">model.default</code>.
        </p>
        {error && <ErrorBanner message={error} />}

        {drift && <ModelsDriftBanner drift={drift} onSyncNow={handleRefresh} />}

        {loading ? (
          <LoadingSpinner text="Loading models..." />
        ) : (
          <>
            <ModelsTableSection
              models={models}
              defaults={defaults}
              busyTaskType={busyTaskType}
              onAddModel={() => setEditing(null)}
              onEdit={setEditing}
              onDelete={handleDelete}
              onPush={handlePush}
              onPull={handlePull}
            />

            <ModelsAgentDefaultSection
              models={models}
              modelOptions={modelOptions}
              defaults={defaults}
              busyTaskType={busyTaskType}
              onBulkAuxiliaryChange={handleBulkAuxiliaryChange}
              onSetDefault={handleSetDefault}
            />

            <ModelsFallbackSection
              fallbackChain={fallbackChain}
              fallbackConfig={fallbackConfig}
              modelOptions={modelOptions}
              busyTaskType={busyTaskType}
              syncingFallback={syncingFallback}
              importingFallback={importingFallback}
              editingFallbackEntry={editingFallbackEntry}
              editingFallbackUrl={editingFallbackUrl}
              savingFallbackUrl={savingFallbackUrl}
              onFallbackConfigChange={handleFallbackConfigChange}
              fallbackConfigSaving={fallbackConfigSaving}
              fallbackConfigDirty={fallbackConfigDirty}
              fallbackConfigError={fallbackConfigError}
              onReorder={handleFallbackReorder}
              onToggle={handleFallbackToggle}
              onDelete={handleFallbackDelete}
              onEdit={handleFallbackEdit}
              onAddFromRegistry={handleFallbackAddFromRegistry}
              onAddCustom={handleFallbackAddCustom}
              onSyncToHermes={handleSyncFallbackToHermes}
              onImportFromConfig={handleImportFallbackFromConfig}
              onFallbackUrlChange={setEditingFallbackUrl}
              onCloseFallbackModal={() => setEditingFallbackEntry(null)}
              onSaveFallbackUrl={handleFallbackEditSave}
            />

            <ModelsTaskDefaultsSection
              defaults={defaults}
              modelOptions={modelOptions}
              busyTaskType={busyTaskType}
              onChange={handleSetDefault}
              onSetAllAux={handleBulkAuxiliaryChange}
            />

          </>
        )}
      </div>

      {editing !== undefined && (
        <ModelEditor
          model={editing}
          credentials={credentialOptions}
          onClose={() => setEditing(undefined)}
          onSaved={handleSaved}
        />
      )}

      {toastElement}
    </AppPageShell>
  );
}
