#!/usr/bin/env node
/* Local-only controller for the optional Fruity EQ native audio bridge. */
import http from "node:http";
import { mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.FRUITY_EQ_BRIDGE_PORT || 24680);
const host = "127.0.0.1";
const cache = join(process.env.SPICETIFY_CONFIG || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "spicetify"), "fruity-eq-bridge");
const macSource = join(root, "bridge", "macos", "FruityEQAudioBridge.swift");
const macBinary = join(cache, "fruity-eq-audio-bridge");
const allowedOrigins = new Set(["https://xpui.app.spotify.com", "https://open.spotify.com"]);

let child;
let bridgeState = { state: "idle", detail: "Native bridge is ready to start" };
let outputBuffer = "";

const json = (response, status, body) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "https://xpui.app.spotify.com",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
};

const validBand = (band) => band && typeof band === "object"
  && Number.isFinite(Number(band.frequency)) && Number(band.frequency) >= 20 && Number(band.frequency) <= 20_000
  && Number.isFinite(Number(band.gain)) && Number(band.gain) >= -12 && Number(band.gain) <= 12
  && Number.isFinite(Number(band.q)) && Number(band.q) >= .15 && Number(band.q) <= 12
  && ["highpass", "lowshelf", "peaking", "notch", "highshelf", "lowpass", "bandpass", "allpass"].includes(band.type);

const readBody = async (request) => {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32_768) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const compileMacBridge = async () => {
  await mkdir(cache, { recursive: true });
  const sourceInfo = await stat(macSource);
  const binaryInfo = existsSync(macBinary) ? await stat(macBinary) : undefined;
  if (binaryInfo?.mtimeMs >= sourceInfo.mtimeMs) return;
  const result = spawnSync("swiftc", ["-O", "-framework", "AudioToolbox", "-framework", "CoreAudio", macSource, "-o", macBinary], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Swift bridge build failed: ${(result.stderr || result.stdout).trim()}`);
};

const receiveBridgeMessage = (chunk) => {
  outputBuffer += chunk;
  let newline;
  while ((newline = outputBuffer.indexOf("\n")) >= 0) {
    const line = outputBuffer.slice(0, newline).trim();
    outputBuffer = outputBuffer.slice(newline + 1);
    if (!line.startsWith("{")) continue;
    try { bridgeState = { ...bridgeState, ...JSON.parse(line) }; } catch { /* Ignore native diagnostics that are not JSON. */ }
  }
};

const startBridge = async ({ input = "BlackHole 2ch", output = "Reproduktory MacBook Air" } = {}) => {
  if (child && !child.killed) return bridgeState;
  if (process.platform !== "darwin") {
    bridgeState = { state: "unsupported", detail: "The local native bridge is currently packaged for macOS only." };
    return bridgeState;
  }
  await compileMacBridge();
  bridgeState = { state: "starting", input, output };
  child = spawn(macBinary, [input, output], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", receiveBridgeMessage);
  child.stderr.on("data", (chunk) => { bridgeState = { ...bridgeState, stderr: String(chunk).slice(-600) }; });
  child.once("exit", (code) => { child = undefined; bridgeState = { state: code === 0 ? "stopped" : "error", detail: code === 0 ? "Bridge stopped" : `Bridge exited with code ${code}` }; });
  await new Promise((resolveStart) => setTimeout(resolveStart, 350));
  return bridgeState;
};

const sendToBridge = (message) => {
  if (!child || child.killed || !child.stdin.writable) throw new Error("Bridge is not running");
  child.stdin.write(`${JSON.stringify(message)}\n`);
};

const stopBridge = () => {
  if (child && !child.killed) sendToBridge({ command: "stop" });
};

const authorize = (request) => {
  const origin = request.headers.origin;
  return !origin || allowedOrigins.has(origin);
};

const server = http.createServer(async (request, response) => {
  if (!authorize(request)) return json(response, 403, { ok: false, error: "Only Spotify's local renderer may control this bridge" });
  if (request.method === "OPTIONS") return json(response, 204, {});
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      // Ask the native process for a fresh buffer meter. Its response is
      // asynchronous, so this response may contain the immediately previous
      // sample; the next lightweight poll receives the fresh value.
      if (child && !child.killed && bridgeState.state === "active") sendToBridge({ command: "meter" });
      return json(response, 200, { ok: true, ...bridgeState, running: Boolean(child && !child.killed) });
    }
    if (request.method === "POST" && url.pathname === "/start") return json(response, 200, { ok: true, ...(await startBridge(await readBody(request))) });
    if (request.method === "POST" && url.pathname === "/configure") {
      const payload = await readBody(request);
      if (!Array.isArray(payload.bands) || payload.bands.length !== 7 || !payload.bands.every(validBand)) return json(response, 400, { ok: false, error: "Seven valid EQ bands are required" });
      if (typeof payload.enabled !== "boolean" || !Number.isFinite(Number(payload.preamp)) || Number(payload.preamp) < -12 || Number(payload.preamp) > 12) return json(response, 400, { ok: false, error: "Invalid bypass or preamp value" });
      sendToBridge({ bands: payload.bands, enabled: payload.enabled, preamp: Number(payload.preamp) });
      return json(response, 202, { ok: true, state: "configured" });
    }
    if (request.method === "POST" && url.pathname === "/stop") { stopBridge(); return json(response, 202, { ok: true, state: "stopping" }); }
    return json(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    bridgeState = { state: "error", detail: error instanceof Error ? error.message : String(error) };
    return json(response, 500, { ok: false, ...bridgeState });
  }
});

server.listen(port, host, () => console.log(`Fruity EQ bridge listening on http://${host}:${port}`));
process.on("SIGINT", () => { stopBridge(); server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { stopBridge(); server.close(() => process.exit(0)); });
