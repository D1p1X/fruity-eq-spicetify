import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "index.js");
const stylePath = resolve(root, "style.css");
const manifestPath = resolve(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const source = await readFile(sourcePath, "utf8");
const style = await readFile(stylePath, "utf8");

const syntax = spawnSync(process.execPath, ["--check", sourcePath], { encoding: "utf8" });
if (syntax.status !== 0) throw new Error(`index.js has a syntax error:\n${syntax.stderr || syntax.stdout}`);

const bridgeServerPath = resolve(root, "bridge", "server.mjs");
const bridgeMacPath = resolve(root, "bridge", "macos", "FruityEQAudioBridge.swift");
const requiredManifestFields = ["name", "description", "preview", "readme", "icon", "active-icon"];
const missing = requiredManifestFields.filter((field) => !manifest[field]);
if (missing.length) throw new Error(`manifest.json is missing: ${missing.join(", ")}`);
if (!Array.isArray(manifest.authors) || !manifest.authors.length || !manifest.authors.every((author) => author?.name && author?.url?.startsWith("https://"))) {
  throw new Error("manifest.json requires Marketplace author names with HTTPS profile URLs");
}
if (!Array.isArray(manifest.tags) || manifest.tags.length < 2) throw new Error("manifest.json needs Marketplace tags");

await access(resolve(root, manifest.preview));
await access(resolve(root, manifest.readme));
const preview = await readFile(resolve(root, manifest.preview));
if (preview.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Marketplace preview must be a PNG");

for (const requiredSourcePart of ["const render = () => h(FruityEq);", "getFrequencyResponse", "BandFader", "attachAudioEngine", "attachSystemAudioEngine", "setSinkId", "bridgeRequest", "Start real-time EQ"]) {
  if (!source.includes(requiredSourcePart)) throw new Error(`index.js is missing required implementation: ${requiredSourcePart}`);
}
await access(bridgeServerPath);
await access(bridgeMacPath);
const bridgeSyntax = spawnSync(process.execPath, ["--check", bridgeServerPath], { encoding: "utf8" });
if (bridgeSyntax.status !== 0) throw new Error(`bridge/server.mjs has a syntax error:\n${bridgeSyntax.stderr || bridgeSyntax.stdout}`);
if (/\bfetch\s*\(/.test(source) && (!source.includes('const BRIDGE_URL = "http://127.0.0.1:24680"') || !source.includes("fetch(`${BRIDGE_URL}${path}`"))) throw new Error("Fruity EQ may only fetch its fixed loopback bridge URL");
if (/\bwindow\.open\s*\(/.test(source)) throw new Error("Fruity EQ must remain in the single Spotify window");
if (!style.includes(".feq-app") || !style.includes(".feq-main")) throw new Error("style.css is missing the Studio shell styles");

console.log(`✓ ${manifest.name}: syntax, preset UI, response model and Marketplace metadata are valid.`);
