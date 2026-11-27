import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

export const MAX_APP_HTML_BYTES = 1024 * 1024;

export function assertAppHtmlSize(html, limitBytes = MAX_APP_HTML_BYTES) {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes >= limitBytes) {
    throw new Error(
      `dist/app.html size ${bytes} bytes meets or exceeds limit of ${limitBytes} bytes`,
    );
  }
  return bytes;
}

export async function buildBundles(
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
) {
  const distDir = path.join(rootDir, "dist");
  fs.mkdirSync(distDir, { recursive: true });

  // 1. Bundle client UI JS into memory (including @modelcontextprotocol/ext-apps and interestfor)
  const uiJsResult = await esbuild.build({
    entryPoints: [path.join(rootDir, "src", "ui", "main.js")],
    bundle: true,
    format: "esm",
    target: ["es2022"],
    minify: true,
    write: false,
    legalComments: "none",
  });

  const uiCssResult = await esbuild.build({
    entryPoints: [path.join(rootDir, "src", "ui", "styles.css")],
    bundle: true,
    minify: true,
    write: false,
    legalComments: "none",
  });

  const htmlTemplate = fs.readFileSync(path.join(rootDir, "src", "ui", "index.html"), "utf8");

  // Escape </script> inside inlined JS just in case
  const safeJs = uiJsResult.outputFiles[0].text.replace(/<\/script>/gi, "<\\/script>");
  const safeCss = uiCssResult.outputFiles[0].text.replace(/<\/style>/gi, "<\\/style>");

  const singleFileHtml = htmlTemplate
    .replace("/* __INLINE_CSS__ */", () => safeCss)
    .replace("/* __INLINE_JS__ */", () => safeJs);

  const htmlBytes = assertAppHtmlSize(singleFileHtml);
  fs.writeFileSync(path.join(distDir, "app.html"), singleFileHtml, "utf8");

  // 2. Bundle MCP server as standalone ESM so installed plugin needs no node_modules
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src", "server.mjs")],
    outfile: path.join(distDir, "server.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: ["node20"],
    minify: false,
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });

  const serverBytes = fs.statSync(path.join(distDir, "server.mjs")).size;
  return { htmlBytes, serverBytes };
}

const isCli =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    const { htmlBytes, serverBytes } = await buildBundles();
    console.log(
      `Built dist/app.html (${(htmlBytes / 1024).toFixed(1)} KiB) and dist/server.mjs (${(serverBytes / 1024).toFixed(1)} KiB)`,
    );
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(1);
  }
}
