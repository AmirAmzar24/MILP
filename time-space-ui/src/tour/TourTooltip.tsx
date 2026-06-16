import { useEffect, useState, useRef } from 'react';
import { useTour } from './useTour';

interface Position {
  top: number;
  left: number;
  arrowSide: 'top' | 'bottom' | 'left' | 'right';
  arrowOffset: number;
}

export function TourTooltip() {
  const {
    currentStep,
    nextStep,
    previousStep,
    skipTour,
    chooseBranch,
    visibleStepNumber,
    totalSteps,
  } = useTour();

  const [position, setPosition] = useState<Position | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentStep) return;

    // Scroll target into view once when step changes
    if (currentStep.target && currentStep.placement !== 'center') {
      const el = document.querySelector(currentStep.target);
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
      }
    }

    const calculatePosition = () => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      // For centered modals (no target)
      if (currentStep.placement === 'center' || !currentStep.target) {
        setPosition(null); // Use CSS centering
        return;
      }

      const targetElement = document.querySelector(currentStep.target);
      if (!targetElement) {
        setPosition(null);
        return;
      }

      const targetRect = targetElement.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const padding = 12;
      const arrowSize = 8;

      let top = 0;
      let left = 0;
      let arrowSide: Position['arrowSide'] = 'top';
      let arrowOffset = 50; // percentage

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Determine best placement based on available space
      const spaceAbove = targetRect.top;
      const spaceBelow = viewportHeight - targetRect.bottom;
      const spaceLeft = targetRect.left;
      const spaceRight = viewportWidth - targetRect.right;

      // Prefer placement based on step config, but adjust if not enough space
      let placement = currentStep.placement;

      if (placement === 'bottom' && spaceBelow < tooltipRect.height + padding) {
        placement = 'top';
      } else if (placement === 'top' && spaceAbove < tooltipRect.height + padding) {
        placement = 'bottom';
      } else if (placement === 'left' && spaceLeft < tooltipRect.width + padding) {
        placement = 'right';
      } else if (placement === 'right' && spaceRight < tooltipRect.width + padding) {
        placement = 'left';
      }

      switch (placement) {
        case 'bottom':
          top = targetRect.bottom + padding + arrowSize;
          left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
          arrowSide = 'top';
          break;
        case 'top':
          top = targetRect.top - tooltipRect.height - padding - arrowSize;
          left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
          arrowSide = 'bottom';
          break;
        case 'left':
          top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
          left = targetRect.left - tooltipRect.width - padding - arrowSize;
          arrowSide = 'right';
          break;
        case 'right':
          top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
          left = targetRect.right + padding + arrowSize;
          arrowSide = 'left';
          break;
        default:
          top = targetRect.bottom + padding + arrowSize;
          left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
          arrowSide = 'top';
      }

      // Keep tooltip within viewport bounds
      if (left < padding) {
        const shift = padding - left;
        left = padding;
        // Adjust arrow position
        arrowOffset = Math.max(10, 50 - (shift / tooltipRect.width) * 100);
      } else if (left + tooltipRect.width > viewportWidth - padding) {
        const shift = (left + tooltipRect.width) - (viewportWidth - padding);
        left = viewportWidth - tooltipRect.width - padding;
        arrowOffset = Math.min(90, 50 + (shift / tooltipRect.width) * 100);
      }

      if (top < padding) {
        top = padding;
      } else if (top + tooltipRect.height > viewportHeight - padding) {
        top = viewportHeight - tooltipRect.height - padding;
      }

      setPosition({ top, left, arrowSide, arrowOffset });
    };

    // Small delay to let DOM update
    const timer = setTimeout(calculatePosition, 100);
    // Recalculate after CSS transitions complete (e.g. folder panel slide-in is 300ms)
    const timer2 = setTimeout(calculatePosition, 450);

    // Recalculate on resize/scroll
    window.addEventListener('resize', calculatePosition);
    window.addEventListener('scroll', calculatePosition, true);

    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
      window.removeEventListener('resize', calculatePosition);
      window.removeEventListener('scroll', calculatePosition, true);
    };
  }, [currentStep]);

  if (!currentStep) return null;

  const isFirstStep = visibleStepNumber === 1;
  const isLastStep = visibleStepNumber === totalSteps;
  const hasBranches = currentStep.branches && currentStep.branches.length > 0;
  const isCentered = currentStep.placement === 'center' || !currentStep.target;

  return (
    <div
      ref={tooltipRef}
      className="tour-tooltip"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        ...(isCentered
          ? {
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }
          : position
          ? {
              top: position.top,
              left: position.left,
            }
          : {
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }),
        zIndex: 9999,
        maxWidth: '320px',
        minWidth: '260px',
      }}
    >
      {/* Arrow */}
      {!isCentered && position && (
        <div
          style={{
            position: 'absolute',
            width: 0,
            height: 0,
            ...(position.arrowSide === 'top' && {
              top: -8,
              left: `${position.arrowOffset}%`,
              transform: 'translateX(-50%)',
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderBottom: '8px solid #3b82f6',
            }),
            ...(position.arrowSide === 'bottom' && {
              bottom: -8,
              left: `${position.arrowOffset}%`,
              transform: 'translateX(-50%)',
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: '8px solid #3b82f6',
            }),
            ...(position.arrowSide === 'left' && {
              left: -8,
              top: '50%',
              transform: 'translateY(-50%)',
              borderTop: '8px solid transparent',
              borderBottom: '8px solid transparent',
              borderRight: '8px solid #3b82f6',
            }),
            ...(position.arrowSide === 'right' && {
              right: -8,
              top: '50%',
              transform: 'translateY(-50%)',
              borderTop: '8px solid transparent',
              borderBottom: '8px solid transparent',
              borderLeft: '8px solid #3b82f6',
            }),
          }}
        />
      )}

      {/* Tooltip content */}
      <div
        style={{
          backgroundColor: '#3b82f6',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
        }}
      >
        {/* Content */}
        <div style={{ padding: '16px' }}>
          <p
            style={{
              margin: 0,
              marginBottom: '4px',
              fontSize: '11px',
              color: 'rgba(255, 255, 255, 0.7)',
            }}
          >
            Step {visibleStepNumber} of {totalSteps}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: '14px',
              color: 'white',
              lineHeight: 1.5,
            }}
          >
            {currentStep.content}
          </p>

          {/* Branch selection buttons */}
          {hasBranches && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
              {currentStep.branches!.map((branch) => (
                <button
                  key={branch.id}
                  onClick={() => chooseBranch(branch.id)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '13px',
                    fontWeight: 500,
                    backgroundColor: 'white',
                    color: '#3b82f6',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  {branch.label}
                </button>
              ))}
            </div>
          )}

          {/* Skip link */}
          <button
            onClick={skipTour}
            style={{
              marginTop: '8px',
              padding: 0,
              fontSize: '12px',
              color: 'rgba(255, 255, 255, 0.6)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Hide these tips
          </button>
        </div>

        {/* Navigation */}
        {!hasBranches && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            {!isFirstStep ? (
              <button
                onClick={previousStep}
                style={{
                  padding: '6px 12px',
                  fontSize: '13px',
                  fontWeight: 500,
                  backgroundColor: 'transparent',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            ) : (
              <div />
            )}
            <button
              onClick={nextStep}
              style={{
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 500,
                backgroundColor: 'white',
                color: '#3b82f6',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              {isLastStep ? 'Done' : 'Next'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
