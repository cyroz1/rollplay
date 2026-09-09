export const AUDIO_NOTE_KEY = 36;
export const AUDIO_NOTE_CHANNEL = 10;
export const AUDIO_NOTE_VELOCITY = 127;

function cleanString(value) {
  return typeof value === "string" ? value.replace(/\0+$/g, "").trim() : "";
}

export function normalizeSoundReference(value) {
  return cleanString(value)
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

export function soundBasename(value) {
  const normalized = cleanString(value).replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) || "";
}

export function soundNameFromReference(value) {
  const basename = soundBasename(value);
  return basename.replace(/\.[^.]+$/, "") || basename;
}

function fallbackSoundKey(clip, index) {
  return normalizeSoundReference(
    clip.soundKey
    || clip.samplePath
    || clip.soundName
    || clip.name
    || `audio-${clip.sourceTrackId ?? clip.sourceChannelId ?? index}`,
  ) || `audio-${index}`;
}

/** Group direct audio clip occurrences into one reusable percussion layer per sound. */
export function groupAudioClips(clips, { startId = 1, ppq = 960 } = {}) {
  const groups = new Map();
  const groupedClips = [];
  let nextPatternId = startId;
  const triggerLength = Math.max(1, Math.round(ppq / 16));

  for (const [index, clip] of clips.entries()) {
    const soundKey = fallbackSoundKey(clip, index);
    let group = groups.get(soundKey);
    if (!group) {
      const soundName = clip.soundName
        || soundNameFromReference(clip.samplePath)
        || clip.name
        || `Audio ${nextPatternId}`;
      group = {
        id: nextPatternId++,
        name: soundName,
        notes: [{
          position: 0,
          length: triggerLength,
          key: AUDIO_NOTE_KEY,
          channel: AUDIO_NOTE_CHANNEL,
          velocity: AUDIO_NOTE_VELOCITY,
        }],
        isPercussion: true,
        isAudio: true,
        soundKey,
        soundName,
        samplePath: clip.samplePath || null,
        sourceTrackId: clip.sourceTrackId,
        sourceChannelId: clip.sourceChannelId,
        track: clip.track,
      };
      groups.set(soundKey, group);
    }

    groupedClips.push({
      ...clip,
      kind: "audio",
      patternId: group.id,
      soundKey,
    });
  }

  return { patterns: [...groups.values()], clips: groupedClips };
}
