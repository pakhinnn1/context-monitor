import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkIdentity } from "./check-identity.mjs";

const isCli =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isCli) {
  let identity;
  try {
    identity = checkIdentity();
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const res = spawnSync(identity.ghBin, args, {
    stdio: "inherit",
    env: { ...process.env, GH_TOKEN: identity.token },
  });

  if (res.error) {
    console.error(`[FAIL] Failed to spawn ${identity.ghBin}: ${res.error.message}`);
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}
