import type { TourStep } from './types';

export const tourSteps: TourStep[] = [
  // ── 1. Welcome ──────────────────────────────────────────────────────────────
  {
    id: 'welcome',
    target: null,
    title: 'Welcome to SASCOO Vision Tool',
    content: "You've loaded the Demo Project — a 3-junction signalised corridor. This tour walks you through the full workflow. Press Escape or click \"Skip tour\" anytime to exit.",
    placement: 'center',
  },

  // ── 2. Time-Space Diagram — Outbound Flow ───────────────────────────────────
  {
    id: 'diagram-outbound',
    target: '[data-tour="diagram-container"]',
    title: 'Stage 2 — Outbound Flow',
    content: 'This is the Time-Space Diagram. The highlighted blue band shows the Outbound Greenwave — the window of time vehicles can travel through the corridor without stopping at a red light.',
    placement: 'top',
    action: 'highlightOutboundBand',
  },

  // ── 3. Toggle Inbound Greenwave ──────────────────────────────────────────────
  {
    id: 'bandwidth-toggle',
    target: '[data-tour="bandwidth-legend"]',
    title: 'Stage 3 — Toggle Inbound Greenwave Band',
    content: 'Click "Outbound Bandwidth" or "Inbound Bandwidth" to highlight each greenwave band on the diagram. Click Inbound Bandwidth to analyse the opposite direction of flow.',
    placement: 'top',
  },

  // ── 4. Examine Junction Phases & Offsets ─────────────────────────────────────
  {
    id: 'junctions-panel',
    target: '[data-tour="junctions-panel"]',
    title: 'Stage 4 — Junction Phases & Offsets',
    content: 'Click any junction row to expand it and examine its phase timings, cycle length, and offset value. The offset determines when this signal cycle starts relative to the corridor.',
    placement: 'right',
    action: 'expandFirstJunction',
  },

  // ── 5. Phase Sequence detail ─────────────────────────────────────────────────
  {
    id: 'phase-sequence',
    target: '[data-tour="phase-sequence-cards"]',
    title: 'Phase Sequence',
    content: 'Each chip shows a phase name and its duration in seconds. Blue dots mark Outbound coordination phases; green dots mark Inbound. Drag chips to reorder the sequence.',
    placement: 'right',
  },

  // ── 5. Visualize Trajectories ────────────────────────────────────────────────
  {
    id: 'trajectory',
    target: '[data-tour="trajectory-button"]',
    title: 'Stage 5 — Visualize Trajectories',
    content: 'Enable Trajectory to visualise how vehicles travel through the corridor. Hover anywhere on the diagram to see their predicted path based on travel speeds.',
    placement: 'bottom',
  },

  // ── 5b. Queue Clearance ──────────────────────────────────────────────────────
  {
    id: 'queue-trajectory',
    target: '[data-tour="queue-trajectory-button"]',
    title: 'Queue Clearance',
    content: 'Enable Queue Trajectory to overlay queue discharge lines — showing how vehicles clear from a red phase at each junction. Set clearance times in the dropdown.',
    placement: 'bottom',
  },

  // ── 6. Optimization Settings ─────────────────────────────────────────────────
  {
    id: 'optimization-tab',
    target: '[data-tour="optimization-tab"]',
    title: 'Stage 6 — Optimize Greenwave Bandwidth',
    content: 'Switch to the Optimization tab to configure the MILP solver: cycle range, speed limits, bandwidth priority (k), and master junction.',
    placement: 'right',
  },

  // ── 6b. Run ──────────────────────────────────────────────────────────────────
  {
    id: 'run-button',
    target: '[data-tour="run-optimization-button"]',
    title: 'Run the Optimizer',
    content: 'Click Run to execute the MILP optimizer. It calculates the optimal signal offsets that maximise the greenwave bandwidth for your corridor.',
    placement: 'top',
  },

  // ── Done ─────────────────────────────────────────────────────────────────────
  {
    id: 'completion',
    target: null,
    title: 'Tour Complete!',
    content: "You've seen the full SASCOO workflow. Re-launch this tour anytime by clicking the ? button in the top bar.",
    placement: 'center',
  },
];

export const STORAGE_KEY = 'sascoo-tour-completed';
