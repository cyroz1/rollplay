import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseFlp } from "../src/flp-parser.js";
import { createMidi } from "../src/midi-export.js";

const encoder = new TextEncoder();

function varint(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return bytes;
}

function concat(...parts) {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function blobEvent(id, payload) {
  return concat(new Uint8Array([id, ...varint(payload.length)]), payload);
}

function makeNote(position, channel = 0) {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, position, true);
  view.setUint16(6, channel, true);
  view.setUint32(8, 96, true);
  view.setUint16(12, 60, true);
  view.setUint8(21, 100);
  return bytes;
}

function makePlaylistRecord(position, recordSize) {
  const bytes = new Uint8Array(recordSize);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, position, true);
  view.setUint16(4, 0x5000, true);
  view.setUint16(6, 0x5001, true);
  view.setUint32(8, 384, true);
  view.setUint16(12, 499, true);
  return bytes;
}

function makeChannelPlaylistRecord(position, recordSize, channelId) {
  const bytes = makePlaylistRecord(position, recordSize);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, channelId, true);
  return bytes;
}

function utf16(value) {
  return new Uint8Array(Buffer.from(`${value}\0`, "utf16le"));
}

function makeFlp({ recordSize, clipCount, version = "25.2.4.4960", noteEvent = 224, noteChannels = [0, 0, 0] }) {
  const notes = concat(...noteChannels.map((channel, index) => makeNote(index * 96, channel)));
  const playlist = concat(...Array.from({ length: clipCount }, (_, index) => makePlaylistRecord(index * 384, recordSize)));
  const events = concat(
    new Uint8Array([65, 1, 0]),
    blobEvent(noteEvent, notes),
    blobEvent(199, encoder.encode(`${version}\0`)),
    blobEvent(233, playlist),
  );
  const bytes = new Uint8Array(22 + events.length);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode("FLhd"), 0);
  view.setUint32(4, 6, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 1, true);
  view.setUint16(12, 96, true);
  bytes.set(encoder.encode("FLdt"), 14);
  view.setUint32(18, events.length, true);
  bytes.set(events, 22);
  return bytes;
}

test("rejects invalid FL Studio projects", () => {
  assert.throws(() => parseFlp(new Uint8Array(40)), /valid FL Studio project/);
});

test("exports a standards-compliant MIDI header", () => {
  const project = { tempo: 148, ppq: 96, patterns: [{ id: 1, name: "Lead" }], notes: [{ at: 0, length: 96, key: 60, channel: 0, velocity: 100, patternId: 1 }] };
  const midi = createMidi(project);
  assert.equal(new TextDecoder().decode(midi.subarray(0, 4)), "MThd");
  assert.equal(new DataView(midi.buffer).getUint16(10), 2);
});

test("detects the real playlist stride when its byte length matches multiple layouts", () => {
  const project = parseFlp(makeFlp({ recordSize: 20, clipCount: 44, version: "20.9.2.2963" }));
  assert.equal(project.clips.length, 44);
  assert.equal(project.notes.length, 44 * 3);
  assert.equal(project.clips.at(-1).at, 43 * 384);
});

test("reads modern 80-byte playlist records and legacy pattern-note events", () => {
  const project = parseFlp(makeFlp({ recordSize: 80, clipCount: 14, noteEvent: 208 }));
  assert.equal(project.clips.length, 14);
  assert.equal(project.notes.length, 14 * 3);
  assert.equal(project.duration, (13 * 384 + 384) / 96 * 60 / 120);
});

test("splits grouped patterns into channel-specific layers", () => {
  const project = parseFlp(makeFlp({ recordSize: 80, clipCount: 1, noteChannels: [0, 1, 0] }));
  assert.equal(project.patterns.length, 2);
  assert.equal(project.clips.length, 2);
  assert.equal(project.notes.length, 3);
  assert.deepEqual(project.patterns.map(pattern => pattern.notes.length), [2, 1]);
  assert.deepEqual(project.patterns.map(pattern => pattern.name), ["Pattern 1 · Channel 1", "Pattern 1 · Channel 2"]);
  assert.equal(new Set(project.notes.map(note => note.patternId)).size, 2);
  assert.equal(new DataView(createMidi(project).buffer).getUint16(10), 3, "Each channel layer should export as its own MIDI track.");
});

test("keeps all FL Studio 26 playlist clips", () => {
  const project = parseFlp(makeFlp({ recordSize: 88, clipCount: 172, version: "26.1.4.5589" }));
  assert.equal(project.clips.length, 172);
  assert.equal(project.notes.length, 172 * 3);
});

test("turns direct FL Studio audio playlist clips into grouped percussion layers", () => {
  const playlist = concat(
    makePlaylistRecord(0, 80),
    makeChannelPlaylistRecord(384, 80, 11),
    makeChannelPlaylistRecord(768, 80, 11),
    makeChannelPlaylistRecord(1152, 80, 11),
  );
  const events = concat(
    new Uint8Array([64, 11, 0, 21, 4]),
    blobEvent(203, utf16("FX Hit")),
    blobEvent(196, utf16("/Samples/FX Hit.wav")),
    new Uint8Array([65, 1, 0]),
    blobEvent(224, concat(makeNote(0))),
    blobEvent(199, encoder.encode("25.2.4.4960\0")),
    blobEvent(233, playlist),
  );
  const bytes = new Uint8Array(22 + events.length);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode("FLhd"), 0);
  view.setUint32(4, 6, true);
  view.setUint16(10, 12, true);
  view.setUint16(12, 96, true);
  bytes.set(encoder.encode("FLdt"), 14);
  view.setUint32(18, events.length, true);
  bytes.set(events, 22);

  const project = parseFlp(bytes);
  const audioPatterns = project.patterns.filter(pattern => pattern.isAudio);
  const audioClips = project.clips.filter(clip => clip.kind === "audio");
  const audioNotes = project.notes.filter(note => note.channel === 10);

  assert.equal(audioPatterns.length, 1);
  assert.equal(audioPatterns[0].name, "FX Hit");
  assert.equal(audioPatterns[0].isPercussion, true);
  assert.equal(audioClips.length, 3);
  assert.equal(audioNotes.length, 3);
  assert.deepEqual(audioNotes.map(note => note.at), [384, 768, 1152]);
  assert.equal(new Set(audioClips.map(clip => clip.patternId)).size, 1);
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
