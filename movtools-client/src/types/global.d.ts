import type { MovtoolsApi } from './ipc';

declare global {
  interface Window {
    movtools: MovtoolsApi;
  }
}

export {};
