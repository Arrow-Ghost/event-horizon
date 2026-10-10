/// <reference types="astro/client" />

/** Served by integrations/phishguard.mjs. */
declare module "virtual:phishguard/config" {
  const config: {
    enabled: boolean;
    /** candidate PhishGuard hub origins, all on 127.0.0.1, in priority order */
    hubs: string[];
    /** write-only agent key from phishguard.config.json ("" when disabled) */
    key: string;
  };
  export default config;
}
