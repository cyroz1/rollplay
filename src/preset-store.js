export const PRESET_STORAGE_KEY = "rollplay.global-customization-presets.v1";

export const GLOBAL_PRESET_KEYS = Object.freeze([
  "background",
  "backgroundMode",
  "backgroundGradientStart",
  "backgroundGradientEnd",
  "backgroundGradientAngle",
  "backgroundImageFit",
  "noteSize",
  "barsVisible",
  "melodyVerticalZoom",
  "melodyVerticalOffset",
  "percussionVerticalZoom",
  "percussionVerticalOffset",
  "framePreset",
  "playhead",
  "playheadOffset",
  "playheadColor",
  "playheadColorMode",
  "playheadGradientStart",
  "playheadGradientEnd",
  "playheadThickness",
  "playheadGlow",
  "playheadOpacity",
  "effects",
  "percussion",
  "layerShadows",
  "shadowColor",
  "shadowDepth",
  "shadowOpacity",
  "layerParallax",
  "parallaxStrength",
  "resolution",
  "fps",
  "maxSize",
]);

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function sameName(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

export function snapshotGlobalSettings(settings = {}) {
  return Object.fromEntries(
    GLOBAL_PRESET_KEYS
      .filter(key => settings[key] !== undefined)
      .map(key => [key, settings[key]]),
  );
}

export function findPresetRecord(records, name) {
  const target = normalizeName(name);
  if (!target) return null;
  return records.find(record => sameName(record.name, target)) || null;
}

export function readPresetRecords(storage, key = PRESET_STORAGE_KEY) {
  if (!storage?.getItem) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || "null");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed
      .map(record => {
        const name = normalizeName(record?.name);
        if (!name || !record?.settings || typeof record.settings !== "object" || Array.isArray(record.settings)) return null;
        const identity = name.toLowerCase();
        if (seen.has(identity)) return null;
        seen.add(identity);
        const updatedAt = Number(record.updatedAt);
        return {
          name,
          settings: snapshotGlobalSettings(record.settings),
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

export function writePresetRecords(storage, records, key = PRESET_STORAGE_KEY) {
  storage.setItem(key, JSON.stringify(records));
}

export function upsertPresetRecord(records, name, settings, updatedAt = Date.now()) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) return { records, record: null, updated: false };
  const next = [...records];
  const index = next.findIndex(record => sameName(record.name, normalizedName));
  const record = {
    name: normalizedName,
    settings: snapshotGlobalSettings(settings),
    updatedAt,
  };
  const updated = index >= 0;
  if (updated) next[index] = record;
  else next.push(record);
  next.sort((left, right) => left.name.localeCompare(right.name));
  return { records: next, record, updated };
}

export function removePresetRecord(records, name) {
  const target = normalizeName(name);
  return records.filter(record => !sameName(record.name, target));
}


