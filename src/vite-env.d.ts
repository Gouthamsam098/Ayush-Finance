/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_API?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_STATEMENT_PORTAL_URL?: string;
  readonly VITE_DEMO_PORTAL_EMAIL?: string;
  readonly VITE_DEMO_PORTAL_PASSWORD?: string;
  readonly VITE_DEMO_PORTAL_CUSTOMER_CODE?: string;
  readonly VITE_DEMO_PORTAL_CUSTOMER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
