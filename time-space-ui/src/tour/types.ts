export interface TourStep {
  id: string;
  target: string | null; // data-tour selector or null for centered modal
  title: string;
  content: string;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
  branchId?: 'database' | 'localFile'; // Only show for this branch
  branches?: { id: 'database' | 'localFile'; label: string }[]; // Branch choice options
  action?: 'openFolderPanel' | 'closeFolderPanel' | 'expandFirstJunction' | 'highlightOutboundBand';
}

export interface TourState {
  isActive: boolean;
  currentStepIndex: number;
  branchPath: 'database' | 'localFile' | null;
  hasCompletedTour: boolean;
}

export interface TourContextType {
  state: TourState;
  startTour: () => void;
  endTour: (markComplete?: boolean) => void;
  nextStep: () => void;
  previousStep: () => void;
  chooseBranch: (branch: 'database' | 'localFile') => void;
  skipTour: () => void;
  currentStep: TourStep | null;
  totalSteps: number;
  visibleStepNumber: number;
  setFolderPanelOpen?: (open: boolean) => void;
  registerFolderPanelControl: (control: (open: boolean) => void) => void;
  registerExpandJunctionControl: (control: (junctionId: string) => void) => void;
  registerGetFirstJunctionId: (getter: () => string | null) => void;
  registerHighlightBandControl: (control: (band: 'outbound' | 'inbound' | null) => void) => void;
}
