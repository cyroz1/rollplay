import test from "node:test";
import assert from "node:assert/strict";
import {
  findPresetRecord,
  readPresetRecords,
  removePresetRecord,
  snapshotGlobalSettings,
  upsertPresetRecord,
  writePresetRecords,
} from "../src/preset-store.js";

test("global customization presets round-trip without project-specific state", () => {
  const settings = {
    background: "#ffffff",
    noteSize: 145,
    melodyVerticalZoom: 140,
    percussionVerticalOffset: -18,
    playheadColorMode: "gradient",
    layerOrder: [3, 1],
    layerStyles: new Map([[1, { noteAnimation: "wave" }]]),
    trackModes: new Map([[1, "melody"]]),
  };
  const first = upsertPresetRecord([], "  Studio   Warm  ", settings, 100);
  assert.equal(first.updated, false);
  assert.equal(first.record.name, "Studio Warm");
  assert.deepEqual(snapshotGlobalSettings(settings), {
    background: "#ffffff",
    noteSize: 145,
    melodyVerticalZoom: 140,
    percussionVerticalOffset: -18,
    playheadColorMode: "gradient",
  });
  assert.equal(first.record.settings.layerOrder, undefined);
  assert.equal(first.record.settings.layerStyles, undefined);
  assert.equal(first.record.settings.trackModes, undefined);

  const updated = upsertPresetRecord(first.records, "studio warm", { ...settings, noteSize: 180 }, 200);
  assert.equal(updated.updated, true);
  assert.equal(updated.records.length, 1);
  assert.equal(findPresetRecord(updated.records, "STUDIO WARM").settings.noteSize, 180);

  const storage = {
    value: null,
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
  };
  writePresetRecords(storage, updated.records);
  assert.deepEqual(readPresetRecords(storage), updated.records);
  assert.equal(removePresetRecord(updated.records, "studio warm").length, 0);
});

test("global customization presets snapshot palette color arrays by value", () => {
  const settings = { backgroundPaletteColors: ["#112233", "#445566"] };
  const { record } = upsertPresetRecord([], "Palette Pop", settings, 100);
  assert.deepEqual(record.settings.backgroundPaletteColors, ["#112233", "#445566"]);
  settings.backgroundPaletteColors.push("#778899");
  assert.deepEqual(record.settings.backgroundPaletteColors, ["#112233", "#445566"], "Preset records should not change when the live palette is edited afterwards.");
  assert.deepEqual(snapshotGlobalSettings({ backgroundPaletteColors: [] }), { backgroundPaletteColors: [] });
});
