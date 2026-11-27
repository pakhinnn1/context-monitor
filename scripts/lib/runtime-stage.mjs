import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const RUNTIME_ALLOWLIST = ["plugin.json", "mcp_config.json", "README.md", "assets", "dist"];
export const MAX_APP_HTML_BYTES = 1024 * 1024;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectMatches(content, regex) {
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  const values = [];
  let match;
  while ((match = re.exec(content)) !== null) {
    values.push(match[1]);
  }
  return values;
}

export function assertVersionParity(rootDir) {
  const pkg = readJson(path.join(rootDir, "package.json"));
  const version = pkg.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid package.json version: ${version}`);
  }

  const lock = readJson(path.join(rootDir, "package-lock.json"));
  if (lock.version !== version || lock.packages?.[""]?.version !== version) {
    throw new Error(
      `package-lock.json version mismatch: root=${lock.version}, packages[""]=${lock.packages?.[""]?.version}, expected=${version}`,
    );
  }

  const plugin = readJson(path.join(rootDir, "plugin.json"));
  if (plugin.version !== version) {
    throw new Error(`plugin.json version mismatch: got ${plugin.version}, expected ${version}`);
  }

  const readmeLines = fs.readFileSync(path.join(rootDir, "README.md"), "utf8").split(/\r?\n/);
  const line3 = readmeLines[2] || "";
  const readmeMatches = collectMatches(line3, /\(`v([0-9]+\.[0-9]+\.[0-9]+)`\)/g);
  if (readmeMatches.length !== 1 || readmeMatches[0] !== version) {
    throw new Error(
      `README.md line 3 version mismatch: matches=${JSON.stringify(readmeMatches)}, expected=${version}`,
    );
  }

  const serverSrc = fs.readFileSync(path.join(rootDir, "src", "server.mjs"), "utf8");
  const serverMatches = collectMatches(serverSrc, /new\s+McpServer\([\s\S]*?version:\s*"([^"]+)"/g);
  if (serverMatches.length !== 1 || serverMatches[0] !== version) {
    throw new Error(
      `src/server.mjs version mismatch: matches=${JSON.stringify(serverMatches)}, expected=${version}`,
    );
  }

  const mainJsSrc = fs.readFileSync(path.join(rootDir, "src", "ui", "main.js"), "utf8");
  const mainJsMatches = collectMatches(mainJsSrc, /new\s+App\(\{[^}]*version:\s*"([^"]+)"/g);
  if (mainJsMatches.length !== 1 || mainJsMatches[0] !== version) {
    throw new Error(
      `src/ui/main.js version mismatch: matches=${JSON.stringify(mainJsMatches)}, expected=${version}`,
    );
  }

  const testServerSrc = fs.readFileSync(path.join(rootDir, "scripts", "test-server.mjs"), "utf8");
  const clientMatches = collectMatches(
    testServerSrc,
    /new\s+Client\([\s\S]*?version:\s*"([^"]+)"/g,
  );
  if (clientMatches.length !== 3 || clientMatches.some((v) => v !== version)) {
    throw new Error(
      `scripts/test-server.mjs Client version mismatch: matches=${JSON.stringify(clientMatches)} (expected 3x ${version})`,
    );
  }

  return version;
}

export function copyAllowlistEntry(srcPath, destPath) {
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    for (const entry of fs.readdirSync(srcPath, { withFileTypes: true })) {
      if (entry.name === ".DS_Store" || entry.name === "__MACOSX") continue;
      copyAllowlistEntry(path.join(srcPath, entry.name), path.join(destPath, entry.name));
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }
}

export function runAgyStrictValidate(targetPath, agyBin = "agy") {
  let stdout;
  try {
    stdout = execFileSync(agyBin, ["plugin", "validate", targetPath, "--strict", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("agy CLI not found in PATH");
    }
    const detail = err.stdout || err.stderr || err.message;
    throw new Error(`agy plugin validate failed: ${detail}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to parse agy plugin validate JSON output: ${err.message}`);
  }
  if (!Array.isArray(parsed.findings) || parsed.findings.length !== 0) {
    throw new Error(`agy plugin validate reported findings: ${JSON.stringify(parsed.findings)}`);
  }
  return parsed;
}

export function stageAndValidateRuntime(
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
  { skipBuild = false, agyBin = "agy", validateFn = null } = {},
) {
  if (!skipBuild) {
    const buildPath = path.join(rootDir, "scripts", "build.mjs");
    execFileSync(process.execPath, [buildPath], { cwd: rootDir, stdio: "inherit" });
  }

  const version = assertVersionParity(rootDir);
  const stagedDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-monitor-stage-"));
  const cleanup = () => {
    fs.rmSync(stagedDir, { recursive: true, force: true });
  };

  try {
    for (const entry of RUNTIME_ALLOWLIST) {
      const src = path.join(rootDir, entry);
      if (!fs.existsSync(src)) {
        throw new Error(`Missing required allowlist entry: ${entry}`);
      }
      copyAllowlistEntry(src, path.join(stagedDir, entry));
    }

    const appHtmlPath = path.join(stagedDir, "dist", "app.html");
    const appHtmlBytes = Buffer.byteLength(fs.readFileSync(appHtmlPath, "utf8"), "utf8");
    if (appHtmlBytes >= MAX_APP_HTML_BYTES) {
      throw new Error(
        `Staged dist/app.html size ${appHtmlBytes} bytes meets or exceeds ${MAX_APP_HTML_BYTES} bytes`,
      );
    }

    const validation = validateFn ? validateFn(stagedDir) : runAgyStrictValidate(stagedDir, agyBin);

    return { version, stagedDir, appHtmlBytes, validation, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

const isCli =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isCli) {
  let staged;
  try {
    staged = stageAndValidateRuntime();
    console.log(
      `[PASS] Validated runtime bundle v${staged.version} (dist/app.html=${staged.appHtmlBytes} bytes, findings=0)`,
    );
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(1);
  } finally {
    staged?.cleanup();
  }
}
