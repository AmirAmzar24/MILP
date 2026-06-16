import React, { createContext, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { TourContextType, TourState, TourStep } from './types';
import { tourSteps, STORAGE_KEY } from './tourSteps';
import { TourOverlay } from './TourOverlay';
import { TourTooltip } from './TourTooltip';

const defaultState: TourState = {
  isActive: false,
  currentStepIndex: 0,
  branchPath: null,
  hasCompletedTour: false,
};

export const TourContext = createContext<TourContextType | null>(null);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TourState>(() => {
    const completed = localStorage.getItem(STORAGE_KEY) === 'true';
    return { ...defaultState, hasCompletedTour: completed };
  });

  const folderPanelControlRef = useRef<((open: boolean) => void) | null>(null);
  const expandJunctionControlRef = useRef<((junctionId: string) => void) | null>(null);
  const getFirstJunctionIdRef = useRef<(() => string | null) | null>(null);
  const highlightBandControlRef = useRef<((band: 'outbound' | 'inbound' | null) => void) | null>(null);

  const registerFolderPanelControl = useCallback((control: (open: boolean) => void) => {
    folderPanelControlRef.current = control;
  }, []);

  const registerExpandJunctionControl = useCallback((control: (junctionId: string) => void) => {
    expandJunctionControlRef.current = control;
  }, []);

  const registerGetFirstJunctionId = useCallback((getter: () => string | null) => {
    getFirstJunctionIdRef.current = getter;
  }, []);

  const registerHighlightBandControl = useCallback((control: (band: 'outbound' | 'inbound' | null) => void) => {
    highlightBandControlRef.current = control;
  }, []);

  const setFolderPanelOpen = useCallback((open: boolean) => {
    if (folderPanelControlRef.current) {
      folderPanelControlRef.current(open);
    }
  }, []);

  const expandFirstJunction = useCallback(() => {
    if (expandJunctionControlRef.current && getFirstJunctionIdRef.current) {
      const firstId = getFirstJunctionIdRef.current();
      if (firstId) {
        expandJunctionControlRef.current(firstId);
      }
    }
  }, []);

  // Filter steps based on current branch
  const getFilteredSteps = useCallback((branchPath: 'database' | 'localFile' | null): TourStep[] => {
    return tourSteps.filter(step => {
      if (!step.branchId) return true; // Steps without branchId are always shown
      return step.branchId === branchPath; // Only show steps matching current branch
    });
  }, []);

  // Get the current step based on state
  const currentStep = useMemo(() => {
    if (!state.isActive) return null;
    const filteredSteps = getFilteredSteps(state.branchPath);
    if (state.currentStepIndex >= filteredSteps.length) return null;
    return filteredSteps[state.currentStepIndex];
  }, [state.isActive, state.currentStepIndex, state.branchPath, getFilteredSteps]);

  // Calculate total steps for current branch
  const totalSteps = useMemo(() => {
    return getFilteredSteps(state.branchPath).length;
  }, [state.branchPath, getFilteredSteps]);

  // Execute step action (like opening folder panel)
  const executeStepAction = useCallback(
    (step: TourStep) => {
      if (!step.action) return;

      // Small delay to let state updates propagate
      setTimeout(() => {
        switch (step.action) {
          case 'openFolderPanel':
            setFolderPanelOpen(true);
            break;
          case 'closeFolderPanel':
            setFolderPanelOpen(false);
            break;
          case 'expandFirstJunction':
            setFolderPanelOpen(false);
            expandFirstJunction();
            break;
          case 'highlightOutboundBand':
            if (highlightBandControlRef.current) highlightBandControlRef.current('outbound');
            break;
        }
      }, 50);
    },
    [setFolderPanelOpen, expandFirstJunction]
  );

  const startTour = useCallback(() => {
    // Close folder panel so step 2 can find the toggle button
    setFolderPanelOpen(false);
    setState({
      isActive: true,
      currentStepIndex: 0,
      branchPath: null,
      hasCompletedTour: state.hasCompletedTour,
    });
  }, [state.hasCompletedTour, setFolderPanelOpen]);

  const endTour = useCallback((markComplete = false) => {
    if (markComplete) {
      localStorage.setItem(STORAGE_KEY, 'true');
    }
    if (highlightBandControlRef.current) highlightBandControlRef.current(null);
    setState((prev) => ({
      ...prev,
      isActive: false,
      currentStepIndex: 0,
      branchPath: null,
      hasCompletedTour: markComplete || prev.hasCompletedTour,
    }));
  }, []);

  const skipTour = useCallback(() => {
    endTour(true);
  }, [endTour]);

  const nextStep = useCallback(() => {
    setState((prev) => {
      const filteredSteps = getFilteredSteps(prev.branchPath);
      const nextIndex = prev.currentStepIndex + 1;

      if (nextIndex >= filteredSteps.length) {
        // Tour complete
        localStorage.setItem(STORAGE_KEY, 'true');
        return { ...prev, isActive: false, hasCompletedTour: true };
      }

      return { ...prev, currentStepIndex: nextIndex };
    });
  }, [getFilteredSteps]);

  const previousStep = useCallback(() => {
    setState((prev) => {
      const prevIndex = Math.max(0, prev.currentStepIndex - 1);
      return { ...prev, currentStepIndex: prevIndex };
    });
  }, []);

  const chooseBranch = useCallback(
    (branch: 'database' | 'localFile') => {
      setState((prev) => {
        // Set branch and move to next step
        return {
          ...prev,
          branchPath: branch,
          currentStepIndex: prev.currentStepIndex + 1
        };
      });
    },
    []
  );

  // Execute action when step changes; clear band highlight when leaving that step
  useEffect(() => {
    if (currentStep?.action) {
      executeStepAction(currentStep);
    } else if (highlightBandControlRef.current) {
      highlightBandControlRef.current(null);
    }
  }, [currentStep, executeStepAction]);

  // Auto-start tour on first visit (disabled for now - user clicks Tour button)
  // useEffect(() => {
  //   if (!state.hasCompletedTour && !state.isActive) {
  //     const timer = setTimeout(() => startTour(), 1000);
  //     return () => clearTimeout(timer);
  //   }
  // }, [state.hasCompletedTour, state.isActive, startTour]);

  // Handle Escape key to close tour
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.isActive) {
        skipTour();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.isActive, skipTour]);

  const contextValue: TourContextType = useMemo(
    () => ({
      state,
      startTour,
      endTour,
      nextStep,
      previousStep,
      chooseBranch,
      skipTour,
      currentStep,
      totalSteps,
      visibleStepNumber: state.currentStepIndex + 1,
      setFolderPanelOpen,
      registerFolderPanelControl,
      registerExpandJunctionControl,
      registerGetFirstJunctionId,
      registerHighlightBandControl,
    }),
    [
      state,
      startTour,
      endTour,
      nextStep,
      previousStep,
      chooseBranch,
      skipTour,
      currentStep,
      totalSteps,
      setFolderPanelOpen,
      registerFolderPanelControl,
      registerExpandJunctionControl,
      registerGetFirstJunctionId,
      registerHighlightBandControl,
    ]
  );

  return (
    <TourContext.Provider value={contextValue}>
      {children}
      {state.isActive &&
        currentStep &&
        createPortal(
          <>
            <TourOverlay targetSelector={currentStep.target} />
            <TourTooltip />
          </>,
          document.body
        )}
    </TourContext.Provider>
  );
}
