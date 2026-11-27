import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_EXPECTED_USER = "pakhinnn1";
const DEFAULT_EXPECTED_REMOTE = "https://github.com/pakhinnn1/context-monitor.git";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveGhBin() {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return "gh";
  } catch {
    if (fs.existsSync("/opt/homebrew/bin/gh")) return "/opt/homebrew/bin/gh";
    if (fs.existsSync("/usr/local/bin/gh")) return "/usr/local/bin/gh";
    throw new Error("gh CLI not found in PATH or standard Homebrew locations");
  }
}

export function checkIdentity({
  cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  expectedUser = process.env.CM_EXPECTED_GH_USER || DEFAULT_EXPECTED_USER,
  expectedRemoteUrl = process.env.CM_EXPECTED_REMOTE_URL || DEFAULT_EXPECTED_REMOTE,
  ghBin = resolveGhBin(),
} = {}) {
  const localName = execFileSync("git", ["-C", cwd, "config", "--local", "user.name"], {
    encoding: "utf8",
  }).trim();
  if (localName !== expectedUser) {
    throw new Error(`Local git user.name mismatch: expected "${expectedUser}", got "${localName}"`);
  }

  const localEmail = execFileSync("git", ["-C", cwd, "config", "--local", "user.email"], {
    encoding: "utf8",
  }).trim();
  const noreplyRe = new RegExp(`^\\d+\\+${escapeRegex(expectedUser)}@users\\.noreply\\.github\\.com$`);
  if (!noreplyRe.test(localEmail)) {
    throw new Error(
      `Local git user.email must match <id>+${expectedUser}@users.noreply.github.com, got "${localEmail}"`,
    );
  }

  const remoteUrl = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  if (remoteUrl !== expectedRemoteUrl) {
    throw new Error(`Remote origin URL mismatch: expected "${expectedRemoteUrl}", got "${remoteUrl}"`);
  }

  let token = "";
  try {
    token = execFileSync(ghBin, ["auth", "token", "--user", expectedUser], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(`Failed to obtain scoped gh token for "${expectedUser}": ${err.message}`);
  }
  if (!token) {
    throw new Error(`Empty gh auth token returned for "${expectedUser}"`);
  }

  const apiLogin = execFileSync(ghBin, ["api", "user", "--jq", ".login"], {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (apiLogin !== expectedUser) {
    throw new Error(`Scoped gh api user mismatch: expected "${expectedUser}", got "${apiLogin}"`);
  }

  return { expectedUser, localEmail, remoteUrl, token, ghBin };
}

const isCli =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    const info = checkIdentity();
    console.log(
      `[PASS] Identity verified: ${info.expectedUser} <${info.localEmail}> -> ${info.remoteUrl}`,
    );
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(1);
  }
}
