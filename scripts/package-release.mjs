import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RUNTIME_ALLOWLIST,
  copyAllowlistEntry,
  runAgyStrictValidate,
  stageAndValidateRuntime,
} from "./lib/runtime-stage.mjs";

const ALLOWLIST_SET = new Set(RUNTIME_ALLOWLIST);

export function validateReleaseZipEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Release archive contains no entries");
  }
  for (const entry of entries) {
    if (!entry.startsWith("context-monitor/")) {
      throw new Error(`Archive entry escapes context-monitor/ root: "${entry}"`);
    }
    if (entry.includes("__MACOSX") || path.posix.basename(entry) === ".DS_Store") {
      throw new Error(`Archive contains forbidden macOS metadata entry: "${entry}"`);
    }
    if (entry === "context-monitor/") continue;
    const remainder = entry.slice("context-monitor/".length);
    const topSegment = remainder.split("/")[0];
    if (!ALLOWLIST_SET.has(topSegment)) {
      throw new Error(`Archive contains non-allowlist entry: "${entry}"`);
    }
  }
  return true;
}

function clampMtimesRecursive(targetPath, epochSec) {
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      clampMtimesRecursive(path.join(targetPath, entry), epochSec);
    }
  }
  fs.utimesSync(targetPath, epochSec, epochSec);
}

export function packageRelease({
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  outDir = undefined,
  skipBuild = false,
  agyBin = "agy",
  validateFn = null,
  epochSec = undefined,
} = {}) {
  const zipBin = "/usr/bin/zip";
  if (!fs.existsSync(zipBin)) {
    throw new Error(`Required macOS zip binary not found at ${zipBin}`);
  }
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
  } catch {
    throw new Error("Required unzip CLI not found in PATH");
  }

  const commitEpoch =
    epochSec ??
    Number(
      execFileSync("git", ["-C", rootDir, "log", "-1", "--format=%ct"], {
        encoding: "utf8",
      }).trim(),
    );
  if (!Number.isFinite(commitEpoch) || commitEpoch <= 0) {
    throw new Error(`Invalid HEAD commit epoch: ${commitEpoch}`);
  }

  const resolvedOutDir = path.resolve(rootDir, outDir || "release");
  const staged = stageAndValidateRuntime(rootDir, { skipBuild, agyBin, validateFn });
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), "context-monitor-pkg-"));

  try {
    const wrappedDir = path.join(tmpParent, "context-monitor");
    fs.mkdirSync(wrappedDir, { recursive: true });
    for (const entry of fs.readdirSync(staged.stagedDir)) {
      copyAllowlistEntry(path.join(staged.stagedDir, entry), path.join(wrappedDir, entry));
    }
    clampMtimesRecursive(wrappedDir, commitEpoch);

    fs.mkdirSync(resolvedOutDir, { recursive: true });
    const zipName = `context-monitor-v${staged.version}.zip`;
    const zipPath = path.join(resolvedOutDir, zipName);
    fs.rmSync(zipPath, { force: true });

    execFileSync(zipBin, ["-r", "-X", "-q", zipPath, "context-monitor"], {
      cwd: tmpParent,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: "inherit",
    });

    const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    validateReleaseZipEntries(entries);

    const validation = validateFn
      ? validateFn(zipPath)
      : runAgyStrictValidate(zipPath, agyBin);

    const digest = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
    const shaPath = `${zipPath}.sha256`;
    fs.writeFileSync(shaPath, `${digest}  ${zipName}\n`, "utf8");

    return {
      version: staged.version,
      zipPath,
      shaPath,
      digest,
      entries,
      validation,
    };
  } finally {
    fs.rmSync(tmpParent, { recursive: true, force: true });
    staged.cleanup();
  }
}

function parseArgs(argv) {
  let outDir;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      if (!argv[i + 1]) throw new Error("--out-dir requires a directory path");
      outDir = argv[++i];
    } else if (arg.startsWith("--out-dir=")) {
      outDir = arg.slice("--out-dir=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return outDir ? { outDir } : {};
}

const isCli =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const res = packageRelease(opts);
    console.log(`[PASS] Packaged ${res.zipPath} (${res.entries.length} entries)`);
    console.log(`[PASS] SHA-256: ${res.digest} -> ${res.shaPath}`);
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(1);
  }
}
