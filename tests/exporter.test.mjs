import test from "node:test";
import assert from "node:assert/strict";
import { projectBarCount, projectBarSeconds, resolveRenderRange } from "../src/exporter.js";

// 120 BPM: one bar (4 beats) lasts 2 seconds, so 60 seconds is 30 bars.
const project = { tempo: 120, duration: 60 };

test("bar math follows the 4/4 parser model", () => {
  assert.equal(projectBarSeconds(project), 2);
  assert.equal(projectBarCount(project), 30);
  assert.equal(projectBarCount({ tempo: 120, duration: 61 }), 31);
  assert.equal(projectBarSeconds({ tempo: 60, duration: 60 }), 4);
  assert.equal(projectBarSeconds({ tempo: 0, duration: 60 }), 2); // falls back to 120 BPM
});

test("full mode renders the whole available duration", () => {
  assert.deepEqual(resolveRenderRange(project, {}, 60), { start: 0, end: 60, duration: 60 });
  assert.deepEqual(resolveRenderRange(project, { rangeMode: "full" }, 42), { start: 0, end: 42, duration: 42 });
});

test("bar range converts 1-based inclusive bars to seconds", () => {
  assert.deepEqual(
    resolveRenderRange(project, { rangeMode: "bars", rangeStartBar: 5, rangeEndBar: 8 }, 60),
    { start: 8, end: 16, duration: 8 },
  );
});

test("bar range with end bar 0 runs to the last bar", () => {
  assert.deepEqual(
    resolveRenderRange(project, { rangeMode: "bars", rangeStartBar: 29, rangeEndBar: 0 }, 60),
    { start: 56, end: 60, duration: 4 },
  );
});

test("bar range clamps to the project and the available duration", () => {
  assert.deepEqual(
    resolveRenderRange(project, { rangeMode: "bars", rangeStartBar: 25, rangeEndBar: 99 }, 60),
    { start: 48, end: 60, duration: 12 },
  );
  // Audio shorter than the project caps the end.
  assert.deepEqual(
    resolveRenderRange(project, { rangeMode: "bars", rangeStartBar: 25, rangeEndBar: 30 }, 50),
    { start: 48, end: 50, duration: 2 },
  );
});

test("time range uses seconds and end time 0 means the end", () => {
  assert.deepEqual(
    resolveRenderRange(project, { rangeMode: "time", rangeStartTime: 10, rangeEndTime: 25 }, 60),
    { start: 10, end: 25, duration: 15 },
  );
  assert.deepEqual(
    resolveRenderRange(project, { rangeMode: "time", rangeStartTime: 45, rangeEndTime: 0 }, 60),
    { start: 45, end: 60, duration: 15 },
  );
});

test("unusable ranges fall back to the full duration", () => {
  assert.deepEqual(
    resolveRenderRange(project, { rangeMode: "time", rangeStartTime: 30, rangeEndTime: 30 }, 60),
    { start: 0, end: 60, duration: 60 },
  );
  assert.deepEqual(
    resolveRenderRange(project, { rangeMode: "time", rangeStartTime: 90, rangeEndTime: 0 }, 60),
    { start: 0, end: 60, duration: 60 },
  );
  assert.deepEqual(resolveRenderRange(project, { rangeMode: "bars" }, 0), { start: 0, end: 0, duration: 0 });
});
