// @ts-check
/**
 * `npm run security:hub` — start the PhishGuard hub on the first free port
 * from integrations/phishguard-ports.mjs instead of failing with EADDRINUSE.
 *
 *   npm run security:hub                 first free port from the list
 *   npm run security:hub -- --port 5000  exactly this port (no fallback)
 *   npm run security:hub -- --no-open    any other flag goes to `phishguard dashboard`
 */
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { hubPorts } from "../integrations/phishguard-ports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const bin = path.join(path.dirname(require.resolve("phishguard/package.json")), "bin", "phishguard.js");
const args = process.argv.slice(2);

/** @param {number} port */
function isFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

/** Is a PhishGuard hub *for this project* answering on this port? */
async function isOurHub(/** @type {number} */ port, /** @type {string} */ key) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/agent/policy`, {
      headers: { "x-phishguard-agent-key": key },
      signal: AbortSignal.timeout(900),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function agentKey() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "phishguard.config.json"), "utf8")).agentKey ?? "";
  } catch {
    return "";
  }
}

async function main() {
  let port;
  const explicit = args.indexOf("--port");
  if (explicit >= 0) {
    port = Number(args[explicit + 1]);
  } else {
    const ports = hubPorts(root);
    const key = agentKey();
    const busy = [];
    for (const p of ports) {
      if (await isFree(p)) {
        port = p;
        break;
      }
      busy.push(p);
      if (key && (await isOurHub(p, key))) {
        console.log(`  ! a PhishGuard hub for this project is already running on port ${p}`);
        console.log(`    (its dashboard link is in the terminal that started it — stop it with Ctrl+C there)`);
      }
    }
    if (port === undefined) {
      console.error(`  error: every hub port is in use (${ports.join(", ")}).`);
      console.error(`  Free one, set PHISHGUARD_PORTS=5000,5001 or add "hubPorts" to phishguard.config.json.`);
      process.exit(1);
    }
    if (busy.length) console.log(`  port${busy.length > 1 ? "s" : ""} ${busy.join(", ")} busy → using ${port}\n`);
    args.push("--port", String(port));
  }

  const child = spawn(process.execPath, [bin, "dashboard", ...args], { cwd: root, stdio: "inherit" });
  const forward = (/** @type {NodeJS.Signals} */ sig) => child.kill(sig);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

main();
