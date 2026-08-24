import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseFlp } from "../src/flp-parser.js";
import { Visualizer } from "../src/visualizer.js";
import { muxMp4 } from "../src/mp4-muxer.js";

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
