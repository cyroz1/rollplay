const encoder = new TextEncoder();

function uint16(value) { return [(value >>> 8) & 255, value & 255]; }
function uint32(value) { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }

function variableLength(value) {
  let buffer = value & 0x7f;
  const output = [];
  while ((value >>>= 7)) buffer = (buffer << 8) | ((value & 0x7f) | 0x80);
  while (true) {
    output.push(buffer & 255);
    if (buffer & 0x80) buffer >>>= 8;
    else return output;
  }
}

function chunk(name, data) {
  return [...encoder.encode(name), ...uint32(data.length), ...data];
}

/** Build a standard type-1 MIDI file, preserving tempo and one track per pattern. */
export function createMidi(project, enabledPatterns = null) {
  const microsecondsPerBeat = Math.round(60_000_000 / project.tempo);
  const tempoTrack = [0, 0xff, 0x51, 3, (microsecondsPerBeat >>> 16) & 255, (microsecondsPerBeat >>> 8) & 255, microsecondsPerBeat & 255, 0, 0xff, 0x2f, 0];
  const tracks = [chunk("MTrk", tempoTrack)];

  for (const pattern of project.patterns) {
    if (enabledPatterns && !enabledPatterns.has(pattern.id)) continue;
    const name = [...encoder.encode(pattern.name)];
    const data = [0, 0xff, 0x03, ...variableLength(name.length), ...name];
    const events = [];
    for (const note of project.notes) {
      if (note.patternId !== pattern.id) continue;
      const channel = note.channel % 16;
      events.push({ tick: note.at, priority: 1, bytes: [0x90 | channel, note.key, Math.max(1, Math.min(127, note.velocity))] });
      events.push({ tick: note.at + Math.max(1, Math.round(note.length)), priority: 0, bytes: [0x80 | channel, note.key, 0] });
    }
    events.sort((left, right) => left.tick - right.tick || left.priority - right.priority);
    let previous = 0;
    for (const event of events) {
      data.push(...variableLength(Math.max(0, event.tick - previous)), ...event.bytes);
      previous = event.tick;
    }
    data.push(0, 0xff, 0x2f, 0);
    tracks.push(chunk("MTrk", data));
  }

  return new Uint8Array([...chunk("MThd", [...uint16(1), ...uint16(tracks.length), ...uint16(project.ppq)]), ...tracks.flat()]);
}
