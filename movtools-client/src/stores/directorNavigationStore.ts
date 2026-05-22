import { create } from 'zustand';

interface DirectorNavigationState {
  pendingReviewTaskId: string | null;
  pendingLensId: string | null;
  setPendingReviewTaskId: (taskId: string | null) => void;
  setPendingLensId: (lensId: string | null) => void;
  clearPendingReviewTaskId: () => void;
  clearPendingLensId: () => void;
}

export const useDirectorNavigationStore = create<DirectorNavigationState>((set) => ({
  pendingReviewTaskId: null,
  pendingLensId: null,
  setPendingReviewTaskId: (pendingReviewTaskId) => set({ pendingReviewTaskId }),
  setPendingLensId: (pendingLensId) => set({ pendingLensId }),
  clearPendingReviewTaskId: () => set({ pendingReviewTaskId: null }),
  clearPendingLensId: () => set({ pendingLensId: null }),
}));
