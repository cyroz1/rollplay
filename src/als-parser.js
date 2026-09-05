const decoder = new TextDecoder();

const DEFAULT_PPQ = 960;
const DEFAULT_TEMPO = 120;
const MIN_NOTE_DURATION_BEATS = 1 / 64;
const EPSILON = 1e-7;

function bytesFromInput(input) {
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError("Ableton projects must be provided as XML text or binary file data.");
}

function isGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function decodeProjectXml(input) {
  const bytes = bytesFromInput(input);
  let xmlBytes = bytes;
  if (isGzip(bytes)) {
    if (typeof DecompressionStream !== "function" || typeof Blob !== "function" || typeof Response !== "function") {
      throw new Error("This browser cannot decompress Ableton Live project files.");
    }
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      throw new Error(`Unable to decompress this Ableton Live project: ${error.message}`);
    }
  }

  const xml = decoder.decode(xmlBytes).replace(/^\uFEFF/, "");
  if (!/^\s*</.test(xml)) throw new Error("This does not appear to be a valid Ableton Live project.");
  return xml;
}

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    if (code.toLowerCase() === "amp") return "&";
    if (code.toLowerCase() === "lt") return "<";
    if (code.toLowerCase() === "gt") return ">";
    if (code.toLowerCase() === "quot") return '"';
    if (code.toLowerCase() === "apos") return "'";
    const number = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
  });
}

function localName(name) {
  const separator = name.indexOf(":");
  return separator < 0 ? name : name.slice(separator + 1);
}

function readXmlName(source, start) {
  let end = start;
  while (end < source.length && /[\w:.-]/.test(source[end])) end += 1;
  return [source.slice(start, end), end];
}

function parseXmlAttributes(source) {
  const attributes = {};
  let position = 0;
  while (position < source.length) {
    while (/\s/.test(source[position] || "")) position += 1;
    if (position >= source.length) break;
    const [name, nameEnd] = readXmlName(source, position);
    if (!name) break;
    position = nameEnd;
    while (/\s/.test(source[position] || "")) position += 1;
    if (source[position] !== "=") {
      attributes[localName(name)] = "";
      continue;
    }
    position += 1;
    while (/\s/.test(source[position] || "")) position += 1;
    const quote = source[position];
    if (quote !== '"' && quote !== "'") {
      const [valueEnd] = readXmlName(source, position);
      attributes[localName(name)] = decodeEntities(source.slice(position, valueEnd));
      position = valueEnd;
      continue;
    }
    position += 1;
    const valueStart = position;
    while (position < source.length && source[position] !== quote) position += 1;
    attributes[localName(name)] = decodeEntities(source.slice(valueStart, position));
    if (source[position] === quote) position += 1;
  }
  return attributes;
}

function findTagEnd(xml, start) {
  let quote = "";
  for (let position = start; position < xml.length; position += 1) {
    const character = xml[position];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return position;
    }
  }
  return -1;
}

function appendText(node, text) {
  if (text) node.text += decodeEntities(text);
}

function parseXml(xml) {
  const documentNode = { name: "#document", attrs: {}, children: [], text: "", parent: null };
  const stack = [documentNode];
  let position = 0;

  while (position < xml.length) {
    const opening = xml.indexOf("<", position);
    if (opening < 0) {
      appendText(stack.at(-1), xml.slice(position));
      break;
    }
    appendText(stack.at(-1), xml.slice(position, opening));
    position = opening;

    if (xml.startsWith("<!--", position)) {
      const end = xml.indexOf("-->", position + 4);
      if (end < 0) throw new Error("The Ableton project contains an unterminated XML comment.");
      position = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", position)) {
      const end = xml.indexOf("]]>", position + 9);
      if (end < 0) throw new Error("The Ableton project contains an unterminated CDATA section.");
      appendText(stack.at(-1), xml.slice(position + 9, end));
      position = end + 3;
      continue;
    }
    if (xml.startsWith("<?", position)) {
      const end = xml.indexOf("?>", position + 2);
      if (end < 0) throw new Error("The Ableton project contains an unterminated XML declaration.");
      position = end + 2;
      continue;
    }
    if (xml.startsWith("<!", position)) {
      const end = findTagEnd(xml, position + 2);
      if (end < 0) throw new Error("The Ableton project contains an unterminated XML declaration.");
      position = end + 1;
      continue;
    }

    const end = findTagEnd(xml, position + 1);
    if (end < 0) throw new Error("The Ableton project contains an unterminated XML tag.");
    const rawTag = xml.slice(position + 1, end).trim();
    position = end + 1;

    if (rawTag.startsWith("/")) {
      const closingName = localName(rawTag.slice(1).trim());
      const current = stack.pop();
      if (!current || localName(current.name) !== closingName) {
        throw new Error(`The Ableton project contains mismatched XML tags near ${closingName}.`);
      }
      continue;
    }

    const selfClosing = /\/\s*$/.test(rawTag);
    const tagSource = selfClosing ? rawTag.replace(/\/\s*$/, "").trim() : rawTag;
    const [name, nameEnd] = readXmlName(tagSource, 0);
    if (!name) throw new Error("The Ableton project contains an invalid XML tag.");
    const node = { name, attrs: parseXmlAttributes(tagSource.slice(nameEnd)), children: [], text: "", parent: stack.at(-1) };
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }

  if (stack.length !== 1) throw new Error("The Ableton project contains unclosed XML tags.");
  const roots = documentNode.children.filter(node => node.name !== "#text");
  if (roots.length !== 1) throw new Error("The Ableton project does not contain one XML document.");
  return roots[0];
}

function directChild(node, name) {
  return node?.children.find(child => localName(child.name) === name) || null;
}

function descendants(node, name) {
  const found = [];
  const pending = [...(node?.children || [])].reverse();
  while (pending.length) {
    const current = pending.pop();
    if (localName(current.name) === name) found.push(current);
    for (let index = current.children.length - 1; index >= 0; index -= 1) pending.push(current.children[index]);
  }
  return found;
}

function firstDescendant(node, name) {
  const pending = [...(node?.children || [])].reverse();
  while (pending.length) {
    const current = pending.pop();
    if (localName(current.name) === name) return current;
    for (let index = current.children.length - 1; index >= 0; index -= 1) pending.push(current.children[index]);
  }
  return null;
}

function hasAncestor(node, name) {
  let current = node?.parent;
  while (current) {
    if (localName(current.name) === name) return true;
    current = current.parent;
  }
  return false;
}

function nodeValue(node) {
  if (!node) return null;
  if (node.attrs.Value != null) return node.attrs.Value;
  const valueAttribute = Object.entries(node.attrs).find(([name]) => name.toLowerCase() === "value");
  if (valueAttribute) return valueAttribute[1];
  const text = node.text.trim();
  return text || null;
}

function firstValue(node, names) {
  for (const name of names) {
    const candidate = firstDescendant(node, name);
    const value = nodeValue(candidate);
    if (value != null && value.trim() !== "") return value.trim();
  }
  return null;
}

function numberValue(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function descendantNumber(node, name, fallback = null) {
  return numberValue(nodeValue(firstDescendant(node, name)), fallback);
}

function attributeNumber(node, name, fallback = null) {
  return numberValue(node?.attrs?.[name], fallback);
}

function booleanValue(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (/^(?:true|1|on|yes)$/i.test(String(value).trim())) return true;
  if (/^(?:false|0|off|no)$/i.test(String(value).trim())) return false;
  return fallback;
}

function normalizeVelocity(value) {
  const raw = numberValue(value, 127);
  const scaled = raw >= 0 && raw <= 1 ? raw * 127 : raw;
  return Math.max(1, Math.min(127, Math.round(scaled)));
}

function trackName(track, index) {
  return firstValue(track, ["EffectiveName", "UserName", "Name"]) || `MIDI Track ${index + 1}`;
}

function isPercussionTrack(track, name) {
  return Boolean(firstDescendant(track, "DrumRack")) || /\b(?:drum|drums|percussion|perc|kit)\b/i.test(name);
}

function trackMidiChannel(track) {
  const channel = descendantNumber(track, "MidiChannel", null) ?? descendantNumber(track, "Channel", 0);
  return Math.max(0, Math.min(15, Math.round(channel)));
}

function clipStart(clip) {
  const time = attributeNumber(clip, "Time", null);
  if (time != null) return time;
  return descendantNumber(clip, "CurrentStart", 0);
}

function clipLength(clip, start, loopStart, loopEnd, noteEnd) {
  const currentStart = descendantNumber(clip, "CurrentStart", null);
  const currentEnd = descendantNumber(clip, "CurrentEnd", null);
  if (currentStart != null && currentEnd != null && currentEnd > currentStart + EPSILON) {
    return currentEnd - currentStart;
  }
  if (currentEnd != null && currentEnd > EPSILON) {
    const relativeLength = currentEnd - start;
    if (relativeLength > EPSILON) return relativeLength;
    return currentEnd;
  }
  const outMarker = descendantNumber(clip, "OutMarker", null);
  if (outMarker != null && outMarker > loopStart + EPSILON) return outMarker - loopStart;
  if (loopEnd > loopStart + EPSILON) return loopEnd - loopStart;
  return noteEnd > EPSILON ? noteEnd : 4;
}

function parseClipNotes(clip, loopStart, loopLength, length, channel) {
  const notes = [];
  const keyTracks = descendants(clip, "KeyTrack");
  const noteEvents = new Set();

  for (const keyTrack of keyTracks) {
    const keyNode = firstDescendant(keyTrack, "MidiKey");
    const key = numberValue(nodeValue(keyNode), null);
    if (key == null) continue;
    for (const event of descendants(keyTrack, "MidiNoteEvent")) {
      noteEvents.add(event);
      if (!booleanValue(event.attrs.IsEnabled, true)) continue;
      const time = attributeNumber(event, "Time", null);
      if (time == null) continue;
      const duration = Math.max(MIN_NOTE_DURATION_BEATS, attributeNumber(event, "Duration", MIN_NOTE_DURATION_BEATS));
      const localTime = time - loopStart;
      if (localTime + duration < -EPSILON) continue;
      notes.push({
        position: localTime,
        length: duration,
        key: Math.max(0, Math.min(127, Math.round(key))),
        channel,
        velocity: normalizeVelocity(event.attrs.Velocity),
      });
    }
  }

  // Some exporters omit KeyTrack wrappers and put the MIDI key directly on the event.
  for (const event of descendants(clip, "MidiNoteEvent")) {
    if (noteEvents.has(event) || !booleanValue(event.attrs.IsEnabled, true)) continue;
    const key = numberValue(event.attrs.Note ?? event.attrs.Key ?? event.attrs.Pitch ?? event.attrs.NoteId, null);
    const time = attributeNumber(event, "Time", null);
    if (key == null || key < 0 || key > 127 || time == null) continue;
    const duration = Math.max(MIN_NOTE_DURATION_BEATS, attributeNumber(event, "Duration", MIN_NOTE_DURATION_BEATS));
    notes.push({
      position: time - loopStart,
      length: duration,
      key: Math.max(0, Math.min(127, Math.round(key))),
      channel,
      velocity: normalizeVelocity(event.attrs.Velocity),
    });
  }

  const cleanNotes = notes
    .filter(note => note.position + note.length > -EPSILON && note.position < length + EPSILON)
    .map(note => ({
      ...note,
      position: Math.max(0, note.position),
      length: Math.min(note.length, Math.max(MIN_NOTE_DURATION_BEATS, length - Math.max(0, note.position))),
    }));
  const noteEnd = cleanNotes.reduce((end, note) => Math.max(end, note.position + note.length), 0);
  const loopNode = firstDescendant(clip, "Loop");
  const loopOnNode = loopNode && (firstDescendant(loopNode, "LoopOn") || firstDescendant(loopNode, "Looping"));
  const loopEnabled = loopLength > EPSILON && booleanValue(nodeValue(loopOnNode), true);
  const notesAlreadyExpanded = cleanNotes.some(note => note.position + note.length > loopLength + EPSILON || note.position < -EPSILON);
  if (!loopEnabled || length <= loopLength + EPSILON || notesAlreadyExpanded) return cleanNotes;

  const expanded = [];
  for (let offset = 0; offset < length - EPSILON; offset += loopLength) {
    for (const note of cleanNotes) {
      const position = note.position + offset;
      if (position >= length - EPSILON) continue;
      expanded.push({ ...note, position, length: Math.min(note.length, length - position) });
    }
  }
  return expanded.length ? expanded : cleanNotes;
}

function parseClip(clip, track, trackIndex, clipIndex) {
  const start = clipStart(clip);
  const loop = firstDescendant(clip, "Loop");
  const loopStart = loop ? descendantNumber(loop, "LoopStart", 0) : 0;
  const loopEnd = loop ? descendantNumber(loop, "LoopEnd", loopStart) : loopStart;
  const loopLength = Math.max(0, loopEnd - loopStart);
  const channel = trackMidiChannel(track);
  const name = firstValue(clip, ["EffectiveName", "UserName", "Name"])
    || `${track.name} · Clip ${clipIndex + 1}`;
  const rawNotes = descendants(clip, "MidiNoteEvent");
  const rawNoteEnd = rawNotes.reduce((end, event) => {
    const time = attributeNumber(event, "Time", null);
    const duration = attributeNumber(event, "Duration", MIN_NOTE_DURATION_BEATS);
    return time == null ? end : Math.max(end, time - loopStart + Math.max(MIN_NOTE_DURATION_BEATS, duration));
  }, 0);
  const length = Math.max(MIN_NOTE_DURATION_BEATS, clipLength(clip, start, loopStart, loopEnd, rawNoteEnd));
  const notes = parseClipNotes(clip, loopStart, loopLength, length, channel);
  return {
    at: start,
    length,
    name,
    notes,
    track: trackIndex,
    isPercussion: track.isPercussion,
    sourceTrackId: track.id,
    sourceClipIndex: clipIndex,
    hasExplicitStart: attributeNumber(clip, "Time", null) != null || firstDescendant(clip, "CurrentStart") != null,
  };
}

function findMidiTracks(liveSet) {
  const tracks = descendants(liveSet, "MidiTrack");
  return [...new Set(tracks)];
}

function findTrackClips(track) {
  const all = descendants(track, "MidiClip");
  const arrangement = all.filter(clip => hasAncestor(clip, "Arranger"));
  if (arrangement.length) return { clips: arrangement, session: false };
  const session = all.filter(clip => hasAncestor(clip, "ClipSlotList"));
  if (session.length) return { clips: session, session: true };
  return { clips: all, session: false };
}

function versionLabel(root) {
  const major = root.attrs.MajorVersion;
  const minor = root.attrs.MinorVersion;
  if (major == null && minor == null) return "Unknown";
  if (major == null) return String(minor);
  return minor == null ? String(major) : `${major}.${minor}`;
}

/** Parse an Ableton Live Set (.als) into the project model used by ROLLPLAY. */
export async function parseAls(input) {
  const xml = await decodeProjectXml(input);
  let root;
  try {
    root = parseXml(xml);
  } catch (error) {
    throw new Error(`Unable to read this Ableton Live project: ${error.message}`);
  }
  const liveSet = localName(root.name) === "LiveSet" ? root : directChild(root, "LiveSet") || firstDescendant(root, "LiveSet");
  if (!liveSet) throw new Error("This does not appear to be a valid Ableton Live project.");

  const tempo = descendantNumber(firstDescendant(liveSet, "Tempo"), "Manual", DEFAULT_TEMPO);
  const safeTempo = tempo > 0 ? tempo : DEFAULT_TEMPO;
  const trackNodes = findMidiTracks(liveSet);
  const trackSummaries = trackNodes.map((trackNode, index) => {
    const name = trackName(trackNode, index);
    return {
      node: trackNode,
      id: trackNode.attrs.Id ?? String(index),
      name,
      channel: trackMidiChannel(trackNode),
      isPercussion: isPercussionTrack(trackNode, name),
    };
  });

  const patterns = [];
  const clips = [];
  const notes = [];
  let nextPatternId = 1;

  for (const [trackIndex, track] of trackSummaries.entries()) {
    const { clips: clipNodes, session } = findTrackClips(track.node);
    let sessionCursor = 0;
    for (const [clipIndex, clipNode] of clipNodes.entries()) {
      const parsed = parseClip(clipNode, track, trackIndex, clipIndex);
      if (session && (!parsed.hasExplicitStart || (clipIndex > 0 && parsed.at <= sessionCursor + EPSILON))) parsed.at = sessionCursor;
      sessionCursor = Math.max(sessionCursor, parsed.at + parsed.length);
      if (!parsed.notes.length) continue;

      const pattern = {
        id: nextPatternId++,
        name: parsed.name,
        notes: parsed.notes,
        track: trackIndex,
        trackName: track.name,
        isPercussion: parsed.isPercussion,
        sourceTrackId: parsed.sourceTrackId,
        sourceClipIndex: parsed.sourceClipIndex,
      };
      patterns.push(pattern);
      const clip = {
        at: Math.max(0, Math.round(parsed.at * DEFAULT_PPQ)),
        length: Math.max(1, Math.round(parsed.length * DEFAULT_PPQ)),
        patternId: pattern.id,
        track: trackIndex,
      };
      clips.push(clip);
      for (const note of parsed.notes) {
        const at = clip.at + Math.round(note.position * DEFAULT_PPQ);
        const length = Math.max(1, Math.min(Math.round(note.length * DEFAULT_PPQ), clip.length - Math.round(note.position * DEFAULT_PPQ)));
        if (length <= 0) continue;
        notes.push({
          at,
          length,
          key: note.key,
          channel: note.channel,
          velocity: note.velocity,
          track: trackIndex,
          patternId: pattern.id,
        });
      }
    }
  }

  notes.sort((left, right) => left.at - right.at || left.channel - right.channel || left.key - right.key);
  const totalTicks = Math.max(DEFAULT_PPQ * 4, ...clips.map(clip => clip.at + clip.length));
  return {
    sourceFormat: "Ableton Live",
    format: "als",
    version: versionLabel(root),
    tempo: safeTempo,
    ppq: DEFAULT_PPQ,
    channelCount: trackSummaries.length,
    channels: trackSummaries.map(({ id, name, channel }) => ({ id, name, channel })),
    tracks: trackSummaries.map(({ id, name, channel, isPercussion }) => ({ id, name, channel, isPercussion })),
    patterns,
    clips,
    notes,
    totalTicks,
    duration: totalTicks / DEFAULT_PPQ * 60 / safeTempo,
  };
}

export const parseAbleton = parseAls;
export const parseAbletonLive = parseAls;
