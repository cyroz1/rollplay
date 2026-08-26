const decoder16 = new TextDecoder("utf-16le");
const decoder8 = new TextDecoder();
const NOTE_RECORD_SIZES = [24, 20];
const PLAYLIST_RECORD_SIZES = [88, 80, 60, 56, 36, 32, 20];

function readString(bytes, utf16 = true) {
  return (utf16 ? decoder16 : decoder8).decode(bytes).replace(/\0+$/g, "");
}

function readVarint(bytes, offset, end = bytes.length) {
  let value = 0;
  let shift = 0;
  let position = offset;
  while (position < end && shift < 35) {
    const current = bytes[position++];
    value |= (current & 0x7f) << shift;
    if (!(current & 0x80)) return [value >>> 0, position];
    shift += 7;
  }
  throw new Error("Invalid FL Studio event length.");
}

function findChunk(bytes, name) {
  const target = [...name].map(character => character.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.length - 8; offset++) {
    if (!target.every((value, index) => bytes[offset + index] === value)) continue;
    const length = view.getUint32(offset + 4, true);
    if (offset + 8 + length <= bytes.length) return offset;
  }
  return -1;
}

function parseVersionMajor(version) {
  const match = /^(\d+)/.exec(version || "");
  return match ? Number(match[1]) : null;
}

function preferredPlaylistSizes(version) {
  const major = parseVersionMajor(version);
  if (major >= 26) return [88, 80, 60, 56, 36, 32, 20];
  if (major >= 25) return [80, 88, 60, 56, 36, 32, 20];
  if (major >= 21) return [60, 80, 88, 56, 36, 32, 20];
  return [32, 36, 20, 60, 80, 88, 56];
}

function noteRecordCandidate(payload, stride) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const recordCount = Math.floor(payload.byteLength / stride);
  let valid = 0;
  let ordered = 0;
  let previousPosition = -1;
  for (let position = 0; position + stride <= payload.byteLength; position += stride) {
    const notePosition = view.getUint32(position, true);
    const length = view.getUint32(position + 8, true);
    const key = view.getUint8(position + 12);
    const channel = view.getUint16(position + 6, true);
    if (key <= 131 && channel <= 2047 && length <= 0x7fffffff) valid += 1;
    if (notePosition >= previousPosition) ordered += 1;
    previousPosition = notePosition;
  }
  return {
    stride,
    recordCount,
    valid,
    ordered,
    score: valid * 3 + ordered,
  };
}

function appendPatternNotes(pattern, payload, preferredStride) {
  const candidates = NOTE_RECORD_SIZES
    .filter(stride => payload.byteLength >= stride && payload.byteLength % stride === 0)
    .map(stride => noteRecordCandidate(payload, stride))
    .sort((left, right) => (
      (right.stride === preferredStride) - (left.stride === preferredStride)
      || right.score - left.score
      || right.valid - left.valid
      || right.stride - left.stride
    ));
  const candidate = candidates[0];
  if (!candidate) return;

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  for (let position = 0; position + candidate.stride <= payload.byteLength; position += candidate.stride) {
    const key = view.getUint8(position + 12);
    const channel = view.getUint16(position + 6, true);
    if (key > 131 || channel > 2047) continue;
    pattern.notes.push({
      position: view.getUint32(position, true),
      channel,
      length: view.getUint32(position + 8, true),
      key,
      velocity: view.getUint8(position + Math.min(21, candidate.stride - 1)),
    });
  }
}

function playlistPatternId(view, position, patterns) {
  const item = view.getUint16(position + 6, true);
  if ((item & 0xf000) !== 0x5000) return null;
  const patternId = item & 0x0fff;
  return patterns.has(patternId) ? patternId : null;
}

function decodePlaylistCandidate(payload, stride, patterns) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const recordCount = Math.floor(payload.byteLength / stride);
  const clips = [];
  let patternRecords = 0;
  let patternBaseRecords = 0;
  let orderedRecords = 0;
  let previousPosition = -1;
  for (let position = 0; position + stride <= payload.byteLength; position += stride) {
    if (view.getUint16(position + 4, true) === 0x5000) patternBaseRecords += 1;
    const patternId = playlistPatternId(view, position, patterns);
    if (patternId == null) continue;
    const at = view.getUint32(position, true);
    if (at >= previousPosition) orderedRecords += 1;
    previousPosition = at;
    patternRecords += 1;
    clips.push({
      at,
      length: view.getUint32(position + 8, true),
      patternId,
      track: Math.max(0, 499 - view.getUint16(position + 12, true)),
    });
  }
  const coverage = recordCount ? patternRecords / recordCount : 0;
  const baseCoverage = recordCount ? patternBaseRecords / recordCount : 0;
  return {
    stride,
    clips,
    patternRecords,
    recordCount,
    coverage,
    baseCoverage,
    orderedRecords,
  };
}

function decodePlaylist(payload, patterns, version) {
  const sizes = preferredPlaylistSizes(version)
    .filter(stride => payload.byteLength >= stride && payload.byteLength % stride === 0);
  const candidates = sizes.map(stride => decodePlaylistCandidate(payload, stride, patterns));
  return candidates
    .filter(candidate => candidate.patternRecords > 0)
    .sort((left, right) => (
      right.coverage - left.coverage
      || right.patternRecords - left.patternRecords
      || right.baseCoverage - left.baseCoverage
      || right.orderedRecords - left.orderedRecords
      || sizes.indexOf(left.stride) - sizes.indexOf(right.stride)
    ))[0] || null;
}

/** Parse an FL Studio .flp binary without plugins, native code, or a server. */
export function parseFlp(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || decoder8.decode(bytes.subarray(0, 4)) !== "FLhd") {
    throw new Error("This does not appear to be a valid FL Studio project.");
  }

  const ppq = view.getUint16(12, true) || 96;
  const channelCount = view.getUint16(10, true);
  const eventChunk = findChunk(bytes, "FLdt");
  if (eventChunk < 0) throw new Error("The project does not contain an FLdt event chunk.");

  const eventDataStart = eventChunk + 8;
  const eventDataEnd = eventDataStart + view.getUint32(eventChunk + 4, true);
  if (eventDataEnd > bytes.length) throw new Error("The FLdt event chunk is truncated.");
  let offset = eventDataStart;
  let tempo = 120;
  let version = "Unknown";
  let currentPattern = null;
  let currentChannel = 0;
  const playlistPayloads = [];
  const patterns = new Map();
  const channels = new Map();

  while (offset < eventDataEnd) {
    const event = bytes[offset++];
    let length;
    if (event < 64) length = 1;
    else if (event < 128) length = 2;
    else if (event < 192) length = event === 172 ? 3 : 4;
    else [length, offset] = readVarint(bytes, offset, eventDataEnd);

    if (offset + length > eventDataEnd) {
      throw new Error(`The project contains a truncated event (${event}).`);
    }

    if (event === 64) {
      currentChannel = view.getUint16(offset, true);
      if (!channels.has(currentChannel)) channels.set(currentChannel, `Channel ${currentChannel + 1}`);
    } else if (event === 65) {
      currentPattern = view.getUint16(offset, true);
      if (!patterns.has(currentPattern)) patterns.set(currentPattern, { id: currentPattern, name: `Pattern ${currentPattern}`, notes: [] });
    } else if (event === 156 && length >= 4) {
      tempo = view.getUint32(offset, true) / 1000;
    } else if (event === 193 && currentPattern != null && patterns.has(currentPattern)) {
      patterns.get(currentPattern).name = readString(bytes.subarray(offset, offset + length));
    } else if (event === 199) {
      version = readString(bytes.subarray(offset, offset + length), false);
    } else if (event === 203 && length > 2) {
      channels.set(currentChannel, readString(bytes.subarray(offset, offset + length)));
    } else if ((event === 208 || event === 224) && currentPattern != null && patterns.has(currentPattern)) {
      appendPatternNotes(
        patterns.get(currentPattern),
        bytes.subarray(offset, offset + length),
        event === 208 ? 20 : 24,
      );
    } else if (event === 233) {
      playlistPayloads.push(bytes.slice(offset, offset + length));
    } else if (event === 192 && version === "Unknown") {
      const banner = readString(bytes.subarray(offset, offset + length));
      if (/^FL Studio(?:\s|$)/.test(banner)) version = banner;
    }
    offset += length;
  }

  const decodedPlaylists = playlistPayloads
    .map(payload => decodePlaylist(payload, patterns, version))
    .filter(Boolean);
  const playlist = decodedPlaylists.sort((left, right) => (
    right.clips.length - left.clips.length
    || right.coverage - left.coverage
  ))[0];
  const clips = playlist?.clips ? [...playlist.clips] : [];

  if (!clips.length) {
    let position = 0;
    for (const pattern of patterns.values()) {
      if (!pattern.notes.length) continue;
      const length = Math.max(ppq * 4, ...pattern.notes.map(note => note.position + (note.length || ppq / 4)));
      clips.push({ at: position, length, patternId: pattern.id, track: clips.length });
      position += length;
    }
  }

  const notes = [];
  for (const clip of clips) {
    const pattern = patterns.get(clip.patternId);
    for (const note of pattern.notes) {
      if (note.position >= clip.length) continue;
      notes.push({
        at: clip.at + note.position,
        length: Math.min(note.length || ppq / 7, clip.length - note.position),
        key: note.key,
        channel: note.channel,
        velocity: note.velocity,
        track: clip.track,
        patternId: pattern.id,
      });
    }
  }
  notes.sort((left, right) => left.at - right.at || left.channel - right.channel || left.key - right.key);

  const totalTicks = Math.max(ppq * 4, ...clips.map(clip => clip.at + clip.length));
  return {
    version, tempo, ppq, channelCount,
    channels: [...channels].map(([id, name]) => ({ id, name })),
    patterns: [...patterns.values()].filter(pattern => pattern.notes.length),
    clips, notes, totalTicks,
    duration: totalTicks / ppq * 60 / tempo,
  };
}
