import { parseFlp } from "./flp-parser.js";
import { createMidi } from "./midi-export.js";
import { Visualizer, PALETTE } from "./visualizer.js";
import { renderMp4 } from "./exporter.js";

const element = id => document.getElementById(id);
const state = {
  project: null,
  visualizer: null,
  audio: null,
  audioBuffer: null,
  audioContext: null,
  playing: false,
  position: 0,
  startedAt: 0,
  startedPosition: 0,
  fileName: "rollplay",
  rendering: false,
  settings: {
    background: "#ffffff",
    noteSize: 145,
    playhead: true,
    effects: true,
    percussion: true,
    resolution: "1080x1920",
    fps: 60,
    maxSize: 20,
    enabledPatterns: new Set(),
    trackModes: new Map(),
  },
};

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function notify(message, timeout = 3200) {
  const toast = element("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("visible"), timeout);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function updateTransport() {
  if (!state.project) return;
  const duration = state.project.duration;
  const position = Math.min(duration, currentPosition());
  element("time-current").textContent = formatTime(position);
  element("timeline").value = Math.round(position / duration * 1000);
}

function currentPosition() {
  if (!state.playing) return state.position;
  if (state.audio) return state.audio.currentTime;
  return state.startedPosition + (performance.now() - state.startedAt) / 1000;
}

function seek(position) {
  if (!state.project) return;
  state.position = Math.max(0, Math.min(state.project.duration, position));
  if (state.audio) state.audio.currentTime = state.position;
  state.startedPosition = state.position;
  state.startedAt = performance.now();
  state.visualizer?.draw(state.position);
  updateTransport();
}

async function setPlaying(playing) {
  if (!state.project) return;
  if (playing && state.position >= state.project.duration - .05) seek(0);
  if (playing) {
    state.startedPosition = state.position;
    state.startedAt = performance.now();
    if (state.audio) {
      state.audio.currentTime = state.position;
      try { await state.audio.play(); }
      catch { notify("Audio playback was blocked by the browser."); return; }
    }
  } else {
    state.position = currentPosition();
    state.audio?.pause();
  }
  state.playing = playing;
  element("play-button").innerHTML = playing
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  element("play-button").setAttribute("aria-label", playing ? "Pause" : "Play");
}

function refreshPatterns() {
  const container = element("pattern-list");
  container.replaceChildren();
  for (const [index, pattern] of state.project.patterns.entries()) {
    const row = document.createElement("div");
    row.className = `pattern-row${state.settings.enabledPatterns.has(pattern.id) ? "" : " muted-pattern"}`;
    const swatch = document.createElement("button");
    swatch.className = "pattern-swatch";
    swatch.style.background = PALETTE[index % PALETTE.length][0];
    swatch.setAttribute("aria-label", `${pattern.name} color`);
    const name = document.createElement("span");
    name.className = "pattern-name";
    name.textContent = pattern.name;
    name.title = pattern.name;
    const mode = document.createElement("button");
    mode.className = "pattern-mode";
    const updateModeButton = () => {
      const isStep = state.settings.trackModes.get(pattern.id) === "step";
      mode.classList.toggle("step-mode", isStep);
      mode.setAttribute("aria-label", `${pattern.name}: ${isStep ? "step percussion" : "melody"} rendering. Click to switch.`);
      mode.title = isStep ? "Step percussion · click for melody" : "Melody · click for step percussion";
      mode.innerHTML = isStep
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 3 9 9-9 9-9-9 9-9Z"/><path d="M12 8v8m-4-4h8"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';
    };
    mode.onclick = () => {
      const nextMode = state.settings.trackModes.get(pattern.id) === "step" ? "melody" : "step";
      state.settings.trackModes.set(pattern.id, nextMode);
      updateModeButton();
      state.visualizer.draw(currentPosition());
      notify(`${pattern.name}: ${nextMode === "step" ? "step percussion" : "melody"} rendering`);
    };
    updateModeButton();
    const toggle = document.createElement("button");
    toggle.className = "pattern-toggle";
    toggle.setAttribute("aria-label", `Toggle ${pattern.name}`);
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>';
    toggle.onclick = () => {
      if (state.settings.enabledPatterns.has(pattern.id)) state.settings.enabledPatterns.delete(pattern.id);
      else state.settings.enabledPatterns.add(pattern.id);
      row.classList.toggle("muted-pattern", !state.settings.enabledPatterns.has(pattern.id));
      state.visualizer.draw(currentPosition());
    };
    row.append(swatch, name, mode, toggle);
    container.append(row);
  }
}

async function loadFlp(file) {
  if (!file) return;
  try {
    if (state.playing) await setPlaying(false);
    const project = parseFlp(await file.arrayBuffer());
    state.project = project;
    state.fileName = file.name.replace(/\.flp$/i, "");
    state.settings.enabledPatterns = new Set(project.patterns.map(pattern => pattern.id));
    state.settings.trackModes = new Map(project.patterns.map(pattern => {
      const percussionNotes = pattern.notes.filter(note => note.channel >= 8 && note.channel !== 9).length;
      return [pattern.id, percussionNotes > pattern.notes.length / 2 ? "step" : "melody"];
    }));
    state.visualizer = new Visualizer(element("preview"), project, state.settings);
    element("flp-label").textContent = file.name;
    element("tempo-value").textContent = `${project.tempo} BPM`;
    element("duration-value").textContent = formatTime(project.duration);
    element("patterns-value").textContent = String(project.patterns.length);
    element("notes-value").textContent = project.notes.length.toLocaleString();
    element("time-total").textContent = formatTime(project.duration);
    element("empty-state").classList.add("hidden");
    for (const id of ["play-button", "restart-button", "timeline", "render-button", "midi-button"]) element(id).disabled = false;
    refreshPatterns();
    seek(0);
    notify(`Loaded ${project.patterns.length} patterns and ${project.notes.length.toLocaleString()} notes.`);
  } catch (error) {
    notify(error.message || "Unable to read this FL Studio project.", 5000);
    console.error(error);
  }
}

async function loadAudio(file) {
  if (!file) return;
  try {
    if (state.audio) URL.revokeObjectURL(state.audio.src);
    state.audio = new Audio(URL.createObjectURL(file));
    state.audio.preload = "auto";
    state.audio.onended = () => setPlaying(false);
    state.audioContext ||= new AudioContext();
    state.audioBuffer = await state.audioContext.decodeAudioData(await file.arrayBuffer());
    element("audio-label").textContent = file.name;
    notify(`Added audio · ${formatTime(state.audioBuffer.duration)}`);
  } catch (error) {
    notify(`Unable to load audio: ${error.message}`, 5000);
    console.error(error);
  }
}

async function exportVideo() {
  if (!state.project || state.rendering) return;
  if (state.playing) await setPlaying(false);
  state.rendering = true;
  element("render-button").disabled = true;
  element("header-export").disabled = true;
  element("render-progress").classList.remove("hidden");
  try {
    const blob = await renderMp4(state.project, state.settings, state.audioBuffer, (progress, label) => {
      element("progress-fill").style.width = `${Math.round(progress * 100)}%`;
      element("progress-label").textContent = label;
    });
    download(blob, `${state.fileName}-visualizer.mp4`);
    notify(`Exported MP4 · ${(blob.size / 1_000_000).toFixed(1)} MB`, 5000);
  } catch (error) {
    element("progress-label").textContent = error.message;
    notify(error.message, 6500);
    console.error(error);
  } finally {
    state.rendering = false;
    element("render-button").disabled = false;
    element("header-export").disabled = false;
  }
}

function bindControls() {
  element("flp-input").addEventListener("change", event => loadFlp(event.target.files[0]));
  element("audio-input").addEventListener("change", event => loadAudio(event.target.files[0]));
  const dropzone = element("flp-dropzone");
  for (const eventName of ["dragenter", "dragover"]) dropzone.addEventListener(eventName, event => { event.preventDefault(); dropzone.classList.add("dragging"); });
  for (const eventName of ["dragleave", "dragend"]) dropzone.addEventListener(eventName, () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", event => { event.preventDefault(); dropzone.classList.remove("dragging"); loadFlp(event.dataTransfer.files[0]); });
  element("play-button").onclick = () => setPlaying(!state.playing);
  element("restart-button").onclick = () => seek(0);
  element("timeline").oninput = event => seek(Number(event.target.value) / 1000 * state.project.duration);
  element("fullscreen-button").onclick = () => element("preview-frame").requestFullscreen?.();
  element("render-button").onclick = exportVideo;
  element("header-export").onclick = () => state.project ? exportVideo() : notify("Load an FLP project first.");
  element("midi-button").onclick = () => download(new Blob([createMidi(state.project, state.settings.enabledPatterns)], { type: "audio/midi" }), `${state.fileName}.mid`);

  element("background-input").oninput = event => { state.settings.background = event.target.value; state.visualizer?.draw(currentPosition()); };
  element("note-size-input").oninput = event => { state.settings.noteSize = Number(event.target.value); element("note-size-value").value = `${event.target.value}%`; state.visualizer?.draw(currentPosition()); };
  for (const [id, key] of [["playhead-input", "playhead"], ["effects-input", "effects"], ["percussion-input", "percussion"]]) {
    element(id).onchange = event => { state.settings[key] = event.target.checked; state.visualizer?.draw(currentPosition()); };
  }
  element("resolution-input").onchange = event => { state.settings.resolution = event.target.value; const [width, height] = event.target.value.split("x").map(Number); element("preview-frame").style.aspectRatio = `${width} / ${height}`; };
  element("fps-input").onchange = event => { state.settings.fps = Number(event.target.value); };
  element("size-input").onchange = event => { state.settings.maxSize = Number(event.target.value); };
  document.querySelectorAll(".nav-link").forEach(button => button.onclick = () => {
    document.querySelectorAll(".nav-link").forEach(item => item.classList.toggle("active", item === button));
    if (button.dataset.tab === "export") element("export-section").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  document.addEventListener("keydown", event => {
    if (event.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { event.preventDefault(); setPlaying(!state.playing); }
  });
}

function animationLoop() {
  if (state.project && state.playing && !state.rendering) {
    const position = currentPosition();
    if (position >= state.project.duration) setPlaying(false);
    else { state.visualizer.draw(position); updateTransport(); }
  }
  requestAnimationFrame(animationLoop);
}

bindControls();
requestAnimationFrame(animationLoop);
window.__ROLLPLAY__ = { state, loadFlp, loadAudio, seek, setPlaying, exportVideo, parseFlp, createMidi };
