import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { assertAppHtmlSize, MAX_APP_HTML_BYTES } from "./build.mjs";
import { assertVersionParity } from "./lib/runtime-stage.mjs";
import { syncPlugin, validateSyncTarget } from "./sync-plugin.mjs";
import { scanTextForPrivacy, runPrivacyScan } from "./check-privacy.mjs";
import { validateReleaseZipEntries } from "./package-release.mjs";

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createSyncedFixture(rootDir, version = "0.2.0") {
  fs.mkdirSync(path.join(rootDir, "src", "ui"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "dist"), { recursive: true });

  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "context-monitor", version }, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, "package-lock.json"),
    JSON.stringify({ name: "context-monitor", version, packages: { "": { version } } }, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, "plugin.json"),
    JSON.stringify({ name: "context-monitor", version }, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, "mcp_config.json"),
    JSON.stringify({ mcpServers: { "context-monitor": { command: "node", args: ["${PLUGIN_ROOT}/dist/server.mjs"] } } }),
  );
  fs.writeFileSync(
    path.join(rootDir, "README.md"),
    `# Antigravity Context Monitor\n\nLocal MCP App plugin (\`v${version}\`) for Antigravity Desktop.\n`,
  );
  fs.writeFileSync(path.join(rootDir, "assets", "logo.svg"), "<svg></svg>");
  fs.writeFileSync(path.join(rootDir, "dist", "app.html"), "<html></html>");
  fs.writeFileSync(path.join(rootDir, "dist", "server.mjs"), "// server\n");
  fs.writeFileSync(
    path.join(rootDir, "src", "server.mjs"),
    `const server = new McpServer({ name: "context-monitor", version: "${version}" });\n`,
  );
  fs.writeFileSync(
    path.join(rootDir, "src", "ui", "main.js"),
    `const app = new App({ name: "Context Monitor", version: "${version}" }, {});\n`,
  );
  fs.writeFileSync(
    path.join(rootDir, "scripts", "test-server.mjs"),
    [
      `const c1 = new Client({ name: "t1", version: "${version}" });`,
      `const c2 = new Client({ name: "t2", version: "${version}" });`,
      `const c3 = new Client({ name: "t3", version: "${version}" });`,
    ].join("\n"),
  );
}

describe("Tooling Suite 1: Build 1 MiB ceiling", () => {
  it("accepts HTML below 1 MiB and throws at or above 1048576 bytes", () => {
    const okHtml = "a".repeat(1024);
    assert.equal(assertAppHtmlSize(okHtml), 1024);

    const exactLimit = "a".repeat(MAX_APP_HTML_BYTES);
    assert.throws(() => assertAppHtmlSize(exactLimit), /exceeds limit/);
  });
});

describe("Tooling Suite 2: Seven-file version parity", () => {
  it("passes on a synced fixture and rejects README, lockfile, or JS mismatches", () => {
    const tmp = makeTempDir("cm-parity-");
    try {
      createSyncedFixture(tmp, "0.2.0");
      assert.equal(assertVersionParity(tmp), "0.2.0");

      // Mismatch README line 3
      const origReadme = fs.readFileSync(path.join(tmp, "README.md"), "utf8");
      fs.writeFileSync(path.join(tmp, "README.md"), "# Title\n\nNo version badge\n");
      assert.throws(() => assertVersionParity(tmp), /README\.md/);
      fs.writeFileSync(path.join(tmp, "README.md"), origReadme);

      // Mismatch package-lock.json
      const origLock = fs.readFileSync(path.join(tmp, "package-lock.json"), "utf8");
      fs.writeFileSync(
        path.join(tmp, "package-lock.json"),
        JSON.stringify({ version: "0.1.0", packages: { "": { version: "0.2.0" } } }),
      );
      assert.throws(() => assertVersionParity(tmp), /package-lock\.json/);
      fs.writeFileSync(path.join(tmp, "package-lock.json"), origLock);

      // Zero-match JS file
      fs.writeFileSync(path.join(tmp, "src", "ui", "main.js"), "const app = {};\n");
      assert.throws(() => assertVersionParity(tmp), /main\.js/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("Tooling Suite 3: Sync target safety and atomic swap", () => {
  it("rejects unsafe sync targets", () => {
    const repo = "/tmp/fake-cm-repo";
    const home = os.homedir();
    assert.throws(() => validateSyncTarget("/", repo), /basename|unsafe/);
    assert.throws(() => validateSyncTarget(home, repo), /basename|unsafe/);
    assert.throws(() => validateSyncTarget(path.join(home, ".gemini", "config", "plugins"), repo), /basename|unsafe/);
    assert.throws(() => validateSyncTarget("/tmp/other-name", repo), /basename/);
    assert.throws(() => validateSyncTarget("/tmp/context-monitor", "/tmp/context-monitor"), /unsafe/);
  });

  it("handles missing target dry-run and removes stale non-allowlist files on atomic apply", () => {
    const tmp = makeTempDir("cm-sync-");
    try {
      const repoDir = path.join(tmp, "repo");
      const targetDir = path.join(tmp, "plugins", "context-monitor");
      createSyncedFixture(repoDir, "0.2.0");

      const mockValidate = () => ({ findings: [] });

      const dryRes = syncPlugin({
        rootDir: repoDir,
        target: targetDir,
        dryRun: true,
        skipBuild: true,
        validateFn: mockValidate,
      });
      assert.equal(dryRes.dryRun, true);
      assert.ok(dryRes.diff.added.includes("plugin.json"));
      assert.equal(fs.existsSync(targetDir), false);

      // Pre-populate target with stale file and dotfile
      fs.mkdirSync(path.join(targetDir, "docs"), { recursive: true });
      fs.writeFileSync(path.join(targetDir, "docs", "stale.md"), "stale");
      fs.writeFileSync(path.join(targetDir, ".DS_Store"), "junk");

      const applyRes = syncPlugin({
        rootDir: repoDir,
        target: targetDir,
        dryRun: false,
        skipBuild: true,
        validateFn: mockValidate,
      });
      assert.equal(applyRes.dryRun, false);
      assert.ok(applyRes.diff.removed.includes("docs/stale.md"));
      assert.equal(fs.existsSync(path.join(targetDir, "docs", "stale.md")), false);
      assert.equal(fs.existsSync(path.join(targetDir, ".DS_Store")), false);
      assert.equal(fs.existsSync(path.join(targetDir, "dist", "app.html")), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("Tooling Suite 4: Privacy scanner rules", () => {
  it("catches host paths, legacy scratch paths, and personal emails while allowing noreply", () => {
    const fakeHome = ["/", "Users", "/alice/project"].join("");
    const fakeScratch = ["scratch", "/context-monitor"].join("");
    const fakeEmail = ["alice", "@example.com"].join("");

    assert.equal(scanTextForPrivacy("t1", fakeHome).length > 0, true);
    assert.equal(scanTextForPrivacy("t2", fakeScratch).length > 0, true);
    assert.equal(scanTextForPrivacy("t3", fakeEmail).length > 0, true);

    const allowedNoreply = "359503387+pakhinnn1@users.noreply.github.com";
    assert.deepEqual(scanTextForPrivacy("t4", allowedNoreply), []);
  });

  it("enforces --strict-local when pattern file is missing", () => {
    const tmp = makeTempDir("cm-priv-");
    try {
      const sample = path.join(tmp, "note.md");
      fs.writeFileSync(sample, "clean text\n");
      assert.throws(
        () =>
          runPrivacyScan({
            rootDir: tmp,
            files: [sample],
            strictLocal: true,
            patternsFile: path.join(tmp, "missing-patterns.txt"),
          }),
        /not found/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("Tooling Suite 5: Release archive entry validator", () => {
  it("allows bare context-monitor/ plus allowlist entries and rejects extra or macOS metadata entries", () => {
    assert.equal(
      validateReleaseZipEntries([
        "context-monitor/",
        "context-monitor/plugin.json",
        "context-monitor/mcp_config.json",
        "context-monitor/README.md",
        "context-monitor/assets/logo.svg",
        "context-monitor/dist/app.html",
        "context-monitor/dist/server.mjs",
      ]),
      true,
    );

    assert.throws(
      () => validateReleaseZipEntries(["plugin.json"]),
      /escapes context-monitor\/ root/,
    );
    assert.throws(
      () => validateReleaseZipEntries(["context-monitor/", "context-monitor/src/server.mjs"]),
      /non-allowlist/,
    );
    assert.throws(
      () => validateReleaseZipEntries(["context-monitor/", "context-monitor/__MACOSX/foo"]),
      /macOS metadata/,
    );
    assert.throws(
      () => validateReleaseZipEntries(["context-monitor/", "context-monitor/.DS_Store"]),
      /macOS metadata/,
    );
  });
});
