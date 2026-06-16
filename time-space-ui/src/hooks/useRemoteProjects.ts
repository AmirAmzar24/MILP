import { useState, useEffect, useCallback } from "react";
import { authFetch } from "../auth";

// API base URL from environment
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// Types for database data
type DbClient = {
  id: string;
  name: string;
  nick: string;
  projectCount: number;
};

type DbProject = {
  id: string;
  name: string;
  location: string;
  description: string;
  junctionCount: number;
};

type DbTiming = {
  id: string;
  date: string;
  reason: string;
  cycle: number;
  plan: number;
};

export interface UseRemoteProjectsArgs {
  isOpen: boolean;
  /** Called when a DB timing has been fetched; the consumer turns it into a local plan. */
  onTimingLoaded: (planData: any, planName: string) => void;
}

/**
 * Owns the "Load from Database" browsing flow: DB connection status and the
 * role → client → project → subsystem → timing cascade, plus the timing fetch.
 * Extracted from FolderPanel.tsx (Phase 8b). Pure DB concern — turning a fetched
 * timing into a saved plan is delegated to the caller via `onTimingLoaded`.
 */
export function useRemoteProjects({ isOpen, onTimingLoaded }: UseRemoteProjectsArgs) {
  // Database loading state
  const [dbExpanded, setDbExpanded] = useState(true);
  const [dbStatus, setDbStatus] = useState<"idle" | "loading" | "connected" | "error">("idle");
  const [dbError, setDbError] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("client");
  const [clients, setClients] = useState<DbClient[]>([]); // Users with selected role
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Subsystem state
  const [subsystems, setSubsystems] = useState<string[]>([]);
  const [selectedSubsystem, setSelectedSubsystem] = useState<string>("");
  const [loadingSubsystems, setLoadingSubsystems] = useState(false);

  // Date range and timings state
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [timingLimit, setTimingLimit] = useState<number>(20);
  const [timings, setTimings] = useState<DbTiming[]>([]);
  const [selectedTimingId, setSelectedTimingId] = useState<string>("");
  const [loadingTimings, setLoadingTimings] = useState(false);

  // Check DB status and load clients on mount
  useEffect(() => {
    if (isOpen && dbStatus === "idle") {
      checkDbAndLoadClients();
    }
  }, [isOpen, dbStatus]);

  const checkDbAndLoadClients = useCallback(async () => {
    setDbStatus("loading");
    setDbError(null);

    try {
      // Check database status
      const statusRes = await authFetch(`${API_URL}/api/db/status`);
      const statusData = await statusRes.json();

      if (!statusData.connected) {
        setDbStatus("error");
        setDbError(statusData.error || "Database not connected");
        return;
      }

      // Load available roles
      const rolesRes = await authFetch(`${API_URL}/api/roles`);
      if (rolesRes.ok) {
        const rolesData = await rolesRes.json();
        setRoles(rolesData.roles || []);
      }

      // Load users for the default/selected role
      const usersRes = await authFetch(`${API_URL}/api/users?role=${selectedRole}`);
      if (!usersRes.ok) throw new Error("Failed to fetch users");

      const usersData = await usersRes.json();
      setClients(usersData.users || []);
      setDbStatus("connected");
    } catch (err) {
      setDbStatus("error");
      setDbError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [selectedRole]);

  const loadUsersForRole = useCallback(async (role: string) => {
    setLoadingUsers(true);
    setClients([]);
    setSelectedClientId("");
    setProjects([]);
    setSelectedProjectId("");
    setSubsystems([]);
    setSelectedSubsystem("");
    setTimings([]);
    setSelectedTimingId("");

    try {
      const res = await authFetch(`${API_URL}/api/users?role=${role}`);
      if (!res.ok) throw new Error("Failed to fetch users");

      const data = await res.json();
      setClients(data.users || []);
    } catch (err) {
      console.error("Error loading users:", err);
      setClients([]);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const handleRoleChange = (role: string) => {
    setSelectedRole(role);
    loadUsersForRole(role);
  };

  const loadProjectsForClient = useCallback(async (clientId: string) => {
    if (!clientId) {
      setProjects([]);
      setSelectedProjectId("");
      return;
    }

    setLoadingProjects(true);
    try {
      const res = await authFetch(`${API_URL}/api/clients/${clientId}/projects`);
      if (!res.ok) throw new Error("Failed to fetch projects");

      const data = await res.json();
      setProjects(data.projects || []);
      setSelectedProjectId("");
    } catch (err) {
      console.error("Error loading projects:", err);
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedProjectId("");
    setSubsystems([]);
    setSelectedSubsystem("");
    setTimings([]);
    setSelectedTimingId("");
    loadProjectsForClient(clientId);
  };

  const loadSubsystemsForProject = useCallback(async (projectId: string) => {
    if (!projectId) {
      setSubsystems([]);
      setSelectedSubsystem("");
      return;
    }

    setLoadingSubsystems(true);
    try {
      const res = await authFetch(`${API_URL}/api/projects/${projectId}/subsystems`);
      if (!res.ok) throw new Error("Failed to fetch subsystems");

      const data = await res.json();
      setSubsystems(data.subsystems || []);
      setSelectedSubsystem("");
    } catch (err) {
      console.error("Error loading subsystems:", err);
      setSubsystems([]);
    } finally {
      setLoadingSubsystems(false);
    }
  }, []);

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSubsystems([]);
    setSelectedSubsystem("");
    setTimings([]);
    setSelectedTimingId("");
    loadSubsystemsForProject(projectId);
  };

  const handleSubsystemChange = (subsystem: string) => {
    setSelectedSubsystem(subsystem);
    setTimings([]);
    setSelectedTimingId("");
  };

  const searchTimings = useCallback(async () => {
    if (!selectedProjectId || !selectedSubsystem) return;

    setLoadingTimings(true);
    setTimings([]);
    setSelectedTimingId("");

    try {
      const params = new URLSearchParams();
      params.append("subsystem", selectedSubsystem);
      if (startDate) params.append("start_date", startDate);
      if (endDate) params.append("end_date", endDate);
      params.append("limit", timingLimit.toString());

      const res = await authFetch(`${API_URL}/api/projects/${selectedProjectId}/timings/search?${params}`);
      if (!res.ok) throw new Error("Failed to fetch timings");

      const data = await res.json();
      setTimings(data.timings || []);
    } catch (err) {
      console.error("Error searching timings:", err);
      setTimings([]);
    } finally {
      setLoadingTimings(false);
    }
  }, [selectedProjectId, selectedSubsystem, startDate, endDate, timingLimit]);

  const loadSelectedTiming = async () => {
    if (!selectedTimingId || !selectedProjectId) return;

    setLoadingData(true);
    try {
      const res = await authFetch(`${API_URL}/api/timings/${selectedTimingId}/load?project_id=${selectedProjectId}`);
      if (!res.ok) throw new Error("Failed to load timing");

      const data = await res.json();
      if (data.success && data.data) {
        // Find selected project and timing for the plan name
        const selectedProject = projects.find(p => p.id === selectedProjectId);
        const selectedTiming = timings.find(t => t.id === selectedTimingId);
        const timingDate = selectedTiming?.date ? new Date(selectedTiming.date).toLocaleDateString() : "";
        const planName = `${selectedProject?.name || "Import"} - ${timingDate}`;

        // Hand the loaded data to the caller, which creates the local plan + loads the GUI
        onTimingLoaded(data.data, planName);
      }
    } catch (err) {
      console.error("Error loading timing from DB:", err);
      alert(`Failed to load timing: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoadingData(false);
    }
  };

  return {
    dbExpanded, setDbExpanded, dbStatus, setDbStatus, dbError,
    roles, selectedRole, setSelectedRole, clients, projects,
    selectedClientId, selectedProjectId,
    loadingProjects, loadingData, loadingUsers,
    subsystems, selectedSubsystem, loadingSubsystems,
    startDate, setStartDate, endDate, setEndDate,
    timingLimit, setTimingLimit, timings, selectedTimingId, setSelectedTimingId, loadingTimings,
    checkDbAndLoadClients, handleRoleChange, handleClientChange,
    handleProjectChange, handleSubsystemChange, searchTimings, loadSelectedTiming,
  };
}

export type RemoteProjectsApi = ReturnType<typeof useRemoteProjects>;
