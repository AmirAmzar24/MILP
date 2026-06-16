import type { RemoteProjectsApi } from "../hooks/useRemoteProjects";

// The "Load from Database" sub-panel: DB connection status and the
// role → client → project → subsystem → timing cascade. Driven entirely by the
// useRemoteProjects hook (passed in as `db`). Extracted from FolderPanel (Phase 8c).
export function DatabaseBrowser({ db }: { db: RemoteProjectsApi }) {
  const {
    dbExpanded, setDbExpanded, dbStatus, dbError,
    roles, selectedRole, clients, projects,
    selectedClientId, selectedProjectId,
    loadingProjects, loadingData, loadingUsers,
    subsystems, selectedSubsystem, loadingSubsystems,
    startDate, setStartDate, endDate, setEndDate,
    timingLimit, setTimingLimit, timings, selectedTimingId, setSelectedTimingId, loadingTimings,
    checkDbAndLoadClients, handleRoleChange, handleClientChange, handleProjectChange, handleSubsystemChange,
    searchTimings, loadSelectedTiming,
  } = db;

  return (
          <div className="border-b border-neutral-200 dark:border-neutral-800">
            <button
              onClick={() => setDbExpanded(!dbExpanded)}
              className="w-full p-3 flex items-center justify-between hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
                <span className="text-sm font-medium">Load from Database</span>
              </div>
              <div className="flex items-center gap-2">
                {dbStatus === "connected" && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500" title="Connected" />
                )}
                {dbStatus === "error" && (
                  <span className="w-2 h-2 rounded-full bg-red-500" title={dbError || "Error"} />
                )}
                {dbStatus === "loading" && (
                  <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" title="Connecting..." />
                )}
                <svg
                  className={`w-4 h-4 transition-transform ${dbExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {dbExpanded && (
              <div className="px-3 pb-3 space-y-3">
                {dbStatus === "error" && (
                  <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                    {dbError}
                    <button
                      onClick={checkDbAndLoadClients}
                      className="ml-2 underline hover:no-underline"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {dbStatus === "loading" && (
                  <div className="text-xs text-neutral-400 dark:text-neutral-300 text-center py-2">
                    Connecting to database...
                  </div>
                )}

                {dbStatus === "connected" && (
                  <>
                    {/* Role Select */}
                    <div data-tour="db-role-select">
                      <label className="block text-xs font-medium mb-1 text-neutral-500 dark:text-neutral-300">
                        1. Role
                      </label>
                      <select
                        value={selectedRole}
                        onChange={(e) => handleRoleChange(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 capitalize"
                      >
                        {roles.length > 0 ? (
                          roles.map((role) => (
                            <option key={role} value={role} className="capitalize">
                              {role.charAt(0).toUpperCase() + role.slice(1)}
                            </option>
                          ))
                        ) : (
                          <option value="client">Client</option>
                        )}
                      </select>
                    </div>

                    {/* User Select */}
                    <div data-tour="db-user-select">
                      <label className="block text-xs font-medium mb-1 text-neutral-500 dark:text-neutral-300">
                        2. {selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)}
                      </label>
                      <select
                        value={selectedClientId}
                        onChange={(e) => handleClientChange(e.target.value)}
                        disabled={loadingUsers}
                        className="w-full px-2 py-1.5 text-sm rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 disabled:opacity-50"
                      >
                        <option value="">
                          {loadingUsers ? "Loading..." : `Select a ${selectedRole}...`}
                        </option>
                        {clients.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name} {client.nick ? `(${client.nick})` : ""} - {client.projectCount} projects
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Project Select */}
                    <div data-tour="db-project-select">
                      <label className="block text-xs font-medium mb-1 text-neutral-500 dark:text-neutral-300">
                        3. Project
                      </label>
                      <select
                        value={selectedProjectId}
                        onChange={(e) => handleProjectChange(e.target.value)}
                        disabled={!selectedClientId || loadingProjects}
                        className="w-full px-2 py-1.5 text-sm rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 disabled:opacity-50"
                      >
                        <option value="">
                          {loadingProjects ? "Loading..." : selectedClientId ? "Select a project..." : `Select ${selectedRole} first`}
                        </option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name} - {project.junctionCount} junctions
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Subsystem Select - only show after project selected */}
                    {selectedProjectId && (
                      <div data-tour="db-subsystem-select">
                        <label className="block text-xs font-medium mb-1 text-neutral-500 dark:text-neutral-300">
                          4. Subsystem
                        </label>
                        <select
                          value={selectedSubsystem}
                          onChange={(e) => handleSubsystemChange(e.target.value)}
                          disabled={!selectedProjectId || loadingSubsystems}
                          className="w-full px-2 py-1.5 text-sm rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 disabled:opacity-50"
                        >
                          <option value="">
                            {loadingSubsystems ? "Loading..." : subsystems.length === 0 ? "No subsystems found" : "Select a subsystem..."}
                          </option>
                          {subsystems.map((subsystem) => (
                            <option key={subsystem} value={subsystem}>
                              {subsystem}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Date Range - only show after subsystem selected */}
                    {selectedSubsystem && (
                      <>
                        <div data-tour="db-daterange" className="border-t border-neutral-200 dark:border-neutral-700 pt-3 mt-1">
                          <label className="block text-xs font-medium mb-1 text-neutral-500 dark:text-neutral-300">
                            5. Date Range
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="date"
                              value={startDate}
                              onChange={(e) => setStartDate(e.target.value)}
                              className="flex-1 px-2 py-1 text-xs rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800"
                              placeholder="Start"
                            />
                            <input
                              type="date"
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                              className="flex-1 px-2 py-1 text-xs rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800"
                              placeholder="End"
                            />
                          </div>
                        </div>

                        {/* Limit */}
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-neutral-500 dark:text-neutral-300">
                            Max results:
                          </label>
                          <input
                            type="number"
                            value={timingLimit}
                            onChange={(e) => setTimingLimit(Math.max(1, Math.min(100, parseInt(e.target.value) || 20)))}
                            min={1}
                            max={100}
                            className="w-16 px-2 py-1 text-xs rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800"
                          />
                          <button
                            data-tour="db-search-button"
                            onClick={searchTimings}
                            disabled={loadingTimings}
                            className="flex-1 px-3 py-1 text-xs rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                          >
                            {loadingTimings ? "Searching..." : "Search Timings"}
                          </button>
                        </div>

                        {/* Timings List */}
                        {timings.length > 0 && (
                          <div>
                            <label className="block text-xs font-medium mb-1 text-neutral-500 dark:text-neutral-300">
                              6. Select Timing Plan ({timings.length} found)
                            </label>
                            <select
                              value={selectedTimingId}
                              onChange={(e) => setSelectedTimingId(e.target.value)}
                              className="w-full px-2 py-1.5 text-sm rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800"
                              size={Math.min(5, timings.length + 1)}
                            >
                              <option value="">Select a timing plan...</option>
                              {timings.map((timing) => {
                                const date = new Date(timing.date);
                                const dateStr = date.toLocaleDateString();
                                const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                return (
                                  <option key={timing.id} value={timing.id}>
                                    {dateStr} {timeStr} - {timing.reason} (C={timing.cycle}s)
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        )}

                        {timings.length === 0 && !loadingTimings && selectedSubsystem && (
                          <div className="text-xs text-neutral-400 dark:text-neutral-300 text-center py-2 italic">
                            Click "Search Timings" to find timing plans
                          </div>
                        )}

                        {/* Load Button */}
                        <button
                          data-tour="db-load-button"
                          onClick={loadSelectedTiming}
                          disabled={!selectedTimingId || loadingData}
                          className={`w-full px-3 py-2 text-sm rounded font-medium transition-colors ${
                            selectedTimingId && !loadingData
                              ? "bg-emerald-600 text-white hover:bg-emerald-700"
                              : "bg-neutral-300 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 cursor-not-allowed"
                          }`}
                        >
                          {loadingData ? "Loading..." : "Load Selected Timing"}
                        </button>
                      </>
                    )}

                    {projects.length > 0 && selectedProjectId && (
                      <div className="text-xs text-neutral-400 dark:text-neutral-300 text-center">
                        {projects.find(p => p.id === selectedProjectId)?.description?.slice(0, 100) || ""}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
  );
}
