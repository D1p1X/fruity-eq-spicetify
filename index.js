/* Fruity EQ — local Spicetify custom app. No external network or remote assets. */
const { React } = Spicetify;
const { useCallback, useEffect, useMemo, useRef, useState } = React;
const h = React.createElement;

const APP_ID = "fruity-eq";
const STORAGE_KEY = `${APP_ID}:state:v2`;
const LEGACY_STORAGE_KEY = `${APP_ID}:state:v1`;
const MIN_HZ = 20;
const MAX_HZ = 20000;
const MAX_DB = 12;
const BRIDGE_URL = "http://127.0.0.1:24680";
const BRIDGE_INPUT = "BlackHole 2ch";
const BRIDGE_OUTPUT = "Reproduktory MacBook Air";
const BAND_COLOURS = ["#ad6bea", "#ef67b2", "#ff7b61", "#e7dc43", "#57e75f", "#2cdbc1", "#69adff"];
const BAND_LABELS = ["SUB", "BASS", "LOW MID", "MID", "HIGH MID", "PRS", "TREBLE"];
const DEFAULT_BANDS = [
  { frequency: 63, gain: 0, q: 0.8, type: "lowshelf", active: true },
  { frequency: 125, gain: 0, q: 1.0, type: "peaking", active: true },
  { frequency: 250, gain: 0, q: 1.0, type: "peaking", active: true },
  { frequency: 630, gain: 0, q: 1.0, type: "peaking", active: true },
  { frequency: 1600, gain: 0, q: 1.0, type: "peaking", active: true },
  { frequency: 4000, gain: 0, q: 1.0, type: "peaking", active: true },
  { frequency: 10000, gain: 0, q: 0.8, type: "highshelf", active: true },
];
const LEGACY_DEFAULT_FREQUENCIES = [63, 125, 250, 500, 1000, 2000, 4000];
const FACTORY_PRESETS = [
  { id: "flat", name: "Flat", bands: DEFAULT_BANDS },
  { id: "bass", name: "Bass lift", bands: [{ frequency: 55, gain: 5.5, q: .75, type: "lowshelf" }, { frequency: 120, gain: 3, q: 1, type: "peaking" }, { frequency: 250, gain: .5, q: 1, type: "peaking" }, { frequency: 500, gain: -1, q: 1, type: "peaking" }, { frequency: 1000, gain: 0, q: 1, type: "peaking" }, { frequency: 2000, gain: .5, q: 1.1, type: "peaking" }, { frequency: 6500, gain: 1.5, q: .8, type: "highshelf" }] },
  { id: "vocal", name: "Vocal focus", bands: [{ frequency: 60, gain: -2, q: .8, type: "lowshelf" }, { frequency: 130, gain: -1, q: 1, type: "peaking" }, { frequency: 280, gain: -1.5, q: 1, type: "peaking" }, { frequency: 750, gain: 1, q: 1, type: "peaking" }, { frequency: 1800, gain: 3, q: 1.1, type: "peaking" }, { frequency: 3500, gain: 2.5, q: 1.1, type: "peaking" }, { frequency: 9000, gain: 1, q: .8, type: "highshelf" }] },
  { id: "club", name: "Club", bands: [{ frequency: 48, gain: 5, q: .72, type: "lowshelf" }, { frequency: 120, gain: 2.5, q: .9, type: "peaking" }, { frequency: 260, gain: -1, q: 1, type: "peaking" }, { frequency: 650, gain: -1.5, q: 1, type: "peaking" }, { frequency: 1500, gain: 1.2, q: 1, type: "peaking" }, { frequency: 3800, gain: 2, q: 1.05, type: "peaking" }, { frequency: 9000, gain: 3, q: .75, type: "highshelf" }] },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const copyBands = (bands) => bands.map((band) => ({ ...band }));
const curveSignature = (bands, preamp = 0) => JSON.stringify({ bands: bands.map(({ frequency, gain, q, type, active }) => [frequency, gain, q, type, active !== false]), preamp });
const dbText = (value) => `${value > 0 ? "+" : ""}${Number(value).toFixed(1)} dB`;
const hzText = (value) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
const logPercent = (frequency) => (Math.log(frequency / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * 100;
const hzAtPercent = (percent) => MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, clamp(percent, 0, 100) / 100);
const safeState = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
    if (Array.isArray(stored?.bands) && stored.bands.length === 7) return {
      bands: !stored.version && !stored.userPresets?.length && stored.bands.every((band, index) => Number(band.frequency) === LEGACY_DEFAULT_FREQUENCIES[index] && Number(band.gain) === 0) ? copyBands(DEFAULT_BANDS) : stored.bands.map((band, index) => ({ ...DEFAULT_BANDS[index], ...band, active: band.active !== false, frequency: clamp(Number(band.frequency) || DEFAULT_BANDS[index].frequency, MIN_HZ, MAX_HZ), gain: clamp(Number(band.gain) || 0, -MAX_DB, MAX_DB), q: clamp(Number(band.q) || 1, .15, 12) })),
      userPresets: Array.isArray(stored.userPresets) ? stored.userPresets.filter((preset) => Array.isArray(preset?.bands) && preset.bands.length === 7).slice(0, 40) : [],
      enabled: stored.enabled !== false,
      preamp: clamp(Number(stored.preamp) || 0, -MAX_DB, MAX_DB),
    };
  } catch (_) { /* A corrupt local preset never stops the app from opening. */ }
  return { bands: copyBands(DEFAULT_BANDS), userPresets: [], enabled: true, preamp: 0 };
};

const currentTrack = () => {
  const item = Spicetify.Player?.data?.item || {};
  const metadata = item.metadata || {};
  return {
    title: metadata.title || metadata.track_name || item.name || "Nothing playing",
    artist: metadata.artist_name || metadata.artist || item.artists?.map((artist) => artist.name).join(", ") || "Spotify",
    playing: Boolean(Spicetify.Player?.isPlaying?.()),
  };
};

// The optional native bridge listens only on loopback. No listening history,
// Spotify credentials or preset data are transmitted outside this computer.
const bridgeRequest = async (path, method = "GET", payload, timeoutMs = 1800) => {
  const controller = window.AbortController ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      method,
      headers: payload ? { "content-type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller?.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || body.detail || `Bridge HTTP ${response.status}`);
    return body;
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
};

const updateEngine = (engine, bands, enabled, preamp = 0) => {
  if (!engine?.filters || !engine.context) return false;
  const now = engine.context.currentTime;
  engine.filters.forEach((filter, index) => {
    const band = bands[index];
    filter.type = band.type;
    filter.frequency.setTargetAtTime(band.frequency, now, .012);
    filter.gain.setTargetAtTime(band.active === false ? 0 : band.gain, now, .012);
    filter.Q.setTargetAtTime(band.q, now, .012);
  });
  engine.dry.gain.setTargetAtTime(enabled ? 0 : 1, now, .012);
  engine.wet.gain.setTargetAtTime(enabled ? 1 : 0, now, .012);
  engine.preamp?.gain.setTargetAtTime(enabled ? Math.pow(10, preamp / 20) : 1, now, .012);
  return true;
};

const updateAudioEngine = (bands, enabled, preamp = 0) => {
  const engines = [window.__fruityEqAudioEngine, window.__fruityEqSystemAudioEngine];
  return engines.reduce((updated, engine) => updateEngine(engine, bands, enabled, preamp) || updated, false);
};

const attachAudioEngine = async (bands, enabled, preamp = 0) => {
  const existing = window.__fruityEqAudioEngine;
  if (existing?.filters) {
    await existing.context.resume();
    updateAudioEngine(bands, enabled, preamp);
    return { ok: true, reason: "active" };
  }
  const media = [...document.querySelectorAll("audio")].find((element) => !element.__fruityEqAudioSource);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!media || !AudioContextClass) return { ok: false, reason: media ? "web-audio-unavailable" : "spotify-stream-not-exposed" };
  try {
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(media);
    const preampNode = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    const filters = bands.map((band) => {
      const filter = context.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.gain.value = band.active === false ? 0 : band.gain;
      filter.Q.value = band.q;
      return filter;
    });
    source.connect(preampNode);
    preampNode.connect(dry);
    dry.connect(context.destination);
    preampNode.connect(filters[0]);
    filters.reduce((previous, filter) => { previous.connect(filter); return filter; });
    filters[filters.length - 1].connect(wet);
    wet.connect(context.destination);
    media.__fruityEqAudioSource = true;
    window.__fruityEqAudioEngine = { context, filters, dry, wet, preamp: preampNode, media };
    await context.resume();
    updateAudioEngine(bands, enabled, preamp);
    return { ok: true, reason: "active" };
  } catch (error) {
    return { ok: false, reason: "audio-attach-failed", error };
  }
};

const stopSystemAudioEngine = async () => {
  const engine = window.__fruityEqSystemAudioEngine;
  if (!engine) return;
  try { engine.player?.pause?.(); engine.player?.remove?.(); } catch (_) { /* no-op */ }
  try { engine.stream?.getTracks?.().forEach((track) => track.stop()); } catch (_) { /* no-op */ }
  try { await engine.context?.close?.(); } catch (_) { /* no-op */ }
  delete window.__fruityEqSystemAudioEngine;
};

const attachSystemAudioEngine = async (bands, enabled, preamp = 0) => {
  const existing = window.__fruityEqSystemAudioEngine;
  if (existing?.filters) {
    await existing.context.resume();
    updateEngine(existing, bands, enabled, preamp);
    return { ok: true, reason: "system-active" };
  }
  const mediaDevices = window.navigator?.mediaDevices;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!mediaDevices?.getUserMedia || !AudioContextClass || !window.HTMLMediaElement?.prototype?.setSinkId) return { ok: false, reason: "system-capture-unavailable" };
  let stream;
  let context;
  let player;
  try {
    // With BlackHole selected as macOS input, this receives exactly the Spotify mix.
    // Voice processing must be disabled or it would alter the EQ signal.
    stream = await mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const devices = await mediaDevices.enumerateDevices();
    const speaker = devices.find((device) => device.kind === "audiooutput" && !/blackhole/i.test(device.label) && /speaker|macbook|built-in/i.test(device.label));
    if (!speaker) {
      stream.getTracks().forEach((track) => track.stop());
      return { ok: false, reason: "system-speaker-selection-unavailable" };
    }
    context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const preampNode = context.createGain();
    const filters = bands.map((band) => {
      const filter = context.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.gain.value = band.active === false ? 0 : band.gain;
      filter.Q.value = band.q;
      return filter;
    });
    const destination = context.createMediaStreamDestination();
    source.connect(preampNode);
    preampNode.connect(filters[0]);
    filters.reduce((previous, filter) => { previous.connect(filter); return filter; });
    filters[filters.length - 1].connect(destination);
    player = document.createElement("audio");
    player.autoplay = true;
    player.playsInline = true;
    player.srcObject = destination.stream;
    await player.setSinkId(speaker.deviceId);
    document.body.appendChild(player);
    await player.play();
    window.__fruityEqSystemAudioEngine = { context, filters, preamp: preampNode, stream, player };
    await context.resume();
    updateEngine(window.__fruityEqSystemAudioEngine, bands, enabled, preamp);
    return { ok: true, reason: "system-active" };
  } catch (error) {
    try { player?.pause?.(); player?.remove?.(); } catch (_) { /* no-op */ }
    try { stream?.getTracks?.().forEach((track) => track.stop()); } catch (_) { /* no-op */ }
    try { await context?.close?.(); } catch (_) { /* no-op */ }
    return {
      ok: false,
      reason: "system-capture-failed",
      detail: `${error?.name || "Error"}${error?.message ? `: ${String(error.message).slice(0, 120)}` : ""}`,
      error,
    };
  }
};

const approximateResponsePath = (bands, preamp) => Array.from({ length: 241 }, (_, index) => {
  const x = (index / 240) * 100;
  const frequency = hzAtPercent(x);
  const db = bands.reduce((sum, band) => {
    if (band.active === false) return sum;
    const distance = Math.log2(frequency / band.frequency);
    if (band.type === "lowshelf") return sum + band.gain / (1 + Math.exp((distance - .18) * 7));
    if (band.type === "highshelf") return sum + band.gain / (1 + Math.exp((-distance - .18) * 7));
    const width = Math.max(.17, 1.45 / band.q);
    return sum + band.gain * Math.exp(-(distance * distance) / (2 * width * width));
  }, preamp);
  return `${index ? "L" : "M"}${x.toFixed(2)},${clamp(50 - db * 3.7, 5, 95).toFixed(2)}`;
}).join(" ");

function EqGraph({ bands, preamp, selectedIndex, onSelect, onMove, onEditStart, onEditEnd }) {
  const graphRef = useRef(null);
  const dragIndex = useRef(null);
  const approximatePath = useMemo(() => approximateResponsePath(bands, preamp), [bands, preamp]);
  const [responsePath, setResponsePath] = useState(approximatePath);
  useEffect(() => {
    let cancelled = false;
    setResponsePath(approximatePath);
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) return () => { cancelled = true; };
    const frame = window.requestAnimationFrame(() => {
      try {
      // getFrequencyResponse is the browser's own BiquadFilter implementation.
      // It produces the same curve used by the optional Web Audio signal path.
      const sampleRate = window.__fruityEqAudioEngine?.context?.sampleRate || 48000;
      const context = new OfflineContext(1, 1, sampleRate);
      // 257 logarithmic samples are denser than the rendered graph's pixels,
      // while avoiding unnecessary filter work while a point is dragged.
      const frequencies = new Float32Array(257);
      const responseDb = new Float32Array(frequencies.length);
      for (let index = 0; index < frequencies.length; index += 1) frequencies[index] = hzAtPercent((index / (frequencies.length - 1)) * 100);
      responseDb.fill(preamp);
      bands.forEach((band) => {
        if (band.active === false) return;
        const filter = context.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.frequency;
        filter.gain.value = band.gain;
        filter.Q.value = band.q;
        const magnitude = new Float32Array(frequencies.length);
        const phase = new Float32Array(frequencies.length);
        filter.getFrequencyResponse(frequencies, magnitude, phase);
        for (let index = 0; index < magnitude.length; index += 1) responseDb[index] += 20 * Math.log10(Math.max(magnitude[index], 1e-8));
      });
      const precisePath = Array.from(responseDb, (db, index) => {
        const x = (index / (responseDb.length - 1)) * 100;
        return `${index ? "L" : "M"}${x.toFixed(2)},${clamp(50 - db * 3.7, 5, 95).toFixed(2)}`;
      }).join(" ");
        if (!cancelled) setResponsePath(precisePath);
      } catch (_) { /* The approximation remains visible in older Chromium builds. */ }
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [approximatePath, bands, preamp]);
  const path = responsePath;
  const changeAtPointer = useCallback((index, event) => {
    const rect = graphRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
    const gain = clamp(12 - ((event.clientY - rect.top) / rect.height) * 24, -MAX_DB, MAX_DB);
    onMove(index, { frequency: Math.round(hzAtPercent(x)), gain: Math.round(gain * 10) / 10 });
  }, [onMove]);
  const startDrag = useCallback((index, event) => {
    event.preventDefault();
    onSelect(index);
    onEditStart?.();
    dragIndex.current = index;
    changeAtPointer(index, event);
    const move = (moveEvent) => dragIndex.current !== null && changeAtPointer(dragIndex.current, moveEvent);
    const stop = () => {
      dragIndex.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      onEditEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }, [changeAtPointer, onEditEnd, onEditStart, onSelect]);
  const selectNearest = (event) => {
    if (event.target !== event.currentTarget) return;
    const rect = graphRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percent = ((event.clientX - rect.left) / rect.width) * 100;
    const nearest = bands.reduce((best, band, index) => Math.abs(logPercent(band.frequency) - percent) < Math.abs(logPercent(bands[best].frequency) - percent) ? index : best, 0);
    onSelect(nearest);
  };
  const ticks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  return h("div", { className: "feq-graph-wrap" },
    h("svg", { ref: graphRef, className: "feq-graph", viewBox: "0 0 100 100", preserveAspectRatio: "none", onPointerDown: selectNearest, role: "application", "aria-label": "Parametric EQ graph. Drag a colored band handle to tune it." },
      ticks.map((frequency) => h("line", { key: `v-${frequency}`, className: "feq-grid-line", x1: logPercent(frequency), x2: logPercent(frequency), y1: 0, y2: 100 })),
      [16.7, 33.3, 50, 66.7, 83.3].map((y) => h("line", { key: `h-${y}`, className: y === 50 ? "feq-zero-line" : "feq-grid-line", x1: 0, x2: 100, y1: y, y2: y })),
      h("path", { className: "feq-curve-shadow", d: path }),
      h("path", { className: "feq-curve", d: path }),
      bands.map((band, index) => h("g", { key: index, className: `feq-band-node ${selectedIndex === index ? "is-selected" : ""} ${band.active === false ? "is-muted" : ""}`, transform: `translate(${logPercent(band.frequency)} ${50 - band.gain * 3.7})`, onPointerDown: (event) => startDrag(index, event) },
        h("circle", { r: 3.72, fill: "none", stroke: BAND_COLOURS[index], strokeWidth: .72, opacity: .34 }),
        h("circle", { r: 2.76, fill: BAND_COLOURS[index], opacity: .16 }),
        h("circle", { r: 2.25, fill: "#142735", stroke: BAND_COLOURS[index], strokeWidth: 1.05 }),
        h("text", { textAnchor: "middle", dominantBaseline: "central", fill: BAND_COLOURS[index] }, index + 1)
      ))
    ),
    h("div", { className: "feq-graph-labels" }, ticks.slice(0, -1).map((frequency) => h("span", { key: frequency, style: { left: `${logPercent(frequency)}%` } }, frequency >= 1000 ? `${frequency / 1000}k` : frequency)))
  );
}

function BandFader({ band, index, selected, onSelect, onGain, onEditStart, onEditEnd }) {
  const faderRef = useRef(null);
  const dragging = useRef(false);
  const changeAtPointer = useCallback((event) => {
    const rect = faderRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gain = clamp(12 - ((event.clientY - rect.top) / rect.height) * 24, -MAX_DB, MAX_DB);
    onGain(index, { gain: Math.round(gain * 10) / 10 });
  }, [index, onGain]);
  const startDrag = useCallback((event) => {
    event.preventDefault();
    onSelect(index);
    onEditStart?.();
    dragging.current = true;
    changeAtPointer(event);
    const move = (moveEvent) => dragging.current && changeAtPointer(moveEvent);
    const stop = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      onEditEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }, [changeAtPointer, index, onEditEnd, onEditStart, onSelect]);
  return h("button", { ref: faderRef, type: "button", className: `feq-fader ${selected ? "is-selected" : ""} ${band.active === false ? "is-muted" : ""}`, style: { "--band": BAND_COLOURS[index], "--gain": `${((band.gain + MAX_DB) / (MAX_DB * 2)) * 100}%` }, onClick: () => onSelect(index), onPointerDown: startDrag, title: `Drag to set Band ${index + 1} gain: ${dbText(band.gain)}`, "aria-label": `Band ${index + 1} gain fader: ${dbText(band.gain)}` }, h("span", { className: "feq-fader-cap", "aria-hidden": "true" }, "⌁"), h("i", null, index + 1));
}

function Studio() {
  const initial = useMemo(safeState, []);
  const [bands, setBands] = useState(initial.bands);
  const [userPresets, setUserPresets] = useState(initial.userPresets);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [preamp, setPreamp] = useState(initial.preamp);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [presetName, setPresetName] = useState("My preset");
  const [activePreset, setActivePreset] = useState("current");
  const [engineState, setEngineState] = useState(() => window.__fruityEqSystemAudioEngine?.filters ? "system-active" : window.__fruityEqAudioEngine?.filters ? "active" : document.querySelector("audio") ? "standby" : "spotify-stream-not-exposed");
  const [engineDetail, setEngineDetail] = useState("");
  const [bridge, setBridge] = useState({ state: "checking", detail: "Checking the local audio bridge" });
  const [track, setTrack] = useState(currentTrack);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [reference, setReference] = useState({ bands: copyBands(initial.bands), preamp: initial.preamp });
  const [compare, setCompare] = useState(false);
  const editingRef = useRef(false);
  const selected = bands[selectedIndex];
  const gainApplicable = ["lowshelf", "peaking", "highshelf"].includes(selected.type);
  const presetSource = [...FACTORY_PRESETS, ...userPresets].find((preset) => preset.id === activePreset);
  const isDirty = !presetSource || curveSignature(bands, preamp) !== curveSignature(presetSource.bands, presetSource.preamp || 0);
  const audibleBands = compare ? reference.bands : bands;
  const audiblePreamp = compare ? reference.preamp : preamp;
  const nativePayload = { bands: audibleBands, enabled, preamp: audiblePreamp };

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, bands, userPresets, enabled, preamp })); } catch (_) { /* Keep operating if Spotify storage is full. */ }
  }, [bands, userPresets, enabled, preamp]);
  useEffect(() => {
    if (updateAudioEngine(audibleBands, enabled, audiblePreamp)) setEngineState(window.__fruityEqSystemAudioEngine?.filters ? "system-active" : "active");
  }, [audibleBands, enabled, audiblePreamp]);
  useEffect(() => {
    let cancelled = false;
    const checkBridge = async () => {
      try {
        const status = await bridgeRequest("/health");
        if (!cancelled) setBridge(status);
      } catch (error) {
        if (!cancelled) setBridge({ state: "offline", detail: error?.message || "Local bridge is not running" });
      }
    };
    checkBridge();
    const timer = window.setInterval(checkBridge, 3500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  // A Spotify restart can be necessary after macOS changes its default output
  // to BlackHole. The windowless bridge deliberately survives that restart, so
  // reconnect this UI and resend its local curve automatically when it returns.
  useEffect(() => {
    if (bridge.state !== "active" || engineState !== "spotify-stream-not-exposed") return;
    setEngineDetail("");
    setEngineState("native-active");
  }, [bridge.state, engineState]);
  useEffect(() => {
    if (engineState !== "native-active") return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await bridgeRequest("/configure", "POST", nativePayload);
        const status = await bridgeRequest("/health");
        if (!cancelled) setBridge(status);
      } catch (error) {
        if (!cancelled) {
          setBridge({ state: "error", detail: error?.message || "Native bridge configuration failed" });
          setEngineDetail(error?.message || "Native bridge configuration failed");
          setEngineState("native-error");
        }
      }
    }, 28);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [audibleBands, audiblePreamp, enabled, engineState]);
  useEffect(() => {
    const updateTrack = () => setTrack(currentTrack());
    updateTrack();
    const timer = window.setInterval(updateTrack, 1200);
    Spicetify.Player?.addEventListener?.("songchange", updateTrack);
    return () => { window.clearInterval(timer); Spicetify.Player?.removeEventListener?.("songchange", updateTrack); };
  }, []);
  const remember = useCallback((snapshot) => {
    setHistory((previous) => [...previous, { bands: copyBands(snapshot.bands), preamp: snapshot.preamp }].slice(-48));
    setFuture([]);
  }, []);
  const beginEdit = useCallback(() => {
    if (editingRef.current) return;
    editingRef.current = true;
    remember({ bands, preamp });
  }, [bands, preamp, remember]);
  // Keep the transaction open through the browser's final pointer dispatch.
  // Without this frame boundary, a late pointer event after drag release could
  // create a second history snapshot and make one Undo land mid-drag.
  const endEdit = useCallback(() => {
    window.requestAnimationFrame(() => { editingRef.current = false; });
  }, []);
  const patchBand = useCallback((index, patch) => {
    setBands((previous) => {
      const next = previous.map((band, bandIndex) => bandIndex === index ? { ...band, ...patch } : band);
      if (!editingRef.current && curveSignature(next, preamp) !== curveSignature(previous, preamp)) remember({ bands: previous, preamp });
      return next;
    });
    setActivePreset("current");
    setCompare(false);
  }, [preamp, remember]);
  const reset = () => { remember({ bands, preamp }); setBands(copyBands(DEFAULT_BANDS)); setPreamp(0); setActivePreset("flat"); setCompare(false); };
  const applyPreset = (id) => {
    const source = [...FACTORY_PRESETS, ...userPresets].find((preset) => preset.id === id);
    if (!source) { setActivePreset("current"); return; }
    remember({ bands, preamp });
    setBands(copyBands(source.bands));
    setPreamp(clamp(Number(source.preamp) || 0, -MAX_DB, MAX_DB));
    setPresetName(source.name);
    setActivePreset(id);
    setCompare(false);
  };
  const savePreset = () => {
    const name = String(presetName || "My preset").trim().slice(0, 48) || "My preset";
    const existing = userPresets.find((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const id = existing?.id || `user-${Date.now().toString(36)}`;
    setUserPresets((previous) => [{ id, name, bands: copyBands(bands), preamp, createdAt: Date.now() }, ...previous.filter((preset) => preset.id !== id)].slice(0, 40));
    setActivePreset(id);
  };
  const deletePreset = () => {
    if (!activePreset.startsWith("user-")) return;
    setUserPresets((previous) => previous.filter((preset) => preset.id !== activePreset));
    setActivePreset("current");
  };
  const undo = useCallback(() => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [{ bands: copyBands(bands), preamp }, ...items].slice(0, 48));
    setBands(copyBands(previous.bands));
    setPreamp(previous.preamp);
    setActivePreset("current");
    setCompare(false);
  }, [bands, history, preamp]);
  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items, { bands: copyBands(bands), preamp }].slice(-48));
    setBands(copyBands(next.bands));
    setPreamp(next.preamp);
    setActivePreset("current");
    setCompare(false);
  }, [bands, future, preamp]);
  const captureReference = () => { setReference({ bands: copyBands(bands), preamp }); setCompare(false); };
  const toggleBand = () => patchBand(selectedIndex, { active: selected.active === false });
  const patchPreamp = (value) => { if (!editingRef.current && value !== preamp) remember({ bands, preamp }); setPreamp(value); setActivePreset("current"); setCompare(false); };
  const activateEngine = async () => {
    setEngineState("connecting");
    const result = await attachAudioEngine(audibleBands, enabled, audiblePreamp);
    setEngineDetail(result.detail || "");
    setEngineState(result.ok ? "active" : result.reason);
  };
  const activateSystemEngine = async () => {
    if (window.__fruityEqSystemAudioEngine?.filters) {
      await stopSystemAudioEngine();
      setEngineDetail("");
      setEngineState(document.querySelector("audio") ? "standby" : "spotify-stream-not-exposed");
      return;
    }
    setEngineState("system-connecting");
    const result = await attachSystemAudioEngine(audibleBands, enabled, audiblePreamp);
    setEngineDetail(result.detail || "");
    setEngineState(result.ok ? "system-active" : result.reason);
  };
  const activateNativeBridge = async () => {
    if (engineState === "native-active") {
      setEngineState("native-stopping");
      try {
        await bridgeRequest("/stop", "POST", {});
        setBridge({ state: "stopping", detail: "Restoring your normal audio output" });
        window.setTimeout(() => setEngineState("spotify-stream-not-exposed"), 480);
      } catch (error) {
        setEngineDetail(error?.message || "Native bridge could not stop");
        setEngineState("native-error");
      }
      return;
    }
    setEngineState("native-connecting");
    setEngineDetail("");
    try {
      // The first run may compile the small local Swift bridge. Give that
      // one-time build enough time instead of falsely reporting an active
      // bridge as unavailable.
      await bridgeRequest("/start", "POST", { input: BRIDGE_INPUT, output: BRIDGE_OUTPUT }, 15_000);
      let status = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        status = await bridgeRequest("/health");
        if (status.state === "active") break;
        if (status.state === "error" || status.state === "unsupported") throw new Error(status.detail || "Native bridge failed to start");
      }
      if (status?.state !== "active") throw new Error(status?.detail || "Native bridge did not become active");
      await bridgeRequest("/configure", "POST", nativePayload);
      setBridge(status);
      setEngineState("native-active");
    } catch (error) {
      setBridge({ state: "error", detail: error?.message || "Native bridge unavailable" });
      setEngineDetail(error?.message || "Native bridge unavailable");
      setEngineState("native-error");
    }
  };
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);
  const nativePeak = Number(bridge.peakDb);
  const nativeSignal = Number(bridge.packets) > 0 && Number.isFinite(nativePeak) ? ` · signal ${nativePeak.toFixed(1)} dB` : "";
  const nativeNeedsSpotifyRestart = engineState === "native-active" && track.playing && bridge.state === "active" && Number(bridge.packets) >= 250 && nativePeak <= -110;
  const audioCaption = engineState === "native-active" ? (nativeNeedsSpotifyRestart ? "EQ route ready — restart Spotify once, then press Play" : enabled ? `Real-time audio active · BlackHole → EQ → speakers${nativeSignal}` : `Real-time audio bypassed · BlackHole → speakers${nativeSignal}`) : engineState === "native-connecting" ? "Starting local real-time audio bridge…" : engineState === "native-stopping" ? "Restoring your normal speakers…" : engineState === "native-error" ? "Native real-time audio bridge unavailable" : engineState === "system-active" ? (enabled ? "Browser system audio active · BlackHole → EQ → speakers" : "Browser system audio bypassed · BlackHole → speakers") : engineState === "system-connecting" ? "Requesting browser system audio…" : engineState === "system-capture-unavailable" ? "This Spotify Chromium build cannot select speakers" : engineState === "system-speaker-selection-unavailable" ? "Select BlackHole input, then allow speaker selection" : engineState === "system-capture-failed" ? "Browser system capture was not permitted" : engineState === "active" ? (enabled ? "Direct Spotify audio path active" : "Direct Spotify path bypassed") : engineState === "connecting" ? "Connecting direct audio path…" : engineState === "spotify-stream-not-exposed" ? "Direct Spotify stream is protected — start Real-time audio" : engineState === "audio-attach-failed" ? "Direct audio path was unavailable" : "Audio path ready to connect";

  return h("main", { className: `feq-app ${compare ? "feq-app--compare" : ""}` },
    h("header", { className: "feq-titlebar" },
      h("div", { className: "feq-brand" }, h("span", { className: "feq-logo", "aria-hidden": "true" }, "∿"), h("div", null, h("b", null, "Fruity EQ Studio"), h("small", null, "7-band parametric studio"))),
      h("div", { className: "feq-now-playing", title: `${track.title} — ${track.artist}` }, h("span", { className: `feq-play-led ${track.playing ? "is-playing" : ""}` }), h("span", null, track.title), h("em", null, track.artist)),
      h("div", { className: "feq-window-actions" },
        h("button", { className: "feq-icon-button", type: "button", disabled: !history.length, title: "Undo (⌘Z)", onClick: undo }, "↶"),
        h("button", { className: "feq-icon-button", type: "button", disabled: !future.length, title: "Redo (⌘⇧Z)", onClick: redo }, "↷"),
        h("button", { className: `feq-ab ${compare ? "is-compare" : ""}`, type: "button", title: compare ? "Return to the current curve (B)" : "Hear the captured A reference", onClick: () => setCompare((value) => !value) }, compare ? "A ●" : "A/B"),
        h("button", { className: "feq-icon-button", type: "button", title: track.playing ? "Pause Spotify" : "Play Spotify", onClick: () => Spicetify.Player?.togglePlay?.() }, track.playing ? "Ⅱ" : "▶"),
        h("button", { className: `feq-power ${enabled ? "is-on" : ""}`, type: "button", onClick: () => setEnabled((value) => !value), "aria-pressed": enabled }, enabled ? "ON" : "BYPASS")
      )
    ),
    h("section", { className: "feq-presetbar" },
      h("div", { className: "feq-preset-field" }, h("span", null, "PRESET"), h("select", { value: activePreset, onChange: (event) => applyPreset(event.target.value), "aria-label": "Load a preset" },
        h("option", { value: "current" }, isDirty ? "Current unsaved curve •" : "Current curve"),
        h("optgroup", { label: "Factory" }, FACTORY_PRESETS.map((preset) => h("option", { key: preset.id, value: preset.id }, preset.name))),
        userPresets.length ? h("optgroup", { label: "My saved presets" }, userPresets.map((preset) => h("option", { key: preset.id, value: preset.id }, preset.name))) : null
      )),
      h("div", { className: "feq-save-preset" }, h("input", { value: presetName, maxLength: 48, onChange: (event) => setPresetName(event.target.value), onKeyDown: (event) => event.key === "Enter" && savePreset(), placeholder: "Preset name", "aria-label": "Name for saved preset" }), h("button", { type: "button", onClick: savePreset }, activePreset.startsWith("user-") && !isDirty ? "Saved" : "Save"), h("button", { className: "feq-delete", type: "button", disabled: !activePreset.startsWith("user-"), onClick: deletePreset, title: "Delete selected saved preset" }, "⌫")),
      h("span", { className: `feq-save-state ${isDirty ? "is-dirty" : ""}` }, isDirty ? "Unsaved changes" : "Saved locally"),
      h("button", { className: "feq-reference", type: "button", onClick: captureReference, title: "Store the current curve as the A reference for A/B listening" }, "Capture A"),
      h("button", { className: "feq-reset", type: "button", onClick: reset }, "Reset Flat")
    ),
    h("section", { className: "feq-band-tabs", "aria-label": "EQ bands" }, bands.map((band, index) => h("button", { key: index, type: "button", className: `${selectedIndex === index ? "is-selected" : ""} ${band.active === false ? "is-muted" : ""}`, style: { "--band": BAND_COLOURS[index] }, onClick: () => setSelectedIndex(index) }, h("b", null, `0${index + 1}`), h("span", null, BAND_LABELS[index]), band.active === false && h("i", null, "OFF")))),
    h("section", { className: "feq-main" },
      h("div", { className: "feq-workspace" },
        h("div", { className: "feq-axis" }, h("span", null, "+12"), h("span", null, "+6"), h("span", null, "0"), h("span", null, "−6"), h("span", null, "−12")),
        h(EqGraph, { bands, preamp, selectedIndex, onSelect: setSelectedIndex, onMove: patchBand, onEditStart: beginEdit, onEditEnd: endEdit }),
        h("div", { className: "feq-curve-readout" }, h("span", { style: { color: BAND_COLOURS[selectedIndex] } }, compare ? "A REFERENCE" : `BAND ${selectedIndex + 1}`), h("b", null, hzText(selected.frequency)), h("b", null, dbText(selected.gain)), h("span", null, selected.active === false ? "OFF" : `Q ${selected.q.toFixed(2)}`))
      ),
      h("aside", { className: "feq-faders", "aria-label": "Band gain faders" }, bands.map((band, index) => h(BandFader, { key: index, band, index, selected: selectedIndex === index, onSelect: setSelectedIndex, onGain: patchBand, onEditStart: beginEdit, onEditEnd: endEdit })))
    ),
    h("section", { className: "feq-inspector" },
      h("div", { className: "feq-inspector-title" }, h("span", { style: { background: BAND_COLOURS[selectedIndex] } }), h("div", null, h("b", null, `Band ${selectedIndex + 1} · ${BAND_LABELS[selectedIndex]}`), h("small", null, "Drag the point in the graph, or tune precisely here.")), h("button", { type: "button", className: `feq-band-power ${selected.active !== false ? "is-on" : ""}`, onClick: toggleBand, "aria-pressed": selected.active !== false }, selected.active !== false ? "Band on" : "Band off")),
      h("label", { className: "feq-control" }, h("span", null, "FREQ", h("b", null, hzText(selected.frequency))), h("input", { type: "range", min: 0, max: 1000, value: Math.round(logPercent(selected.frequency) * 10), onPointerDown: beginEdit, onPointerUp: endEdit, onPointerCancel: endEdit, onChange: (event) => patchBand(selectedIndex, { frequency: Math.round(hzAtPercent(Number(event.target.value) / 10)) }) })),
      h("label", { className: `feq-control ${gainApplicable ? "" : "is-unavailable"}` }, h("span", null, "GAIN", h("b", null, gainApplicable ? dbText(selected.gain) : "N/A")), h("input", { type: "range", min: -120, max: 120, disabled: !gainApplicable, value: Math.round(selected.gain * 10), onPointerDown: beginEdit, onPointerUp: endEdit, onPointerCancel: endEdit, onChange: (event) => patchBand(selectedIndex, { gain: Number(event.target.value) / 10 }) })),
      h("label", { className: "feq-control" }, h("span", null, "WIDTH / Q", h("b", null, selected.q.toFixed(2))), h("input", { type: "range", min: 15, max: 1200, value: Math.round(selected.q * 100), onPointerDown: beginEdit, onPointerUp: endEdit, onPointerCancel: endEdit, onChange: (event) => patchBand(selectedIndex, { q: Number(event.target.value) / 100 }) })),
      h("label", { className: "feq-type" }, h("span", null, "SHAPE"), h("select", { value: selected.type, onChange: (event) => patchBand(selectedIndex, { type: event.target.value }) }, h("option", { value: "highpass" }, "High pass"), h("option", { value: "lowshelf" }, "Low shelf"), h("option", { value: "peaking" }, "Peaking"), h("option", { value: "notch" }, "Notch"), h("option", { value: "highshelf" }, "High shelf"), h("option", { value: "lowpass" }, "Low pass"), h("option", { value: "bandpass" }, "Band pass"), h("option", { value: "allpass" }, "All pass"))),
      h("label", { className: "feq-control feq-preamp" }, h("span", null, "PREAMP", h("b", null, dbText(preamp))), h("input", { type: "range", min: -120, max: 120, value: Math.round(preamp * 10), onPointerDown: beginEdit, onPointerUp: endEdit, onPointerCancel: endEdit, onChange: (event) => patchPreamp(Number(event.target.value) / 10) })),
      h("div", { className: "feq-engine" }, h("div", null, h("span", { className: `feq-engine-led ${engineState === "active" || engineState === "system-active" || engineState === "native-active" ? "is-active" : ""}` }), h("b", null, audioCaption), engineDetail && h("small", { className: "feq-engine-detail" }, engineDetail), h("small", null, bridge.state === "offline" ? "Start the local bridge once with npm run bridge:start." : nativeNeedsSpotifyRestart ? "Spotify is still using its previous output. Restart it once; this EQ view reconnects automatically." : bridge.state === "active" ? "DSP is local only; the signal meter is measured by the native bridge." : "The bridge remains local on this computer; no audio leaves Spotify.")), h("div", { className: "feq-engine-actions" }, h("button", { type: "button", onClick: activateNativeBridge, disabled: engineState === "native-connecting" || engineState === "native-stopping" }, engineState === "native-active" ? "Stop real-time EQ" : engineState === "native-connecting" ? "Starting…" : "Start real-time EQ"), h("button", { type: "button", className: "feq-engine-secondary", onClick: activateSystemEngine, disabled: engineState === "system-connecting" || engineState === "native-active" }, engineState === "system-active" ? "Disconnect browser" : "Try browser capture")))
    )
  );
}

function FruityEq() {
  // One visible Spotify Custom App window. The optional native DSP bridge is local and windowless.
  return h(Studio);
}

const render = () => h(FruityEq);
