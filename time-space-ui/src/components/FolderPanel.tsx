import { useRef, useEffect } from "react";
import { useLocalFolders } from "../hooks/useLocalFolders";
import { useRemoteProjects } from "../hooks/useRemoteProjects";
import { DatabaseBrowser } from "./DatabaseBrowser";

// Type definitions for folder/plan structure
export type Plan = {
  id: string;
  name: string;
  data: any; // Junction configuration data
  createdAt: number;
  modifiedAt: number;
};

export type Folder = {
  id: string;
  name: string;
  plans: Plan[];
  expanded: boolean;
};

export type FolderStructure = {
  folders: Folder[];
};

type FolderPanelProps = {
  isOpen: boolean;
  onToggle: () => void;
  currentData: any; // Current junction configuration
  onLoadPlan: (planData: any) => void;
  onSaveSuccess?: (planName: string) => void; // Callback when save succeeds
  onPlanOpen?: (folderName: string, planName: string) => void; // Breadcrumb update
  onNewPlan?: (folderId: string) => void; // Open junction setup wizard for this folder
  onRegisterAddPlan?: (fn: (folderId: string, planData: any, planName: string) => void) => void;
  hasUnsavedChanges: boolean;
  hideToggleButton?: boolean;
  initialFolders?: Folder[];
  initialActivePlan?: { folderId: string; planId: string };
};

export default function FolderPanel({
  isOpen,
  onToggle,
  currentData,
  onLoadPlan,
  onSaveSuccess,
  onPlanOpen,
  onNewPlan,
  onRegisterAddPlan,
  hasUnsavedChanges,
  hideToggleButton = false,
  initialFolders,
  initialActivePlan,
}: FolderPanelProps) {
  const {
    folders, setFolders,
    editingId, setEditingId,
    editingName, setEditingName,
    confirmDialog, setConfirmDialog,
    activePlan, setActivePlan,
    saveAsDialog, setSaveAsDialog,
    exportDialog, setExportDialog,
    createFolder, deleteFolder, renameFolder, toggleFolder,
    createPlan, deletePlan, renamePlan, updateCurrentPlan,
    handleSave, handleSaveAs, confirmSaveAs, loadPlan, confirmLoadPlan,
    handleDragStart, handleDragOver, handleDrop,
    handleExportFile, handleExportAll, confirmExport, importFromJSON,
  } = useLocalFolders({
    currentData, onLoadPlan, onSaveSuccess, onPlanOpen, onRegisterAddPlan,
    hasUnsavedChanges, initialFolders, initialActivePlan,
  });

  const handleTimingLoaded = (planData: any, planName: string) => {
    // Create a new plan with the loaded data
    const targetFolder = folders[0];
    if (targetFolder) {
      const newPlan: Plan = {
        id: crypto.randomUUID(),
        name: planName,
        data: planData,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      };
      setFolders(
        folders.map((ff) =>
          ff.id === targetFolder.id
            ? { ...ff, plans: [...ff.plans, newPlan], expanded: true }
            : ff
        )
      );
      setActivePlan({ folderId: targetFolder.id, planId: newPlan.id });
    }
    // Load the data into the GUI
    onLoadPlan(planData);
    if (onSaveSuccess) {
      onSaveSuccess(`Loaded: ${planName}`);
    }
  };

  const db = useRemoteProjects({ isOpen, onTimingLoaded: handleTimingLoaded });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Click outside to close panel
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        // Don't close if clicking on dialogs
        !saveAsDialog.show &&
        !confirmDialog.show &&
        !exportDialog.show
      ) {
        onToggle();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onToggle, saveAsDialog.show, confirmDialog.show, exportDialog.show]);

  // ========== Render ==========

  return (
    <>
      {/* Save As Dialog */}
      {saveAsDialog.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-neutral-800 p-6 rounded-lg shadow-lg max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Save As</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Folder</label>
                <select
                  value={saveAsDialog.folderId}
                  onChange={(e) => setSaveAsDialog({ ...saveAsDialog, folderId: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900"
                >
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Plan Name</label>
                <input
                  type="text"
                  value={saveAsDialog.planName}
                  onChange={(e) => setSaveAsDialog({ ...saveAsDialog, planName: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900"
                  placeholder="Enter plan name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmSaveAs();
                    if (e.key === "Escape") setSaveAsDialog({ show: false, folderId: "", planName: "" });
                  }}
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setSaveAsDialog({ show: false, folderId: "", planName: "" })}
                className="px-4 py-2 rounded border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={confirmSaveAs}
                className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-neutral-800 p-6 rounded-lg shadow-lg max-w-md">
            <h3 className="text-lg font-semibold mb-4">Unsaved Changes</h3>
            <p className="text-sm mb-6">
              You have unsaved changes. What would you like to do?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDialog({ show: false, planData: null })}
                className="px-4 py-2 rounded border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Cancel
              </button>
              {activePlan && (
                <button
                  onClick={() => confirmLoadPlan(true)}
                  className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Save & Load
                </button>
              )}
              <button
                onClick={() => confirmLoadPlan(false)}
                className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
              >
                Discard & Load
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Download/Backup Confirmation Dialog */}
      {exportDialog.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-neutral-800 p-6 rounded-lg shadow-lg max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              Save Before {exportDialog.type === "file" ? "Download" : "Backup"}?
            </h3>
            <p className="text-sm mb-6">
              You have unsaved changes. Would you like to save before {exportDialog.type === "file" ? "downloading" : "backing up"}?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setExportDialog({ show: false, type: "file" })}
                className="px-4 py-2 rounded border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmExport(false)}
                className="px-4 py-2 rounded border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                {exportDialog.type === "file" ? "Download" : "Backup"} Without Saving
              </button>
              <button
                onClick={() => confirmExport(true)}
                className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Save & {exportDialog.type === "file" ? "Download" : "Backup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Side Panel */}
      <div
        ref={panelRef}
        data-tour="folder-panel"
        className={`fixed top-0 right-0 h-full bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800 transition-transform duration-300 z-40 ${
          isOpen ? "translate-x-0 shadow-xl pointer-events-auto" : "translate-x-full pointer-events-none"
        }`}
        style={{ width: "320px" }}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div data-tour="folder-panel-header" className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
            <h2 className="text-lg font-semibold">Projects</h2>
            <button
              onClick={onToggle}
              className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
              title="Close panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto min-h-0">

          {/* Save/Save As */}
          <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50">
            <div className="flex gap-2 mb-2">
              <button
                data-tour="save-button"
                onClick={handleSave}
                disabled={!hasUnsavedChanges}
                className={`flex-1 px-3 py-2 text-sm rounded font-medium transition-colors ${
                  hasUnsavedChanges
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-neutral-300 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 cursor-not-allowed"
                }`}
                title={activePlan ? "Save to current plan" : "No active plan - will open Save As dialog"}
              >
                {activePlan ? "💾 Save" : "💾 Save As..."}
              </button>
              <button
                data-tour="save-as-button"
                onClick={handleSaveAs}
                className="flex-1 px-3 py-2 text-sm rounded border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                title="Save as new plan"
              >
                Save As...
              </button>
            </div>
            {activePlan && (
              <div className="text-xs text-neutral-500 dark:text-neutral-300 text-center">
                Active: {folders.find(f => f.id === activePlan.folderId)?.plans.find(p => p.id === activePlan.planId)?.name || "Unknown"}
              </div>
            )}
          </div>

          {/* Download/Import */}
          <div className="p-3 border-b border-neutral-200 dark:border-neutral-800">
            <div className="flex gap-2 mb-2">
              <button
                data-tour="download-button"
                onClick={handleExportFile}
                className="flex-1 px-3 py-1.5 text-xs rounded bg-neutral-900 dark:bg-neutral-200 text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-300"
                title="Download current junction configuration"
              >
                ↓ Download
              </button>
              <button
                data-tour="import-button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 px-3 py-1.5 text-xs rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title="Import a configuration file"
              >
                ↑ Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={importFromJSON}
              />
            </div>
            <button
              data-tour="backup-button"
              onClick={handleExportAll}
              className="w-full px-3 py-1 text-[11px] rounded text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300"
              title="Download all folders and plans as backup"
            >
              📦 Backup Workspace
            </button>
          </div>

          {/* Load from Database */}
          <DatabaseBrowser db={db} />

          {/* Folder List */}
          <div className="p-3">
            <div className="mb-2">
              <button
                onClick={createFolder}
                className="w-full px-3 py-2 text-sm rounded border border-dashed border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                + New Folder
              </button>
            </div>

            {folders.map((folder) => (
              <div
                key={folder.id}
                className="mb-2 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden"
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(folder.id)}
              >
                {/* Folder Header */}
                <div className="bg-neutral-100 dark:bg-neutral-800 p-2 flex items-center gap-2">
                  <button
                    onClick={() => toggleFolder(folder.id)}
                    className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${folder.expanded ? "rotate-90" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {editingId === folder.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => renameFolder(folder.id, editingName)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameFolder(folder.id, editingName);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 px-2 py-1 text-sm rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="flex-1 text-sm font-medium cursor-pointer"
                      onDoubleClick={() => {
                        setEditingId(folder.id);
                        setEditingName(folder.name);
                      }}
                    >
                      {folder.name}
                    </span>
                  )}

                  <button
                    onClick={() => onNewPlan ? onNewPlan(folder.id) : createPlan(folder.id)}
                    className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                    title="Add plan"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>

                  <button
                    onClick={() => deleteFolder(folder.id)}
                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded"
                    title="Delete folder"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>

                {/* Plans List */}
                {folder.expanded && (
                  <div className="p-2 space-y-1">
                    {folder.plans.length === 0 ? (
                      <div className="text-xs text-neutral-400 dark:text-neutral-300 italic p-2 text-center">
                        No plans yet
                      </div>
                    ) : (
                      folder.plans.map((plan) => {
                        const isActive = activePlan?.folderId === folder.id && activePlan?.planId === plan.id;
                        return (
                        <div
                          key={plan.id}
                          draggable
                          onDragStart={() => handleDragStart(folder.id, plan.id)}
                          className={`group flex items-center gap-2 p-2 rounded cursor-move ${
                            isActive
                              ? "bg-sky-100 dark:bg-sky-900/30 border border-sky-300 dark:border-sky-700"
                              : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          }`}
                        >
                          {editingId === plan.id ? (
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={() => renamePlan(folder.id, plan.id, editingName)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") renamePlan(folder.id, plan.id, editingName);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              className="flex-1 px-2 py-1 text-xs rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900"
                              autoFocus
                            />
                          ) : (
                            <span
                              className={`flex-1 text-xs cursor-pointer ${isActive ? "font-medium" : ""}`}
                              onDoubleClick={() => loadPlan(plan.data, folder.id, plan.id)}
                              title="Double-click to load"
                            >
                              {plan.name}
                              {isActive && (
                                <span className={`ml-1 ${hasUnsavedChanges ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>●</span>
                              )}
                            </span>
                          )}

                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setEditingId(plan.id);
                                setEditingName(plan.name);
                              }}
                              className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                              title="Rename"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => updateCurrentPlan(folder.id, plan.id)}
                              className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                              title="Update with current data"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => deletePlan(folder.id, plan.id)}
                              className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded"
                              title="Delete"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          </div>{/* End scrollable content area */}
        </div>
      </div>

      {/* Toggle Button (when panel is closed) */}
      {!isOpen && !hideToggleButton && (
        <button
          onClick={onToggle}
          className="fixed top-4 right-4 p-2 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 z-30"
          title="Open projects panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>
      )}
    </>
  );
}
