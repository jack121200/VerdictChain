/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL. Defaults to http://127.0.0.1:8000 when unset. Not a secret. */
  readonly VITE_API_BASE?: string;
}
