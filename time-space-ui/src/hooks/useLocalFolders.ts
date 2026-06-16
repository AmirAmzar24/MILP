import React, { useState } from "react";
import type { Folder, Plan, FolderStructure } from "../components/FolderPanel";

// Security constants
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Sanitize filename to prevent XSS and path traversal
 * Only allows alphanumeric, spaces, hyphens, underscores, and dots
 */
function sanitizeFilename(filename: string): string {
  // Remove .json extension first
  let name = filename.replace(/\.json$/i, "");
  // Remove any path components (prevent path traversal)
  name = name.replace(/^.*[/\\]/, "");
  // Only allow safe characters
  name = name.replace(/[^a-zA-Z0-9\s\-_.]/g, "");
  // Trim and limit length
  name = name.trim().slice(0, 100);
  // Default name if empty
  return name || "Imported Plan";
}

export interface UseLocalFoldersArgs {
  currentData: any;
  onLoadPlan: (planData: any) => void;
  onSaveSuccess?: (planName: string) => void;
  onPlanOpen?: (folderName: string, planName: string) => void;
  onRegisterAddPlan?: (fn: (folderId: string, planData: any, planName: string) => void) => void;
  hasUnsavedChanges: boolean;
  initialFolders?: Folder[];
  initialActivePlan?: { folderId: string; planId: string };
}

/**
 * Owns the local folder/plan workspace state and all its CRUD, drag-and-drop,
 * and import/export operations. Extracted from FolderPanel.tsx (Phase 8a).
 */
export function useLocalFolders({
  currentData,
  onLoadPlan,
  onSaveSuccess,
  onPlanOpen,
  onRegisterAddPlan,
  hasUnsavedChanges,
  initialFolders,
  initialActivePlan,
}: UseLocalFoldersArgs) {
  const [folders, setFolders] = useState<Folder[]>(() =>
    initialFolders ?? [
      {
        id: crypto.randomUUID(),
        name: "Folder1",
        plans: [],
        expanded: true,
      },
    ]
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [draggedPlan, setDraggedPlan] = useState<{ folderId: string; planId: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    planData: any;
    targetFolderId?: string;
    targetPlanId?: string;
  }>({ show: false, planData: null });
  const [activePlan, setActivePlan] = useState<{ folderId: string; planId: string } | null>(
    initialActivePlan ?? null
  );
  const [saveAsDialog, setSaveAsDialog] = useState<{
    show: boolean;
    folderId: string;
    planName: string;
  }>({ show: false, folderId: "", planName: "" });
  const [exportDialog, setExportDialog] = useState<{
    show: boolean;
    type: "file" | "all";
  }>({ show: false, type: "file" });

  const createFolder = () => {
    const newFolder: Folder = {
      id: crypto.randomUUID(),
      name: `Folder${folders.length + 1}`,
      plans: [],
      expanded: true,
    };
    setFolders([...folders, newFolder]);
  };

  const deleteFolder = (folderId: string) => {
    if (confirm("Delete this folder and all its plans?")) {
      setFolders(folders.filter((f) => f.id !== folderId));
    }
  };

  const renameFolder = (folderId: string, newName: string) => {
    setFolders(
      folders.map((f) =>
        f.id === folderId ? { ...f, name: newName.trim() || f.name } : f
      )
    );
    setEditingId(null);
  };

  const toggleFolder = (folderId: string) => {
    setFolders(
      folders.map((f) =>
        f.id === folderId ? { ...f, expanded: !f.expanded } : f
      )
    );
  };

  // ========== Plan Operations ==========

  const createPlan = (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;

    const newPlan: Plan = {
      id: crypto.randomUUID(),
      name: `Plan${folder.plans.length + 1}`,
      data: currentData,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };

    setFolders(
      folders.map((f) =>
        f.id === folderId
          ? { ...f, plans: [...f.plans, newPlan] }
          : f
      )
    );
  };

  const addPlanToFolder = React.useCallback((folderId: string, planData: any, planName: string) => {
    const newPlan: Plan = {
      id: crypto.randomUUID(),
      name: planName,
      data: planData,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };
    setFolders(prev => prev.map(f =>
      f.id === folderId ? { ...f, plans: [...f.plans, newPlan] } : f
    ));
    setActivePlan({ folderId, planId: newPlan.id });
  }, []);

  React.useEffect(() => {
    if (onRegisterAddPlan) onRegisterAddPlan(addPlanToFolder);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deletePlan = (folderId: string, planId: string) => {
    if (confirm("Delete this plan?")) {
      setFolders(
        folders.map((f) =>
          f.id === folderId
            ? { ...f, plans: f.plans.filter((p) => p.id !== planId) }
            : f
        )
      );
    }
  };

  const renamePlan = (folderId: string, planId: string, newName: string) => {
    setFolders(
      folders.map((f) =>
        f.id === folderId
          ? {
              ...f,
              plans: f.plans.map((p) =>
                p.id === planId
                  ? { ...p, name: newName.trim() || p.name, modifiedAt: Date.now() }
                  : p
              ),
            }
          : f
      )
    );
    setEditingId(null);
  };

  const updateCurrentPlan = (folderId: string, planId: string) => {
    setFolders(
      folders.map((f) =>
        f.id === folderId
          ? {
              ...f,
              plans: f.plans.map((p) =>
                p.id === planId
                  ? { ...p, data: currentData, modifiedAt: Date.now() }
                  : p
              ),
            }
          : f
      )
    );
  };

  const handleSave = () => {
    if (!activePlan) {
      // No active plan, open Save As dialog
      handleSaveAs();
      return;
    }

    // Update the active plan with current data
    updateCurrentPlan(activePlan.folderId, activePlan.planId);

    // Notify success
    if (onSaveSuccess) {
      const folder = folders.find((f) => f.id === activePlan.folderId);
      const plan = folder?.plans.find((p) => p.id === activePlan.planId);
      if (plan) {
        onSaveSuccess(plan.name);
      }
    }
  };

  const handleSaveAs = () => {
    const firstFolder = folders[0];
    setSaveAsDialog({
      show: true,
      folderId: firstFolder?.id || "",
      planName: `Plan${Date.now()}`,
    });
  };

  const confirmSaveAs = () => {
    if (!saveAsDialog.folderId || !saveAsDialog.planName.trim()) {
      alert("Please select a folder and enter a plan name");
      return;
    }

    const folder = folders.find((f) => f.id === saveAsDialog.folderId);
    if (!folder) return;

    const newPlan: Plan = {
      id: crypto.randomUUID(),
      name: saveAsDialog.planName.trim(),
      data: currentData,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };

    setFolders(
      folders.map((f) =>
        f.id === saveAsDialog.folderId
          ? { ...f, plans: [...f.plans, newPlan] }
          : f
      )
    );

    setActivePlan({ folderId: saveAsDialog.folderId, planId: newPlan.id });
    setSaveAsDialog({ show: false, folderId: "", planName: "" });

    // Notify parent that save was successful (clears unsaved changes indicator)
    if (onSaveSuccess) {
      onSaveSuccess(newPlan.name);
    }
  };

  const activatePlan = (folderId: string, planId: string) => {
    setActivePlan({ folderId, planId });
    if (onPlanOpen) {
      const folder = folders.find(f => f.id === folderId);
      const plan = folder?.plans.find(p => p.id === planId);
      if (folder && plan) onPlanOpen(folder.name, plan.name);
    }
  };

  const loadPlan = (planData: any, folderId: string, planId: string) => {
    if (hasUnsavedChanges) {
      setConfirmDialog({
        show: true,
        planData,
        targetFolderId: folderId,
        targetPlanId: planId
      });
    } else {
      onLoadPlan(planData);
      activatePlan(folderId, planId);
    }
  };

  const confirmLoadPlan = (saveFirst: boolean) => {
    if (saveFirst && activePlan) {
      // Save current plan first
      handleSave();
    }
    if (confirmDialog.planData) {
      onLoadPlan(confirmDialog.planData);
      if (confirmDialog.targetFolderId && confirmDialog.targetPlanId) {
        activatePlan(confirmDialog.targetFolderId, confirmDialog.targetPlanId);
      }
    }
    setConfirmDialog({ show: false, planData: null });
  };

  // ========== Drag and Drop ==========

  const handleDragStart = (folderId: string, planId: string) => {
    setDraggedPlan({ folderId, planId });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (targetFolderId: string) => {
    if (!draggedPlan) return;

    const sourceFolderId = draggedPlan.folderId;
    const planId = draggedPlan.planId;

    if (sourceFolderId === targetFolderId) {
      setDraggedPlan(null);
      return;
    }

    // Find the plan to move
    const sourceFolder = folders.find((f) => f.id === sourceFolderId);
    const planToMove = sourceFolder?.plans.find((p) => p.id === planId);

    if (!planToMove) {
      setDraggedPlan(null);
      return;
    }

    // Remove from source and add to target
    setFolders(
      folders.map((f) => {
        if (f.id === sourceFolderId) {
          return { ...f, plans: f.plans.filter((p) => p.id !== planId) };
        }
        if (f.id === targetFolderId) {
          return { ...f, plans: [...f.plans, planToMove] };
        }
        return f;
      })
    );

    setDraggedPlan(null);
  };

  // ========== Download/Import/Backup ==========

  const handleExportFile = () => {
    // If there are unsaved changes, show confirmation dialog
    if (activePlan && hasUnsavedChanges) {
      setExportDialog({ show: true, type: "file" });
      return;
    }
    // No unsaved changes, export directly
    doExportFile(false);
  };

  const handleExportAll = () => {
    // If there are unsaved changes, show confirmation dialog
    if (activePlan && hasUnsavedChanges) {
      setExportDialog({ show: true, type: "all" });
      return;
    }
    // No unsaved changes, export directly
    doExportAll(false);
  };

  const doExportFile = (saveFirst: boolean) => {
    // Save first if requested
    if (saveFirst && activePlan) {
      updateCurrentPlan(activePlan.folderId, activePlan.planId);
    }

    // Export the current junction configuration data (not folder structure)
    const json = JSON.stringify(currentData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Use active plan name for filename, or use project name from data
    let filename = "junction-config.json";
    if (activePlan) {
      const folder = folders.find((f) => f.id === activePlan.folderId);
      const plan = folder?.plans.find((p) => p.id === activePlan.planId);
      if (plan) {
        filename = `${plan.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.json`;
      }
    } else if (currentData?.projectName) {
      // Fallback to project name if available
      filename = `${String(currentData.projectName).replace(/[^a-zA-Z0-9-_]/g, "_")}.json`;
    }

    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setExportDialog({ show: false, type: "file" });
  };

  const doExportAll = (saveFirst: boolean) => {
    // Save first if requested
    if (saveFirst && activePlan) {
      updateCurrentPlan(activePlan.folderId, activePlan.planId);
    }

    // Export the entire folder structure
    const data: FolderStructure = { folders };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Use first folder name + date for backup filename
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const folderName = folders[0]?.name || "workspace";
    const safeFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, "_");
    a.download = `${safeFolderName}-backup-${date}.json`;

    a.click();
    URL.revokeObjectURL(url);
    setExportDialog({ show: false, type: "all" });
  };

  const confirmExport = (saveFirst: boolean) => {
    if (exportDialog.type === "file") {
      doExportFile(saveFirst);
    } else {
      doExportAll(saveFirst);
    }
  };

  const importFromJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Security: Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      alert(`File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`);
      e.target.value = "";
      return;
    }

    // Security: Validate file type
    if (!file.name.toLowerCase().endsWith('.json')) {
      alert("Only JSON files are allowed.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rawContent = String(reader.result || "");

        // Security: Basic content validation before parsing
        if (rawContent.length > MAX_FILE_SIZE_BYTES) {
          alert("File content too large.");
          return;
        }

        const data = JSON.parse(rawContent);

        // Check if it's a folder structure file
        if (data.folders && Array.isArray(data.folders)) {
          // Append imported folders to existing folders (with new IDs to avoid conflicts)
          const importedFolders: Folder[] = data.folders.map((folder: Folder, index: number) => ({
            ...folder,
            id: crypto.randomUUID(), // New ID to avoid conflicts
            expanded: index === 0, // Expand the first imported folder
            plans: folder.plans.map((plan: Plan) => ({
              ...plan,
              id: crypto.randomUUID(), // New ID for each plan
            })),
          }));
          setFolders([...folders, ...importedFolders]);

          // If the first imported folder has plans, load the first plan
          const firstFolder = importedFolders[0];
          if (firstFolder && firstFolder.plans.length > 0) {
            const firstPlan = firstFolder.plans[0];
            setActivePlan({ folderId: firstFolder.id, planId: firstPlan.id });
            onLoadPlan(firstPlan.data);
          }
        }
        // Check if it's a junction configuration file (old export format)
        else if (data.junctions && Array.isArray(data.junctions)) {
          // Import as a new plan in the first folder
          const targetFolder = folders[0];
          if (!targetFolder) {
            alert("Please create a folder first before importing junction configurations");
            return;
          }

          // Use sanitized filename as the plan name
          const fileName = sanitizeFilename(file.name);

          const newPlan: Plan = {
            id: crypto.randomUUID(),
            name: fileName,
            data: data,
            createdAt: Date.now(),
            modifiedAt: Date.now(),
          };

          // Add the plan and expand the target folder
          setFolders(
            folders.map((f) =>
              f.id === targetFolder.id
                ? { ...f, plans: [...f.plans, newPlan], expanded: true }
                : f
            )
          );

          // Set as active plan and load the data
          setActivePlan({ folderId: targetFolder.id, planId: newPlan.id });
          onLoadPlan(data);
        }
        else {
          alert("Invalid file format. Expected either a folder structure or junction configuration file.");
        }
      } catch {
        alert("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return {
    folders, setFolders,
    editingId, setEditingId,
    editingName, setEditingName,
    draggedPlan, setDraggedPlan,
    confirmDialog, setConfirmDialog,
    activePlan, setActivePlan,
    saveAsDialog, setSaveAsDialog,
    exportDialog, setExportDialog,
    createFolder, deleteFolder, renameFolder, toggleFolder,
    createPlan, addPlanToFolder, deletePlan, renamePlan, updateCurrentPlan,
    handleSave, handleSaveAs, confirmSaveAs, activatePlan, loadPlan, confirmLoadPlan,
    handleDragStart, handleDragOver, handleDrop,
    handleExportFile, handleExportAll, doExportFile, doExportAll, confirmExport, importFromJSON,
  };
}
