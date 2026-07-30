import { cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appFolder = "fruity-eq";
const configRoot = process.env.SPICETIFY_CONFIG || (process.platform === "win32"
  ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "spicetify")
  : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "spicetify"));
const destination = join(configRoot, "CustomApps", appFolder);
const bridgeDestination = join(configRoot, "FruityEQBridge");
const appFiles = ["index.js", "style.css", "manifest.json"];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const file of appFiles) await cp(join(root, file), join(destination, file));

// The bridge has no window and remains idle until the user presses
// "Start real-time EQ" inside Spotify. It is installed outside CustomApps so
// Spotify only loads the small UI assets it needs.
await rm(bridgeDestination, { recursive: true, force: true });
await cp(join(root, "bridge"), bridgeDestination, { recursive: true });

const command = process.platform === "win32" ? "spicetify.exe" : "spicetify";
for (const args of [["config", "custom_apps", appFolder], ["apply"]]) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error || result.status !== 0) {
    console.error(`Fruity EQ was copied to ${destination}, but Spicetify could not run automatically.`);
    console.error(`Run: spicetify ${args.join(" ")}`);
    process.exit(result.status || 1);
  }
}

if (process.platform === "darwin") {
  const bridge = spawn(process.execPath, [join(bridgeDestination, "server.mjs")], { detached: true, stdio: "ignore" });
  bridge.unref();
}

console.log(`✓ Fruity EQ installed at ${destination}. Restart Spotify if the app rail was already open.`);
if (process.platform === "darwin") console.log("✓ Local Fruity EQ bridge started in the background (no extra window).");
