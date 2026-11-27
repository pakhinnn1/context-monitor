import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateWorkspaceDir } from "./analyzer.mjs";

const PREFS_FILENAME = "preferences.json";
const MAX_PREFS_BYTES = 4096;

/**
 * Resolves the plugin data directory from CLI flags (`--data-dir=...` or
 * `--data-dir <path>`) or `CONTEXT_MONITOR_DATA_DIR`, returning `null` if
 * missing, empty, or containing an unexpanded `${PLUGIN_DATA}` placeholder.
 */
export function resolveDataDir(argv = process.argv.slice(2), env = process.env) {
  let raw = "";
  if (Array.isArray(argv)) {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (typeof arg !== "string") continue;
      if (arg.startsWith("--data-dir=")) {
        raw = arg.slice("--data-dir=".length);
      } else if (arg === "--data-dir" && i + 1 < argv.length && typeof argv[i + 1] === "string") {
        raw = argv[i + 1];
        i += 1;
      }
    }
  }

  if (!raw && typeof env?.CONTEXT_MONITOR_DATA_DIR === "string") {
    raw = env.CONTEXT_MONITOR_DATA_DIR;
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("${PLUGIN_DATA}")) {
    return null;
  }

  return path.resolve(trimmed);
}

/**
 * Loads validated user preferences from `<dataDir>/preferences.json`, falling
 * back cleanly to defaults when absent, oversized, or malformed.
 */
export function loadPreferences(dataDir) {
  const persisted = Boolean(dataDir);
  const defaults = {
    workspacePath: null,
    includeSubagents: false,
    persisted,
  };
  if (!dataDir) return defaults;

  const filePath = path.join(dataDir, PREFS_FILENAME);
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size > MAX_PREFS_BYTES) {
      return defaults;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_PREFS_BYTES) {
      return defaults;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return defaults;
    }

    const workspacePath =
      typeof parsed.workspacePath === "string" ? validateWorkspaceDir(parsed.workspacePath) : null;
    const includeSubagents =
      typeof parsed.includeSubagents === "boolean" ? parsed.includeSubagents : false;

    return {
      workspacePath,
      includeSubagents,
      persisted: true,
    };
  } catch {
    return defaults;
  }
}

/**
 * Validates and persists a partial preference update atomically to
 * `<dataDir>/preferences.json`, or keeps state in-memory when `dataDir` is null.
 */
export function savePreferences(dataDir, patch = {}, base = null) {
  const baseline = base ?? loadPreferences(dataDir);

  let workspacePath = baseline.workspacePath;
  if (patch.workspacePath !== undefined) {
    if (patch.workspacePath === null) {
      workspacePath = null;
    } else if (typeof patch.workspacePath === "string") {
      const validated = validateWorkspaceDir(patch.workspacePath);
      if (!validated) {
        throw new Error(
          "Invalid workspacePath: must be an existing directory other than filesystem root or home directory.",
        );
      }
      workspacePath = validated;
    } else {
      throw new Error("Invalid workspacePath: expected string or null.");
    }
  }

  let includeSubagents = baseline.includeSubagents;
  if (patch.includeSubagents !== undefined) {
    if (typeof patch.includeSubagents === "boolean") {
      includeSubagents = patch.includeSubagents;
    } else {
      throw new Error("Invalid includeSubagents: expected boolean.");
    }
  }

  const payload = {
    version: 1,
    workspacePath,
    includeSubagents,
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (Buffer.byteLength(json, "utf8") > MAX_PREFS_BYTES) {
    throw new Error("Preferences payload exceeds 4096 byte limit.");
  }

  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    const targetPath = path.join(dataDir, PREFS_FILENAME);
    const tmpPath = path.join(
      dataDir,
      `${PREFS_FILENAME}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
    );
    try {
      fs.writeFileSync(tmpPath, json, "utf8");
      fs.renameSync(tmpPath, targetPath);
    } catch (err) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup failure
      }
      throw err;
    }
  }

  return {
    workspacePath,
    includeSubagents,
    persisted: Boolean(dataDir),
  };
}
