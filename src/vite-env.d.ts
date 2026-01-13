/// <reference types="vite/client" />
/// <reference types="google.maps" />

interface ImportMetaEnv {
  /**
   * KPI result submission endpoint (Google Apps Script Web App URL, etc.)
   * Example: https://script.google.com/macros/s/XXXX/exec
   */
  readonly VITE_KPI_ENDPOINT_URL?: string;

  /**
   * Enable KPI submission UI.
   * - '0' or undefined: disabled
   * - other values: enabled
   */
  readonly VITE_KPI_ENABLED?: string;

  /**
   * Optional shared token to reduce spam against the KPI endpoint.
   * Note: This value is embedded into the built client bundle.
   * It is NOT a secret protection, but helps block casual/bulk abuse.
   */
  readonly VITE_KPI_TOKEN?: string;

  /**
   * Debug tools (admin pages etc.).
   * - '1': show debug-only UI
   */
  readonly VITE_DEBUG_TOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.md?raw' {
  const content: string;
  export default content;
}