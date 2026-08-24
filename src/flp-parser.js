const decoder16 = new TextDecoder("utf-16le");
const decoder8 = new TextDecoder();

function readString(bytes, utf16 = true) {
  return (utf16 ? decoder16 : decoder8).decode(bytes).replace(/\0+$/g, "");
}

function readVarint(bytes, offset) {
  let value = 0;
  let shift = 0;
  let position = offset;
  while (position < bytes.length && shift < 35) {
    const current = bytes[position++];
    value |= (current & 0x7f) << shift;
    if (!(current & 0x80)) return [value >>> 0, position];
    shift += 7;
  }
  throw new Error("Invalid FL Studio event length.");
}

function findChunk(bytes, name) {
  const target = [...name].map(character => character.charCodeAt(0));
  for (let offset = 0; offset <= bytes.length - 8; offset++) {
    if (target.every((value, index) => bytes[offset + index] === value)) return offset;
  }
  return -1;
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

  let offset = eventChunk + 8;
  let tempo = 120;
  let version = "Unknown";
  let currentPattern = 0;
  let currentChannel = 0;
  let playlist = null;
  const patterns = new Map();
  const channels = new Map();

  while (offset < bytes.length) {
    const event = bytes[offset++];
    let length;
    if (event < 64) length = 1;
    else if (event < 128) length = 2;
    else if (event < 192) length = event === 172 ? 3 : 4;
    else [length, offset] = readVarint(bytes, offset);

    if (offset + length > bytes.length) {
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
    } else if (event === 193 && currentPattern) {
      patterns.get(currentPattern).name = readString(bytes.subarray(offset, offset + length));
    } else if (event === 199) {
      version = readString(bytes.subarray(offset, offset + length), false);
    } else if (event === 203 && length > 2) {
      channels.set(currentChannel, readString(bytes.subarray(offset, offset + length)));
    } else if (event === 224 && currentPattern) {
      const pattern = patterns.get(currentPattern);
      const stride = length % 24 === 0 ? 24 : length % 20 === 0 ? 20 : 0;
      if (!stride) throw new Error(`Unsupported FL Studio note record length: ${length}.`);
      for (let position = offset; position + stride <= offset + length; position += stride) {
        pattern.notes.push({
          position: view.getUint32(position, true),
          channel: view.getUint16(position + 6, true),
          length: view.getUint32(position + 8, true),
          key: view.getUint8(position + 12),
          velocity: view.getUint8(position + Math.min(21, stride - 1)),
        });
      }
    } else if (event === 233) {
      playlist = bytes.slice(offset, offset + length);
    }
    offset += length;
  }

  const clips = [];
  if (playlist) {
    const clipView = new DataView(playlist.buffer, playlist.byteOffset, playlist.byteLength);
    const candidates = [88, 56, 36, 32].filter(stride => playlist.byteLength % stride === 0);
    const stride = candidates[0];
    if (!stride) throw new Error(`Unsupported FL Studio playlist layout (${playlist.byteLength} bytes).`);
    for (let position = 0; position + stride <= playlist.byteLength; position += stride) {
      const item = clipView.getUint16(position + 6, true);
      if ((item & 0xf000) !== 0x5000) continue;
      const patternId = item & 0x0fff;
      if (!patterns.has(patternId)) continue;
      clips.push({
        at: clipView.getUint32(position, true),
        length: clipView.getUint32(position + 8, true),
        patternId,
        track: Math.max(0, 499 - clipView.getUint32(position + 12, true)),
      });
    }
  }

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
