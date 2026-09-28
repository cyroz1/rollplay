import test from "node:test";
import assert from "node:assert/strict";
import { computePeaks, matchAudioPattern } from "../src/waveform.js";

function fakeBuffer(channels, length, fill) {
  return {
    length,
    numberOfChannels: channels.length,
    getChannelData(channel) {
      const data = new Float32Array(length);
      data.fill(channels[channel]);
      return fill ? fill(channel, data) : data;
    },
  };
}

test("computePeaks normalizes so the loudest bucket reaches 1", () => {
  const peaks = computePeaks(fakeBuffer([0.1, 0.4], 1000), 10);
  assert.equal(peaks.length, 10);
  assert.ok(peaks.every(peak => peak >= 0 && peak <= 1));
  assert.equal(Math.max(...peaks), 1, "The loudest bucket should normalize to 1.");
});

test("computePeaks mixes down channels by their absolute amplitude", () => {
  const buffer = fakeBuffer([0, 0], 1000, (channel, data) => {
    if (channel === 1) data.fill(-0.5);
    return data;
  });
  const peaks = computePeaks(buffer, 8);
  assert.ok(peaks.every(peak => peak === 1), "The loud negative channel should dominate the mixdown.");
});

test("computePeaks returns zeros for empty or silent buffers", () => {
  assert.deepEqual(Array.from(computePeaks(fakeBuffer([0], 100), 4)), [0, 0, 0, 0]);
  assert.deepEqual(Array.from(computePeaks(null, 4)), [0, 0, 0, 0]);
  assert.deepEqual(Array.from(computePeaks({ length: 0, numberOfChannels: 1 }, 4)), [0, 0, 0, 0]);
});

test("matchAudioPattern matches filenames against sound names and sample paths", () => {
  const patterns = [
    { id: 1, soundName: "Riser", soundKey: "riser", samplePath: "/samples/riser.wav" },
    { id: 2, soundName: "Kick", soundKey: "kick", samplePath: "/samples/kick-808.wav" },
  ];
  assert.equal(matchAudioPattern(patterns, "riser.wav").id, 1);
  assert.equal(matchAudioPattern(patterns, "Riser").id, 1);
  assert.equal(matchAudioPattern(patterns, "kick-808.wav").id, 2, "The sample path's file name should match.");
  assert.equal(matchAudioPattern(patterns, "snare.wav"), null, "Unrelated files should not match.");
  assert.equal(matchAudioPattern(patterns, ""), null);
});
