// @ts-check
/**
 * Candidate ports for the PhishGuard hub, shared by the hub launcher
 * (scripts/phishguard-hub.mjs) and the browser agent, so whichever port the
 * hub lands on, the agent finds it.
 *
 * Order of precedence:
 *   1. PHISHGUARD_PORTS env var, e.g. PHISHGUARD_PORTS=5000,5001
 *   2. `hubPorts` array in phishguard.config.json
 *   3. `port` in phishguard.config.json, followed by the defaults below
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_HUB_PORTS = [4173, 4172, 4174, 4175, 4176, 4177, 4180, 4190];

/** @param {unknown} v */
const validPort = (v) => Number.isInteger(v) && /** @type {number} */ (v) > 1023 && /** @type {number} */ (v) < 65536;

/**
 * @param {string} root project root (where phishguard.config.json lives)
 * @returns {number[]}
 */
export function hubPorts(root) {
  /** @type {{ port?: unknown, hubPorts?: unknown }} */
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(root, "phishguard.config.json"), "utf8"));
  } catch {}

  /** @type {unknown[]} */
  let list;
  if (process.env.PHISHGUARD_PORTS) list = process.env.PHISHGUARD_PORTS.split(",").map((s) => Number(s.trim()));
  else if (Array.isArray(cfg.hubPorts)) list = cfg.hubPorts;
  else list = [cfg.port, ...DEFAULT_HUB_PORTS];

  return [...new Set(list.filter(validPort))].map(Number);
}
