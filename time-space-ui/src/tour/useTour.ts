import { useContext } from 'react';
import { TourContext } from './TourProvider';
import type { TourContextType } from './types';

export function useTour(): TourContextType {
  const context = useContext(TourContext);

  if (!context) {
    throw new Error('useTour must be used within a TourProvider');
  }

  return context;
}
