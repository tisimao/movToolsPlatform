interface ImportMetaEnv {
  readonly VITE_SERVER_BASE_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_HEALTH_PATH?: string;
  readonly VITE_API_LOGIN_PATH?: string;
  readonly VITE_API_ME_PATH?: string;
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
