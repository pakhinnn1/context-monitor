import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ALLOWED_EMAIL_RE = /^(?:\d+\+[^@]+@users\.noreply\.github\.com|noreply@github\.com)$/;
const EMAIL_CANDIDATE_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function buildStructuralRules() {
  // Build regexes dynamically so this source file never triggers its own scan rules.
  const usersPrefix = "/" + "Users" + "/";
  const homePrefix = "/" + "home" + "/";
  const scratchSegment = "scratch" + "/" + "context-monitor";
  return [
    {
      name: "abs-users-path",
      re: new RegExp(usersPrefix + "[A-Za-z0-9._-]+/", "g"),
    },
    {
      name: "abs-home-path",
      re: new RegExp(homePrefix + "[A-Za-z0-9._-]+/", "g"),
    },
    {
      name: "legacy-scratch-path",
      re: new RegExp(scratchSegment, "gi"),
    },
  ];
}

export function parsePatternLines(raw) {
  const rules = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("/")) {
      const lastSlash = line.lastIndexOf("/");
      if (lastSlash > 0) {
        const pattern = line.slice(1, lastSlash);
        const flagsRaw = line.slice(lastSlash + 1);
        const flags = flagsRaw.includes("g") ? flagsRaw : `${flagsRaw}g`;
        rules.push({ name: `local-rule-${i + 1}`, re: new RegExp(pattern, flags) });
        continue;
      }
    }

    const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rules.push({ name: `local-rule-${i + 1}`, re: new RegExp(escaped, "gi") });
  }
  return rules;
}

export function loadLocalPatterns(patternsFile, strictLocal = false) {
  const resolved =
    patternsFile ||
    process.env.CM_PRIVACY_PATTERNS_FILE ||
    path.join(os.homedir(), ".config", "context-monitor", "privacy-patterns.txt");

  if (!fs.existsSync(resolved)) {
    if (strictLocal) {
      throw new Error(`Strict local privacy patterns file not found: ${resolved}`);
    }
    return { path: resolved, present: false, rules: [] };
  }

  const content = fs.readFileSync(resolved, "utf8");
  return { path: resolved, present: true, rules: parsePatternLines(content) };
}

export function scanTextForPrivacy(label, text, extraRules = []) {
  const hits = [];
  const rules = [...buildStructuralRules(), ...extraRules];

  for (const rule of rules) {
    rule.re.lastIndex = 0;
    const match = rule.re.exec(text);
    if (match) {
      hits.push({ label, rule: rule.name });
    }
  }

  EMAIL_CANDIDATE_RE.lastIndex = 0;
  let emailMatch;
  while ((emailMatch = EMAIL_CANDIDATE_RE.exec(text)) !== null) {
    if (!ALLOWED_EMAIL_RE.test(emailMatch[0])) {
      hits.push({ label, rule: "non-noreply-email" });
      break;
    }
  }

  return hits;
}

function tryGit(rootDir, args, opts = {}) {
  try {
    return execFileSync("git", ["-C", rootDir, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    });
  } catch {
    return null;
  }
}

export function runPrivacyScan({
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  files = [],
  range = undefined,
  strictLocal = false,
  patternsFile = undefined,
} = {}) {
  const local = loadLocalPatterns(patternsFile, strictLocal);
  const hits = [];
  let scannedFiles = 0;
  let scannedCommits = 0;
  let scannedObjects = 0;

  if (fs.existsSync(path.join(rootDir, ".git"))) {
    const trackedOut = tryGit(rootDir, ["ls-files", "-z"]);
    if (trackedOut !== null) {
      const tracked = trackedOut.split("\0").filter(Boolean);
      for (const rel of tracked) {
        const full = path.join(rootDir, rel);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
        scannedFiles++;
        const content = fs.readFileSync(full, "utf8");
        hits.push(...scanTextForPrivacy(`tracked:${rel}`, content, local.rules));
      }
    }

    let revRange = range;
    if (!revRange) {
      const hasOriginMain = tryGit(rootDir, ["rev-parse", "--verify", "origin/main"]);
      revRange = hasOriginMain !== null ? "origin/main..HEAD" : "HEAD";
    }

    const logOut = tryGit(rootDir, ["log", revRange, "--format=%H|%an|%ae|%cn|%ce|%s%n%b"]);
    if (logOut) {
      const commitLines = tryGit(rootDir, ["rev-list", revRange]);
      scannedCommits = commitLines ? commitLines.trim().split("\n").filter(Boolean).length : 0;
      hits.push(...scanTextForPrivacy(`git-log:${revRange}`, logOut, local.rules));
    }

    const objList = tryGit(rootDir, ["rev-list", revRange, "--objects"]);
    if (objList && objList.trim()) {
      const oids = objList
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split(" ")[0]);
      scannedObjects = oids.length;
      const batch = tryGit(rootDir, ["cat-file", "--batch"], { input: oids.join("\n") + "\n" });
      if (batch) {
        hits.push(...scanTextForPrivacy(`git-objects:${revRange}`, batch, local.rules));
      }
    }
  }

  for (const filePath of files) {
    const abs = path.resolve(rootDir, filePath);
    if (!fs.existsSync(abs)) {
      throw new Error(`Input file to scan does not exist: ${filePath}`);
    }
    scannedFiles++;
    const content = fs.readFileSync(abs, "utf8");
    hits.push(...scanTextForPrivacy(`file:${filePath}`, content, local.rules));
  }

  return {
    hits,
    scannedFiles,
    scannedCommits,
    scannedObjects,
    localPatternsLoaded: local.present,
  };
}

function parseArgs(argv) {
  const files = [];
  let range;
  let strictLocal = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict-local") {
      strictLocal = true;
    } else if (arg === "--file") {
      if (!argv[i + 1]) throw new Error("--file requires a path argument");
      files.push(argv[++i]);
    } else if (arg.startsWith("--file=")) {
      files.push(arg.slice("--file=".length));
    } else if (arg === "--range") {
      if (!argv[i + 1]) throw new Error("--range requires a revision range argument");
      range = argv[++i];
    } else if (arg.startsWith("--range=")) {
      range = arg.slice("--range=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { files, range, strictLocal };
}

const isCli =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = runPrivacyScan(opts);
    if (result.hits.length > 0) {
      for (const h of result.hits) {
        console.error(`[LEAK] ${h.label}: matched ${h.rule}`);
      }
      process.exit(1);
    }
    console.log(
      `[PASS] Privacy scan clean (files=${result.scannedFiles}, commits=${result.scannedCommits}, objects=${result.scannedObjects}, localPatterns=${result.localPatternsLoaded})`,
    );
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(1);
  }
}
