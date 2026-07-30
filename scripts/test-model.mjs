import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "index.js"), "utf8");
assert.match(source, /const endEdit = useCallback\([\s\S]*?requestAnimationFrame/, "drag edits must remain grouped through the final pointer dispatch");
assert.match(source, /timeoutMs = 1800/, "fast bridge calls need a bounded loopback timeout");
assert.match(source, /15_000/, "the first native bridge compile must have a patient start timeout");
assert.match(source, /nativeNeedsSpotifyRestart/, "silent native routing must give the user an honest restart instruction");
const storage = new Map();
const noop = () => {};
const react = {
  createElement: () => null,
  useCallback: (value) => value,
  useEffect: noop,
  useMemo: (value) => value(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === "function" ? value() : value, noop],
};
const context = vm.createContext({
  console,
  Math,
  JSON,
  Number,
  String,
  Boolean,
  Array,
  Float32Array,
  Date,
  Map,
  Set,
  Spicetify: { React: react, ReactDOM: {}, Player: {} },
  window: {},
  document: { querySelectorAll: () => [], activeElement: null },
  localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  globalThis: {},
});

new vm.Script(`${source}\n;globalThis.__fruityEqTest = { safeState, hzAtPercent, logPercent, approximateResponsePath, updateAudioEngine, attachAudioEngine, attachSystemAudioEngine, DEFAULT_BANDS, MAX_DB, MIN_HZ, MAX_HZ };`).runInContext(context);
const eq = context.globalThis.__fruityEqTest;

assert.equal(eq.DEFAULT_BANDS.length, 7, "the FL-style layout must contain seven bands");
assert.deepEqual(Array.from(eq.DEFAULT_BANDS, (band) => band.frequency), [63, 125, 250, 630, 1600, 4000, 10000]);
for (const frequency of [eq.MIN_HZ, 63, 1000, eq.MAX_HZ]) {
  assert.ok(Math.abs(eq.hzAtPercent(eq.logPercent(frequency)) - frequency) < 0.000001, `log frequency round-trip failed at ${frequency} Hz`);
}
const flat = eq.approximateResponsePath(eq.DEFAULT_BANDS, 0);
assert.match(flat, /^M0\.00,50\.00 /, "a flat EQ must start on the 0 dB line");

storage.set("fruity-eq:state:v2", JSON.stringify({
  version: 2,
  bands: eq.DEFAULT_BANDS.map((band, index) => ({ ...band, frequency: index === 0 ? -1 : band.frequency, gain: index === 1 ? 99 : band.gain, q: index === 2 ? 100 : band.q })),
  userPresets: Array.from({ length: 45 }, (_, index) => ({ id: index, bands: eq.DEFAULT_BANDS })),
  preamp: -99,
}));
const repaired = eq.safeState();
assert.equal(repaired.bands[0].frequency, eq.MIN_HZ, "invalid low frequency must clamp");
assert.equal(repaired.bands[1].gain, -eq.MAX_DB + eq.MAX_DB * 2, "invalid gain must clamp to +12 dB");
assert.equal(repaired.bands[2].q, 12, "invalid Q must clamp");
assert.equal(repaired.userPresets.length, 40, "local presets must stay bounded");
assert.equal(repaired.preamp, -eq.MAX_DB, "preamp must clamp");

const changes = [];
const target = (name) => ({ setTargetAtTime: (value, time, ramp) => changes.push([name, value, time, ramp]) });
context.window.__fruityEqAudioEngine = {
  context: { currentTime: 8 },
  filters: eq.DEFAULT_BANDS.map(() => ({ frequency: target("frequency"), gain: target("gain"), Q: target("q") })),
  dry: { gain: target("dry") }, wet: { gain: target("wet") }, preamp: { gain: target("preamp") },
};
assert.equal(eq.updateAudioEngine(eq.DEFAULT_BANDS, true, 6), true, "the engine update should attach seven filters");
assert.equal(changes.length, 7 * 3 + 3, "all filter and mix parameters must receive smoothing updates");
assert.ok(changes.some(([name, value]) => name === "preamp" && Math.abs(value - Math.pow(10, 6 / 20)) < 1e-10), "preamp gain must use dB conversion");
delete context.window.__fruityEqAudioEngine;
const protectedPlayback = await eq.attachAudioEngine(eq.DEFAULT_BANDS, true);
assert.equal(protectedPlayback.ok, false, "protected Spotify playback must fail safely");
assert.equal(protectedPlayback.reason, "spotify-stream-not-exposed", "protected Spotify playback must report its boundary honestly");
const unavailableSystemCapture = await eq.attachSystemAudioEngine(eq.DEFAULT_BANDS, true);
assert.equal(unavailableSystemCapture.ok, false, "missing browser system-capture APIs must fail safely");
assert.equal(unavailableSystemCapture.reason, "system-capture-unavailable", "the app must not pretend system audio is active when capture APIs are missing");

console.log("✓ Model tests: frequency mapping, flat curve, storage repair, filters, preamp, protected-stream and system-capture fallbacks passed.");
