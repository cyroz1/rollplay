import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseFlp } from "../src/flp-parser.js";
import { createMidi } from "../src/midi-export.js";

test("rejects invalid FL Studio projects", () => {
  assert.throws(() => parseFlp(new Uint8Array(40)), /valid FL Studio project/);
});

test("exports a standards-compliant MIDI header", () => {
  const project = { tempo: 148, ppq: 96, patterns: [{ id: 1, name: "Lead" }], notes: [{ at: 0, length: 96, key: 60, channel: 0, velocity: 100, patternId: 1 }] };
  const midi = createMidi(project);
  assert.equal(new TextDecoder().decode(midi.subarray(0, 4)), "MThd");
  assert.equal(new DataView(midi.buffer).getUint16(10), 2);
});

test("parses the supplied FL Studio 26 fixture when available", async context => {
  let fixture;
  try { fixture = await readFile(new URL("../../upload/key.flp", import.meta.url)); }
  catch { context.skip("Private FLP fixture is not included in the repository."); return; }
  const project = parseFlp(fixture);
  assert.equal(project.version, "26.1.4.5589");
  assert.equal(project.tempo, 148);
  assert.equal(project.ppq, 96);
  assert.equal(project.patterns.length, 15);
  assert.equal(project.clips.length, 172);
  assert.equal(project.notes.length, 6550);
});
