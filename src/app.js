import { parseFlp } from "./flp-parser.js";
import { createMidi } from "./midi-export.js";
import { Visualizer, createLayerStyle } from "./visualizer.js";
import { renderMp4 } from "./exporter.js";
import { createColorRamp } from "./color-utils.js";

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
  selectedPatternIds: new Set(),
  lastSelectedPatternId: null,
  settings: {
    background: "#ffffff",
    backgroundMode: "solid",
    backgroundGradientStart: "#ffffff",
    backgroundGradientEnd: "#a78bef",
    backgroundGradientAngle: 135,
    backgroundImage: null,
    backgroundImageName: "",
    backgroundImageFit: "cover",
    noteSize: 145,
    barsVisible: 3,
    framePreset: "portrait",
    playhead: true,
    playheadOffset: 0,
    playheadColor: "#ff9d45",
    playheadThickness: 3,
    playheadGlow: 55,
    playheadOpacity: 100,
    effects: true,
    percussion: true,
    layerShadows: true,
    layerParallax: true,
    parallaxStrength: 100,
    resolution: "1080x1920",
    fps: 60,
    maxSize: 20,
    enabledPatterns: new Set(),
    trackModes: new Map(),
    layerStyles: new Map(),
    layerOrder: [],
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

function refreshBackgroundControls() {
  const mode = state.settings.backgroundMode ?? "solid";
  element("background-mode-input").value = mode;
  element("background-solid-controls").classList.toggle("hidden", mode !== "solid");
  element("background-gradient-controls").classList.toggle("hidden", mode !== "gradient");
  element("background-image-controls").classList.toggle("hidden", mode !== "image");
  element("background-input").value = state.settings.background;
  element("background-gradient-start").value = state.settings.backgroundGradientStart;
  element("background-gradient-end").value = state.settings.backgroundGradientEnd;
  element("background-gradient-angle-input").value = String(state.settings.backgroundGradientAngle);
  element("background-gradient-angle-value").value = `${state.settings.backgroundGradientAngle}°`;
  element("background-image-fit-input").value = state.settings.backgroundImageFit;
  element("background-image-name").textContent = state.settings.backgroundImageName || "No image selected";
}

async function loadBackgroundImage(file) {
  if (!file) return;
  try {
    if (typeof createImageBitmap !== "function") throw new Error("Image backgrounds require a browser with image decoding support.");
    const bitmap = await createImageBitmap(file);
    state.settings.backgroundImage?.close?.();
    state.settings.backgroundImage = bitmap;
    state.settings.backgroundImageName = file.name;
    state.settings.backgroundMode = "image";
    refreshBackgroundControls();
    state.visualizer?.draw(currentPosition());
    notify(`Background image loaded · ${file.name}`);
  } catch (error) {
    notify(`Unable to load background image: ${error.message}`, 5000);
    console.error(error);
  } finally {
    element("background-image-input").value = "";
  }
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

function layerStyle(patternId) {
  let style = state.settings.layerStyles.get(patternId);
  if (!style) {
    const colorIndex = state.project?.patterns.findIndex(pattern => pattern.id === patternId) ?? 0;
    style = createLayerStyle(Math.max(0, colorIndex));
    state.settings.layerStyles.set(patternId, style);
  }
  return style;
}

function selectedPatternIds() {
  return state.settings.layerOrder.filter(patternId => state.selectedPatternIds.has(patternId));
}

function commonValue(styles, property) {
  if (!styles.length) return null;
  return styles.every(style => style[property] === styles[0][property]) ? styles[0][property] : null;
}

function formatOctaveOffset(value) {
  const offset = Number(value) || 0;
  if (offset === 0) return "0 octaves";
  const amount = Math.abs(offset);
  return `${offset > 0 ? "+" : "−"}${amount} ${amount === 1 ? "octave" : "octaves"}`;
}

function refreshLayerStyleControls() {
  const selected = selectedPatternIds();
  const styles = selected.map(layerStyle);
  element("layer-style-controls").disabled = selected.length === 0;
  element("layer-style-empty").classList.toggle("hidden", selected.length > 0);
  element("selection-count").textContent = selected.length ? `${selected.length} selected` : "None selected";
  if (!styles.length) return;

  const properties = ["noteAnimation", "playedNoteHighlight", "particleAnimation", "colorMode", "primaryColor", "secondaryColor", "opacity", "octaveOffset"];
  const values = Object.fromEntries(properties.map(property => [property, commonValue(styles, property)]));
  element("note-animation-input").value = values.noteAnimation ?? "";
  element("played-note-highlight-input").value = values.playedNoteHighlight ?? "";
  element("particle-animation-input").value = values.particleAnimation ?? "";
  element("color-mode-input").value = values.colorMode ?? "";
  element("layer-color-primary").value = values.primaryColor ?? styles[0].primaryColor;
  element("layer-color-secondary").value = values.secondaryColor ?? styles[0].secondaryColor;
  const octaveOffset = values.octaveOffset ?? styles[0].octaveOffset ?? 0;
  element("layer-octave-offset-input").value = String(octaveOffset);
  element("layer-octave-offset-value").value = values.octaveOffset == null ? "Mixed" : formatOctaveOffset(octaveOffset);
  const transparency = Math.round((1 - (values.opacity ?? styles[0].opacity)) * 100);
  element("layer-opacity-input").value = String(transparency);
  element("layer-opacity-value").value = values.opacity == null ? "Mixed" : `${transparency}%`;
  element("gradient-color-row").classList.toggle("hidden", values.colorMode === "solid");
  const layerGradientControls = element("layer-gradient-controls");
  layerGradientControls.classList.toggle("hidden", selected.length < 2);
  const selectionKey = selected.join(",");
  if (selected.length > 1 && layerGradientControls.dataset.selection !== selectionKey) {
    element("layer-gradient-start").value = styles[0].primaryColor;
    element("layer-gradient-end").value = styles.at(-1).primaryColor;
    layerGradientControls.dataset.selection = selectionKey;
  }
  element("mixed-hint").classList.toggle("hidden", !Object.values(values).some(value => value == null));
}

function updatePatternSelection(patternId, selected, extendRange = false) {
  const order = state.settings.layerOrder;
  if (extendRange && state.lastSelectedPatternId != null) {
    const start = order.indexOf(state.lastSelectedPatternId);
    const end = order.indexOf(patternId);
    if (start >= 0 && end >= 0) {
      for (let index = Math.min(start, end); index <= Math.max(start, end); index++) {
        if (selected) state.selectedPatternIds.add(order[index]);
        else state.selectedPatternIds.delete(order[index]);
      }
    }
  } else if (selected) state.selectedPatternIds.add(patternId);
  else state.selectedPatternIds.delete(patternId);
  state.lastSelectedPatternId = patternId;
  refreshPatterns();
  refreshLayerStyleControls();
}

function selectOnlyPattern(patternId) {
  state.selectedPatternIds = new Set([patternId]);
  state.lastSelectedPatternId = patternId;
  refreshPatterns();
  refreshLayerStyleControls();
}

function applyLayerStyle(property, value) {
  for (const patternId of selectedPatternIds()) layerStyle(patternId)[property] = value;
  refreshPatterns();
  refreshLayerStyleControls();
  state.visualizer?.draw(currentPosition());
}

function applyLayerColorGradient() {
  const selected = selectedPatternIds();
  if (selected.length < 2) return;
  const colors = createColorRamp(element("layer-gradient-start").value, element("layer-gradient-end").value, selected.length);
  selected.forEach((patternId, index) => {
    const style = layerStyle(patternId);
    style.colorMode = "solid";
    style.primaryColor = colors[index];
    style.secondaryColor = colors[index];
  });
  refreshPatterns();
  refreshLayerStyleControls();
  state.visualizer?.draw(currentPosition());
  notify(`Applied a color gradient across ${selected.length} layers.`);
}

function refreshPatterns() {
  const container = element("pattern-list");
  container.replaceChildren();
  const patternsById = new Map(state.project.patterns.map(pattern => [pattern.id, pattern]));
  const orderedPatterns = state.settings.layerOrder.map(id => patternsById.get(id)).filter(Boolean);
  for (const [layerIndex, pattern] of orderedPatterns.entries()) {
    const style = layerStyle(pattern.id);
    const row = document.createElement("div");
    row.className = `pattern-row${state.settings.enabledPatterns.has(pattern.id) ? "" : " muted-pattern"}${state.selectedPatternIds.has(pattern.id) ? " selected-pattern" : ""}`;
    row.draggable = true;
    row.dataset.patternId = String(pattern.id);
    row.addEventListener("dragstart", event => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(pattern.id));
      row.classList.add("dragging-layer");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging-layer");
      container.querySelectorAll(".drop-target").forEach(item => item.classList.remove("drop-target"));
    });
    row.addEventListener("dragover", event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", event => {
      event.preventDefault();
      row.classList.remove("drop-target");
      movePatternLayer(Number(event.dataTransfer.getData("text/plain")), layerIndex);
    });
    const selection = document.createElement("input");
    selection.type = "checkbox";
    selection.className = "pattern-select";
    selection.checked = state.selectedPatternIds.has(pattern.id);
    selection.setAttribute("aria-label", `Select ${pattern.name}`);
    selection.onclick = event => updatePatternSelection(pattern.id, event.currentTarget.checked, event.shiftKey);
    const swatch = document.createElement("button");
    swatch.className = "pattern-swatch";
    swatch.style.background = style.colorMode === "gradient" ? `linear-gradient(90deg, ${style.primaryColor}, ${style.secondaryColor})` : style.primaryColor;
    swatch.setAttribute("aria-label", `Edit ${pattern.name} style`);
    swatch.title = "Edit layer style";
    swatch.onclick = event => {
      if (event.metaKey || event.ctrlKey) updatePatternSelection(pattern.id, !state.selectedPatternIds.has(pattern.id));
      else selectOnlyPattern(pattern.id);
    };
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
      const targets = state.selectedPatternIds.has(pattern.id) ? selectedPatternIds() : [pattern.id];
      for (const patternId of targets) state.settings.trackModes.set(patternId, nextMode);
      refreshPatterns();
      state.visualizer.draw(currentPosition());
      notify(targets.length > 1 ? `${targets.length} layers: ${nextMode === "step" ? "step percussion" : "melody"} rendering` : `${pattern.name}: ${nextMode === "step" ? "step percussion" : "melody"} rendering`);
    };
    updateModeButton();
    const layerControls = document.createElement("span");
    layerControls.className = "layer-controls";
    const up = document.createElement("button");
    up.className = "layer-button";
    up.disabled = layerIndex === 0;
    up.title = "Move layer up";
    up.setAttribute("aria-label", `Move ${pattern.name} above the previous track`);
    up.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 10 4-4 4 4"/></svg>';
    up.onclick = () => movePatternLayer(pattern.id, layerIndex - 1);
    const down = document.createElement("button");
    down.className = "layer-button";
    down.disabled = layerIndex === orderedPatterns.length - 1;
    down.title = "Move layer down";
    down.setAttribute("aria-label", `Move ${pattern.name} below the next track`);
    down.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>';
    down.onclick = () => movePatternLayer(pattern.id, layerIndex + 1);
    layerControls.append(up, down);
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
    row.append(selection, swatch, name, layerControls, mode, toggle);
    container.append(row);
  }
}

function movePatternLayer(patternId, targetIndex) {
  const order = state.settings.layerOrder;
  const previousIndex = order.indexOf(patternId);
  if (previousIndex < 0 || targetIndex < 0 || targetIndex >= order.length || previousIndex === targetIndex) return;
  order.splice(previousIndex, 1);
  order.splice(targetIndex, 0, patternId);
  refreshPatterns();
  state.visualizer.draw(currentPosition());
  const pattern = state.project.patterns.find(item => item.id === patternId);
  notify(`${pattern?.name || "Track"}: layer ${targetIndex + 1} of ${order.length}`);
}

async function loadFlp(file) {
  if (!file) return;
  try {
    if (state.playing) await setPlaying(false);
    const project = parseFlp(await file.arrayBuffer());
    state.project = project;
    state.fileName = file.name.replace(/\.flp$/i, "");
    state.settings.enabledPatterns = new Set(project.patterns.map(pattern => pattern.id));
    state.settings.layerOrder = project.patterns.map(pattern => pattern.id);
    state.settings.layerStyles = new Map(project.patterns.map((pattern, index) => [pattern.id, createLayerStyle(index)]));
    state.selectedPatternIds = new Set(project.patterns.length ? [project.patterns[0].id] : []);
    state.lastSelectedPatternId = project.patterns[0]?.id ?? null;
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
    element("select-all-patterns").disabled = project.patterns.length === 0;
    element("clear-pattern-selection").disabled = project.patterns.length === 0;
    refreshPatterns();
    refreshLayerStyleControls();
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

function applyFrameSettings(resolution, preset) {
  const [width, height] = resolution.split("x").map(Number);
  state.settings.resolution = resolution;
  state.settings.framePreset = preset;
  element("resolution-input").value = resolution;
  element("frame-preset-input").value = preset;
  element("zoom-axis-label").textContent = preset === "landscape" ? "Vertical zoom" : "Horizontal zoom";
  const offsetAxis = preset === "landscape" ? "Vertical" : "Horizontal";
  const offsetDirection = preset === "landscape" ? "− bottom · + top" : "− left · + right";
  element("playhead-offset-label").textContent = `${offsetAxis} offset`;
  element("playhead-offset-input").setAttribute("aria-label", `${offsetAxis} playhead offset`);
  element("playhead-offset-hint").textContent = offsetDirection;
  element("preview-frame").style.aspectRatio = `${width} / ${height}`;
  const canvas = element("preview");
  canvas.width = width;
  canvas.height = height;
  state.visualizer?.draw(currentPosition());
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
  element("select-all-patterns").onclick = () => {
    state.selectedPatternIds = new Set(state.settings.layerOrder);
    state.lastSelectedPatternId = state.settings.layerOrder.at(-1) ?? null;
    refreshPatterns();
    refreshLayerStyleControls();
  };
  element("clear-pattern-selection").onclick = () => {
    state.selectedPatternIds.clear();
    state.lastSelectedPatternId = null;
    refreshPatterns();
    refreshLayerStyleControls();
  };

  element("background-mode-input").onchange = event => {
    state.settings.backgroundMode = event.target.value;
    refreshBackgroundControls();
    state.visualizer?.draw(currentPosition());
  };
  element("background-input").oninput = event => { state.settings.background = event.target.value; state.visualizer?.draw(currentPosition()); };
  element("background-gradient-start").oninput = event => { state.settings.backgroundGradientStart = event.target.value; state.visualizer?.draw(currentPosition()); };
  element("background-gradient-end").oninput = event => { state.settings.backgroundGradientEnd = event.target.value; state.visualizer?.draw(currentPosition()); };
  element("background-gradient-angle-input").oninput = event => {
    state.settings.backgroundGradientAngle = Number(event.target.value);
    element("background-gradient-angle-value").value = `${event.target.value}°`;
    state.visualizer?.draw(currentPosition());
  };
  element("background-image-input").onchange = event => loadBackgroundImage(event.target.files[0]);
  element("background-image-fit-input").onchange = event => {
    state.settings.backgroundImageFit = event.target.value;
    state.visualizer?.draw(currentPosition());
  };
  element("frame-preset-input").onchange = event => {
    const preset = event.target.value;
    applyFrameSettings(preset === "landscape" ? "1920x1080" : "1080x1920", preset);
  };
  element("note-size-input").oninput = event => { state.settings.noteSize = Number(event.target.value); element("note-size-value").value = `${event.target.value}%`; state.visualizer?.draw(currentPosition()); };
  element("bars-visible-input").oninput = event => {
    const bars = Number(event.target.value);
    state.settings.barsVisible = bars;
    element("bars-visible-value").value = `${bars} ${bars === 1 ? "bar" : "bars"}`;
    state.visualizer?.draw(currentPosition());
  };
  element("playhead-input").onchange = event => {
    state.settings.playhead = event.target.checked;
    element("playhead-customization").disabled = !event.target.checked;
    state.visualizer?.draw(currentPosition());
  };
  element("playhead-offset-input").oninput = event => {
    const offset = Number(event.target.value);
    state.settings.playheadOffset = offset;
    element("playhead-offset-value").value = `${offset > 0 ? "+" : ""}${offset}%`;
    state.visualizer?.draw(currentPosition());
  };
  element("reset-playhead-offset").onclick = () => {
    state.settings.playheadOffset = 0;
    element("playhead-offset-input").value = "0";
    element("playhead-offset-value").value = "0%";
    state.visualizer?.draw(currentPosition());
  };
  element("playhead-color-input").oninput = event => { state.settings.playheadColor = event.target.value; state.visualizer?.draw(currentPosition()); };
  for (const [id, key, outputId, suffix] of [
    ["playhead-thickness-input", "playheadThickness", "playhead-thickness-value", ""],
    ["playhead-glow-input", "playheadGlow", "playhead-glow-value", "%"],
    ["playhead-opacity-input", "playheadOpacity", "playhead-opacity-value", "%"],
  ]) {
    element(id).oninput = event => {
      state.settings[key] = Number(event.target.value);
      element(outputId).value = `${event.target.value}${suffix}`;
      state.visualizer?.draw(currentPosition());
    };
  }
  for (const [id, key] of [
    ["effects-input", "effects"],
    ["percussion-input", "percussion"],
    ["layer-shadows-input", "layerShadows"],
  ]) {
    element(id).onchange = event => { state.settings[key] = event.target.checked; state.visualizer?.draw(currentPosition()); };
  }
  element("layer-parallax-input").onchange = event => {
    state.settings.layerParallax = event.target.checked;
    element("parallax-strength-input").disabled = !event.target.checked;
    state.visualizer?.draw(currentPosition());
  };
  element("parallax-strength-input").oninput = event => {
    state.settings.parallaxStrength = Number(event.target.value);
    element("parallax-strength-value").value = `${event.target.value}%`;
    state.visualizer?.draw(currentPosition());
  };
  for (const [id, property] of [["note-animation-input", "noteAnimation"], ["played-note-highlight-input", "playedNoteHighlight"], ["particle-animation-input", "particleAnimation"], ["color-mode-input", "colorMode"]]) {
    element(id).onchange = event => applyLayerStyle(property, event.target.value);
  }
  element("layer-octave-offset-input").oninput = event => {
    const rawOffset = Number(event.target.value);
    const offset = Number.isFinite(rawOffset) ? Math.max(-4, Math.min(4, Math.round(rawOffset))) : 0;
    applyLayerStyle("octaveOffset", offset);
  };
  element("layer-color-primary").oninput = event => applyLayerStyle("primaryColor", event.target.value);
  element("layer-color-secondary").oninput = event => applyLayerStyle("secondaryColor", event.target.value);
  element("apply-layer-gradient").onclick = applyLayerColorGradient;
  element("layer-opacity-input").oninput = event => applyLayerStyle("opacity", 1 - Number(event.target.value) / 100);
  element("resolution-input").onchange = event => {
    const [width, height] = event.target.value.split("x").map(Number);
    applyFrameSettings(event.target.value, width > height ? "landscape" : "portrait");
  };
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
refreshBackgroundControls();
requestAnimationFrame(animationLoop);
window.__ROLLPLAY__ = { state, loadFlp, loadAudio, seek, setPlaying, exportVideo, parseFlp, createMidi, movePatternLayer };
