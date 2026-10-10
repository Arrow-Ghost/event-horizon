// @ts-check
/**
 * PhishGuard integration for Astro.
 *
 *  - Reads ../phishguard.config.json (written by `phishguard init`) and hands
 *    the browser agent its hub address and write-only agent key through a
 *    virtual module, `virtual:phishguard/config`.
 *  - Splits every npm package into its own production chunk named
 *    `pkg-<name>`, so the agent can tell from a stack trace which package
 *    made a network call. In dev the same information comes from Vite's
 *    `/node_modules/.vite/deps/<name>.js` paths.
 *
 * The agent is on in `astro dev` whenever the project has an agent key, and
 * off in production builds unless PHISHGUARD_AGENT=1 (a public site cannot
 * reach a hub on 127.0.0.1, and the key would ship for nothing).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hubPorts } from "./phishguard-ports.mjs";

const VIRTUAL = "virtual:phishguard/config";
const RESOLVED = "\0" + VIRTUAL;

/** `@scope/name` → `scope__name`; reversed by the agent. @param {string} name */
export const encodePackage = (name) => name.replace(/^@/, "").replace("/", "__");

/** @param {string} id */
function packageFromId(id) {
  const i = id.lastIndexOf("/node_modules/");
  if (i < 0) return null;
  const rest = id.slice(i + "/node_modules/".length).split("/");
  if (!rest[0] || rest[0].startsWith(".")) return null;
  return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}

/** @param {string} root @returns {{ agentKey?: string, port?: number } | null} */
function readConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "phishguard.config.json"), "utf8"));
  } catch {
    return null;
  }
}

/** @returns {import('astro').AstroIntegration} */
export default function phishguard() {
  return {
    name: "phishguard",
    hooks: {
      "astro:config:setup": ({ command, config, updateConfig, logger }) => {
        const root = fileURLToPath(config.root);
        const cfg = readConfig(root);
        const wanted = command === "dev" ? process.env.PHISHGUARD_AGENT !== "0" : process.env.PHISHGUARD_AGENT === "1";
        const enabled = Boolean(wanted && cfg && typeof cfg.agentKey === "string");
        const ports = hubPorts(root);
        const runtime = {
          enabled,
          // the agent probes these in order and attaches to the hub that accepts its key
          hubs: ports.map((p) => `http://127.0.0.1:${p}`),
          key: enabled && cfg ? cfg.agentKey ?? "" : "",
        };

        if (command === "dev") {
          if (!cfg) logger.warn("no phishguard.config.json — run `npx phishguard init` to enable the runtime agent");
          else if (enabled) logger.info(`runtime agent → hub on 127.0.0.1, ports ${ports.join(", ")} (start it with \`npm run security:hub\`)`);
        }

        updateConfig({
          vite: {
            plugins: [
              {
                name: "phishguard:config",
                resolveId: (id) => (id === VIRTUAL ? RESOLVED : null),
                load: (id) => (id === RESOLVED ? `export default ${JSON.stringify(runtime)};` : null),
              },
              {
                name: "phishguard:package-chunks",
                apply: "build",
                // Vite 8 builds each environment separately; only the browser bundle needs it
                configEnvironment(name) {
                  if (name !== "client") return;
                  return {
                    build: {
                      rolldownOptions: {
                        preserveEntrySignatures: "allow-extension",
                        output: {
                          // one chunk per package, without dragging its dependencies along;
                          // strict ordering keeps the split chunks executing correctly
                          strictExecutionOrder: true,
                          codeSplitting: {
                            includeDependenciesRecursively: false,
                            groups: [
                              { name: "phishguard-agent", test: /phishguard-agent/, priority: 20 },
                              {
                                name: (/** @type {string} */ id) => {
                                  const pkg = packageFromId(id);
                                  return pkg ? `pkg-${encodePackage(pkg)}` : null;
                                },
                                priority: 10,
                              },
                            ],
                          },
                        },
                      },
                    },
                  };
                },
              },
            ],
          },
        });
      },
    },
  };
}
