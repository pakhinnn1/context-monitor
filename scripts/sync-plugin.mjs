import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { copyAllowlistEntry, stageAndValidateRuntime } from "./lib/runtime-stage.mjs";

export function validateSyncTarget(target, rootDir) {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(rootDir);
  const homeDir = path.resolve(os.homedir());
  const forbidden = new Set([
    path.resolve("/"),
    homeDir,
    path.join(homeDir, ".gemini"),
    path.join(homeDir, ".gemini", "config"),
    path.join(homeDir, ".gemini", "config", "plugins"),
    resolvedRoot,
  ]);

  if (path.basename(resolvedTarget) !== "context-monitor") {
    throw new Error(`Sync target basename must be "context-monitor", got "${resolvedTarget}"`);
  }
  if (forbidden.has(resolvedTarget)) {
    throw new Error(`Refusing unsafe sync target: "${resolvedTarget}"`);
  }
  const relFromTarget = path.relative(resolvedTarget, resolvedRoot);
  if (relFromTarget && !relFromTarget.startsWith("..") && !path.isAbsolute(relFromTarget)) {
    throw new Error(`Refusing sync target that is an ancestor of repo root: "${resolvedTarget}"`);
  }

  return resolvedTarget;
}

export function hashTree(dirPath) {
  const hashes = new Map();
  if (!fs.existsSync(dirPath)) return hashes;

  function walk(cur) {
    const entries = fs
      .readdirSync(cur, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(dirPath, full).split(path.sep).join("/");
        const digest = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
        hashes.set(rel, digest);
      }
    }
  }
  walk(dirPath);
  return hashes;
}

export function diffHashMaps(stagedMap, targetMap) {
  const added = [];
  const updated = [];
  const unchanged = [];
  const removed = [];

  for (const [rel, hash] of stagedMap.entries()) {
    if (!targetMap.has(rel)) {
      added.push(rel);
    } else if (targetMap.get(rel) !== hash) {
      updated.push(rel);
    } else {
      unchanged.push(rel);
    }
  }
  for (const rel of targetMap.keys()) {
    if (!stagedMap.has(rel)) {
      removed.push(rel);
    }
  }

  return { added, updated, unchanged, removed };
}

export function syncPlugin({
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  target = path.join(os.homedir(), ".gemini", "config", "plugins", "context-monitor"),
  dryRun = false,
  skipBuild = false,
  agyBin = "agy",
  validateFn = null,
} = {}) {
  const resolvedTarget = validateSyncTarget(target, rootDir);
  const staged = stageAndValidateRuntime(rootDir, { skipBuild, agyBin, validateFn });

  try {
    const stagedMap = hashTree(staged.stagedDir);
    const beforeMap = hashTree(resolvedTarget);
    const diff = diffHashMaps(stagedMap, beforeMap);

    if (dryRun) {
      return {
        version: staged.version,
        target: resolvedTarget,
        dryRun: true,
        diff,
      };
    }

    const parentDir = path.dirname(resolvedTarget);
    fs.mkdirSync(parentDir, { recursive: true });
    const siblingTemp = fs.mkdtempSync(path.join(parentDir, ".context-monitor-sync-"));
    const siblingBackup = fs.existsSync(resolvedTarget)
      ? path.join(parentDir, `.context-monitor-backup-${Date.now()}-${process.pid}`)
      : null;

    try {
      for (const entry of fs.readdirSync(staged.stagedDir)) {
        copyAllowlistEntry(path.join(staged.stagedDir, entry), path.join(siblingTemp, entry));
      }

      if (siblingBackup) {
        fs.renameSync(resolvedTarget, siblingBackup);
      }
      try {
        fs.renameSync(siblingTemp, resolvedTarget);
      } catch (swapErr) {
        if (siblingBackup && fs.existsSync(siblingBackup) && !fs.existsSync(resolvedTarget)) {
          fs.renameSync(siblingBackup, resolvedTarget);
        }
        throw swapErr;
      }

      if (siblingBackup && fs.existsSync(siblingBackup)) {
        fs.rmSync(siblingBackup, { recursive: true, force: true });
      }
    } catch (err) {
      fs.rmSync(siblingTemp, { recursive: true, force: true });
      throw err;
    }

    const afterMap = hashTree(resolvedTarget);
    const postDiff = diffHashMaps(stagedMap, afterMap);
    if (postDiff.added.length || postDiff.updated.length || postDiff.removed.length) {
      throw new Error(`Post-sync verification detected non-zero diff: ${JSON.stringify(postDiff)}`);
    }

    return {
      version: staged.version,
      target: resolvedTarget,
      dryRun: false,
      diff,
    };
  } finally {
    staged.cleanup();
  }
}

function parseArgs(argv) {
  let dryRun = false;
  let target;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--target") {
      if (!argv[i + 1]) throw new Error("--target requires a directory path");
      target = argv[++i];
    } else if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { dryRun, ...(target ? { target } : {}) };
}

const isCli =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const res = syncPlugin(opts);
    const { added, updated, unchanged, removed } = res.diff;
    console.log(`[${res.dryRun ? "DRY-RUN" : "SYNCED"}] v${res.version} -> ${res.target}`);
    console.log(
      `added=${added.length} updated=${updated.length} unchanged=${unchanged.length} removed=${removed.length}`,
    );
    for (const f of added) console.log(`  + ${f}`);
    for (const f of updated) console.log(`  ~ ${f}`);
    for (const f of removed) console.log(`  - ${f}`);
    if (!res.dryRun) {
      console.log("");
      console.log("Manual reload required:");
      console.log(
        "  Open Antigravity Desktop settings -> MCP Servers -> reload context-monitor_context-monitor.",
      );
    }
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(1);
  }
}
