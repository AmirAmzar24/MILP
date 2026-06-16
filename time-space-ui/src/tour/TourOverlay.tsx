// Minimal overlay - just a subtle backdrop, no spotlight manipulation
export function TourOverlay({ targetSelector }: { targetSelector: string | null }) {
  // For centered modals (welcome/completion), show a dim backdrop
  if (!targetSelector) {
    return (
      <div
        className="tour-overlay"
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          zIndex: 9998,
        }}
      />
    );
  }

  // For targeted steps, no overlay - just let the tooltip appear
  return null;
}
