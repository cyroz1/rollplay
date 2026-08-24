import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseFlp } from "../src/flp-parser.js";
import { Visualizer, createLayerStyle } from "../src/visualizer.js";
import { muxMp4 } from "../src/mp4-muxer.js";
import { createColorRamp } from "../src/color-utils.js";

test("creates an inclusive color gradient across selected layers", () => {
  assert.deepEqual(createColorRamp("#ff0000", "#0000ff", 3), ["#ff0000", "#800080", "#0000ff"]);
  assert.deepEqual(createColorRamp("#123456", "#abcdef", 1), ["#123456"]);
});

test("note and particle rendering contains no heart icons", async () => {
  const source = await readFile(new URL("../src/visualizer.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bheart\s*\(/i);
});

test("layer styles support independent colors, opacity, and note animations", () => {
  const note = { at: 0, length: 96, key: 60, channel: 0, velocity: 127, patternId: 1 };
  const project = { tempo: 120, ppq: 96, patterns: [{ id: 1, name: "Lead", notes: [note] }], notes: [note] };
  const settings = {
    effects: true,
    layerStyles: new Map([[1, {
      ...createLayerStyle(0), colorMode: "solid", primaryColor: "#123456", secondaryColor: "#abcdef",
      opacity: .35, noteAnimation: "wave", playedNoteHighlight: "constant", particleAnimation: "float",
    }]]),
  };
  const canvas = { width: 1080, height: 1920, getContext: () => ({}) };
  const visualizer = new Visualizer(canvas, project, settings);

  assert.deepEqual(visualizer.color(note), ["#123456", "#123456"], "Solid layers should use the primary color at both gradient stops.");
  assert.equal(visualizer.layerStyle(1).opacity, .35);
  assert.equal(visualizer.layerStyle(1).particleAnimation, "float");
  assert.equal(visualizer.noteHighlightOpacity(note, 24), .28);
  assert.notEqual(visualizer.noteMotion(note, 24, 1).offset, 0, "Wave animation should offset a recently hit note.");

  settings.layerStyles.get(1).playedNoteHighlight = "pulse";
  assert.equal(visualizer.noteHighlightOpacity(note, 0), 0, "The pulse should begin at note onset.");
  assert.ok(visualizer.noteHighlightOpacity(note, 24) > visualizer.noteHighlightOpacity(note, 12), "The pulse should rise once.");
  assert.equal(visualizer.noteHighlightOpacity(note, 60), 0, "The pulse should finish and stay off.");
  settings.layerStyles.get(1).playedNoteHighlight = "none";
  assert.equal(visualizer.noteHighlightOpacity(note, 24), 0);
  settings.layerStyles.get(1).playedNoteHighlight = "constant";
  assert.equal(visualizer.noteHighlightOpacity(note, note.length), 0, "Finished notes should not remain highlighted.");

  Object.assign(settings, { playheadColor: "#123456", playheadThickness: 20, playheadGlow: 125, playheadOpacity: 5 });
  assert.deepEqual(visualizer.playheadStyle(1080), { color: "#123456", thickness: 12, glow: 1, opacity: .1 });
  settings.playheadOffset = 12;
  assert.equal(visualizer.playheadPosition(1080), 1080 * .53, "Portrait offsets should move the playhead right for positive values.");
  settings.framePreset = "landscape";
  assert.ok(Math.abs(visualizer.playheadPosition(1080) - 1080 * .04) < 1e-9, "Landscape offsets should move the playhead down for positive values.");

  settings.layerStyles.get(1).colorMode = "gradient";
  settings.layerStyles.get(1).noteAnimation = "none";
  assert.deepEqual(visualizer.color(note), ["#123456", "#abcdef"]);
  assert.deepEqual(visualizer.noteMotion(note, 24, 1), { size: 0, offset: 0 });
});

test("renders actual FLP notes and the playhead to a real canvas", async context => {
  let createCanvas;
  try { ({ createCanvas } = createRequire(import.meta.url)("@napi-rs/canvas")); }
  catch { context.skip("Optional native canvas package is not installed."); return; }
  let fixture;
  try { fixture = await readFile(new URL("../../upload/key.flp", import.meta.url)); }
  catch { context.skip("Private FLP fixture is not included in the repository."); return; }
  const project = parseFlp(fixture);
  const canvas = createCanvas(1080, 1920);
  const settings = { background: "#ffffff", noteSize: 145, playhead: true, effects: true, percussion: true, enabledPatterns: new Set(project.patterns.map(pattern => pattern.id)) };
  const visualizer = new Visualizer(canvas, project, settings);
  visualizer.draw(17);
  const pixel = canvas.getContext("2d").getImageData(Math.round(1080 * .41), 1100, 1, 1).data;
  assert.ok(pixel[0] < 255 || pixel[1] < 255 || pixel[2] < 255, "The vertical playhead should color the otherwise white background.");
});

test("multiplexes browser-encoded H.264 samples into ISO MP4 boxes", async () => {
  const video = {
    type: "video", timescale: 1_000_000, width: 1080, height: 1920, duration: 33334,
    description: new Uint8Array([1, 66, 0, 42, 255, 225, 0, 1, 103, 1, 0, 1, 104]),
    samples: [
      { index: 0, timestamp: 0, duration: 16667, key: true, data: new Uint8Array([0, 0, 0, 1, 101]) },
      { index: 1, timestamp: 16667, duration: 16667, key: false, data: new Uint8Array([0, 0, 0, 1, 65]) },
    ],
  };
  const blob = muxMp4(video);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  assert.equal(blob.type, "video/mp4");
  for (const required of ["ftyp", "mdat", "moov", "trak", "avc1", "avcC", "stss"]) assert.ok(text.includes(required), `${required} box is missing.`);
});

test("tracks can independently switch between melody and step-percussion rendering", async context => {
  let createCanvas;
  try { ({ createCanvas } = createRequire(import.meta.url)("@napi-rs/canvas")); }
  catch { context.skip("Optional native canvas package is not installed."); return; }
  let fixture;
  try { fixture = await readFile(new URL("../../upload/key.flp", import.meta.url)); }
  catch { context.skip("Private FLP fixture is not included in the repository."); return; }

  const project = parseFlp(fixture);
  const melody = project.notes.find(note => note.channel === 0);
  const drums = project.notes.find(note => note.channel === 8);
  const trackModes = new Map(project.patterns.map(pattern => [pattern.id, "melody"]));
  const settings = { background: "#ffffff", noteSize: 145, playhead: true, effects: true, percussion: true, trackModes, enabledPatterns: new Set(project.patterns.map(pattern => pattern.id)) };
  const visualizer = new Visualizer(createCanvas(1080, 1920), project, settings);

  assert.equal(visualizer.isStep(melody), false);
  assert.equal(visualizer.isStep(drums), false, "A drum-channel track can be forced into melody mode.");
  assert.ok(visualizer.noteY(drums, 1920) < 1920 * .74);

  trackModes.set(melody.patternId, "step");
  visualizer.refreshStepLanes();
  assert.equal(visualizer.isStep(melody), true, "A melodic-channel track can be forced into step mode.");
  assert.ok(visualizer.noteY(melody, 1920) >= 1920 * .755);
  assert.equal(visualizer.isStep(drums), false, "Changing one track must not change another.");
  visualizer.draw(17);
});

test("track layer order determines which overlapping notes render on top", async context => {
  let createCanvas;
  try { ({ createCanvas } = createRequire(import.meta.url)("@napi-rs/canvas")); }
  catch { context.skip("Optional native canvas package is not installed."); return; }

  const note = { at: 0, length: 96, key: 60, channel: 0, velocity: 127 };
  const project = {
    tempo: 120,
    ppq: 96,
    patterns: [{ id: 1, name: "Pink", notes: [note] }, { id: 2, name: "Purple", notes: [note] }],
    notes: [{ ...note, patternId: 1 }, { ...note, patternId: 2 }],
  };
  const canvas = createCanvas(1080, 1920);
  const settings = {
    background: "#ffffff", noteSize: 145, playhead: false, effects: false, percussion: true,
    enabledPatterns: new Set([1, 2]), trackModes: new Map([[1, "melody"], [2, "melody"]]), layerOrder: [1, 2],
  };
  const visualizer = new Visualizer(canvas, project, settings);
  const sampleX = Math.round(1080 * .41 + 35);
  const sampleY = Math.round(visualizer.noteY(project.notes[0], 1920));

  visualizer.draw(0);
  const pinkOnTop = canvas.getContext("2d").getImageData(sampleX, sampleY, 1, 1).data;
  assert.ok(pinkOnTop[0] > pinkOnTop[2], "The first listed track should draw on top.");

  settings.layerOrder = [2, 1];
  visualizer.draw(0);
  const purpleOnTop = canvas.getContext("2d").getImageData(sampleX, sampleY, 1, 1).data;
  assert.ok(purpleOnTop[2] > purpleOnTop[0], "Moving the second track above the first should change the visible overlap.");
});

test("horizontal zoom changes the visible range from one to eight bars", async context => {
  let createCanvas;
  try { ({ createCanvas } = createRequire(import.meta.url)("@napi-rs/canvas")); }
  catch { context.skip("Optional native canvas package is not installed."); return; }

  const note = { at: 0, length: 96, key: 60, channel: 0, velocity: 100, patternId: 1 };
  const project = {
    tempo: 120,
    ppq: 96,
    patterns: [{ id: 1, name: "Lead", notes: [note] }],
    notes: [note],
  };
  const canvas = createCanvas(1080, 1920);
  const settings = {
    background: "#ffffff", noteSize: 145, barsVisible: 1, playhead: false, effects: false, percussion: true,
    enabledPatterns: new Set([1]), trackModes: new Map([[1, "melody"]]), layerOrder: [1],
  };
  const visualizer = new Visualizer(canvas, project, settings);
  const oneBar = visualizer.pixelsPerTick(1080);
  assert.equal(oneBar * project.ppq * 4, 1080);
  visualizer.draw(0);

  settings.barsVisible = 8;
  const eightBars = visualizer.pixelsPerTick(1080);
  assert.equal(eightBars * project.ppq * 4 * 8, 1080);
  assert.equal(oneBar / eightBars, 8, "Zooming from one to eight bars should change scrolling speed eightfold.");
  visualizer.draw(0);
});

test("landscape preset drops notes toward a horizontal playhead near the bottom", async context => {
  let createCanvas;
  try { ({ createCanvas } = createRequire(import.meta.url)("@napi-rs/canvas")); }
  catch { context.skip("Optional native canvas package is not installed."); return; }

  const note = { at: 96, length: 96, key: 60, channel: 0, velocity: 127, patternId: 1 };
  const project = {
    tempo: 120, ppq: 96,
    patterns: [{ id: 1, name: "Lead", notes: [note] }],
    notes: [note],
  };
  const canvas = createCanvas(1920, 1080);
  const settings = {
    background: "#ffffff", noteSize: 145, barsVisible: 1, framePreset: "landscape", playhead: true, effects: false,
    percussion: true, enabledPatterns: new Set([1]), trackModes: new Map([[1, "melody"]]), layerOrder: [1],
  };
  const visualizer = new Visualizer(canvas, project, settings);
  const context2d = canvas.getContext("2d");
  const playheadY = Math.round(1080 * .84);
  const noteX = Math.round(visualizer.noteY(note, 1920));
  const pixelsPerTick = visualizer.pixelsPerTick(1080);
  const noteCenterY = Math.round(playheadY - (note.at + note.length / 2) * pixelsPerTick);

  visualizer.draw(0);
  const playhead = context2d.getImageData(960, playheadY, 1, 1).data;
  assert.ok(playhead[0] < 255 || playhead[1] < 255 || playhead[2] < 255, "A horizontal playhead should appear near the bottom.");
  const incoming = context2d.getImageData(noteX, noteCenterY, 1, 1).data;
  assert.ok(incoming[1] < 250, "Upcoming notes should appear above the playhead.");

  visualizer.draw(.25);
  const descending = context2d.getImageData(noteX, Math.round(noteCenterY + project.ppq / 2 * pixelsPerTick), 1, 1).data;
  assert.ok(descending[1] < 250, "As playback progresses, notes should travel downward.");
});
