import { create } from 'zustand';

interface LogState {
  logsByTaskId: Record<string, string[]>;
  hydrateLogs: (logs: Record<string, string[]>) => void;
  appendLog: (taskId: string, chunk: string) => void;
}

export const useLogStore = create<LogState>((set) => ({
  logsByTaskId: {},
  hydrateLogs: (logs) => set({ logsByTaskId: logs }),
  appendLog: (taskId, chunk) =>
    set((state) => ({
      logsByTaskId: {
        ...state.logsByTaskId,
        [taskId]: [...(state.logsByTaskId[taskId] ?? []), chunk],
      },
    })),
}));
