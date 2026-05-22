import { create } from 'zustand';
import type { AppSettings } from '../types/ipc';

interface SettingsState {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
}

const defaultSettings: AppSettings = {
  serverBaseUrl: 'http://localhost:5001',
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  defaultOutputDir: '',
  autoOpenOutputDir: false,
  logRetentionDays: 7,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  setSettings: (settings) => set({ settings }),
}));
