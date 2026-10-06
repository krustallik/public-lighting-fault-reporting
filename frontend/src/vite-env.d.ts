/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_ADMIN_BASE_PATH?: string;
  readonly VITE_ALLOW_DEVICE_MAP_RECENTER?: string;
  readonly VITE_PUBLIC_MAP_TILES_APPROVED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
