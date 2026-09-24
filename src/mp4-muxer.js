const ascii = new TextEncoder();
const u8 = (...values) => new Uint8Array(values);
const u16 = value => u8(value >>> 8, value);
const u32 = value => u8(value >>> 24, value >>> 16, value >>> 8, value);

function concat(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let position = 0;
  for (const part of parts) { output.set(part, position); position += part.length; }
  return output;
}

function box(type, ...contents) {
  const content = concat(...contents);
  return concat(u32(content.length + 8), ascii.encode(type), content);
}

function full(type, version, flags, ...contents) {
  return box(type, u8(version, flags >>> 16, flags >>> 8, flags), ...contents);
}

function descriptor(type, data) {
  const size = data.length;
  return concat(u8(type, 0x80 | ((size >>> 21) & 127), 0x80 | ((size >>> 14) & 127), 0x80 | ((size >>> 7) & 127), size & 127), data);
}

const MATRIX = concat(u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000));

function runLengths(values) {
  const runs = [];
  for (const value of values) {
    const last = runs[runs.length - 1];
    if (last && last[1] === value) last[0]++;
    else runs.push([1, value]);
  }
  return runs;
}

function videoSampleEntry(width, height, description) {
  const compressor = new Uint8Array(32);
  compressor[0] = 8;
  compressor.set(ascii.encode("ROLLPLAY"), 1);
  return box("avc1", new Uint8Array(6), u16(1), new Uint8Array(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), compressor, u16(24), u16(0xffff), box("avcC", new Uint8Array(description)));
}

function audioSampleEntry(sampleRate, channels, description) {
  const specific = descriptor(0x05, new Uint8Array(description || [0x11, 0x90]));
  const decoder = descriptor(0x04, concat(u8(0x40, 0x15, 0, 0, 0), u32(256000), u32(192000), specific));
  const stream = descriptor(0x03, concat(u16(1), u8(0), decoder, descriptor(0x06, u8(2))));
  const esds = full("esds", 0, 0, stream);
  return box("mp4a", new Uint8Array(6), u16(1), new Uint8Array(8), u16(channels), u16(16), u16(0), u16(0), u32(sampleRate << 16), esds);
}

function trackBox(track, id, movieTimescale) {
  const isVideo = track.type === "video";
  const duration = Math.round(track.duration / track.timescale * movieTimescale);
  const width = isVideo ? track.width : 0;
  const height = isVideo ? track.height : 0;
  const tkhd = full("tkhd", 0, 7, u32(0), u32(0), u32(id), u32(0), u32(duration), new Uint8Array(8), u16(0), u16(0), u16(isVideo ? 0 : 0x0100), u16(0), MATRIX, u32(width << 16), u32(height << 16));
  const mdhd = full("mdhd", 0, 0, u32(0), u32(0), u32(track.timescale), u32(track.duration), u16(0x55c4), u16(0));
  const hdlr = full("hdlr", 0, 0, u32(0), ascii.encode(isVideo ? "vide" : "soun"), new Uint8Array(12), ascii.encode(isVideo ? "VideoHandler\0" : "SoundHandler\0"));
  const header = isVideo ? full("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0)) : full("smhd", 0, 0, u16(0), u16(0));
  const dinf = box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
  const entry = isVideo ? videoSampleEntry(track.width, track.height, track.description) : audioSampleEntry(track.sampleRate, track.channels, track.description);
  const stsd = full("stsd", 0, 0, u32(1), entry);
  const durations = track.samples.map(sample => sample.duration);
  const timingRuns = runLengths(durations);
  const stts = full("stts", 0, 0, u32(timingRuns.length), ...timingRuns.map(([count, sampleDuration]) => concat(u32(count), u32(sampleDuration))));
  const stsc = full("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1));
  const stsz = full("stsz", 0, 0, u32(0), u32(track.samples.length), ...track.samples.map(sample => u32(sample.size ?? sample.data.length)));
  const stco = full("stco", 0, 0, u32(track.samples.length), ...track.samples.map(sample => u32(sample.offset)));
  const tables = [stsd, stts, stsc, stsz, stco];
  if (isVideo) {
    const keyframes = track.samples.map((sample, index) => sample.key ? index + 1 : 0).filter(Boolean);
    tables.push(full("stss", 0, 0, u32(keyframes.length), ...keyframes.map(u32)));
  }
  return box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", header, dinf, box("stbl", ...tables))));
}

function ftypBox() {
  return box("ftyp", ascii.encode("isom"), u32(0x200), ascii.encode("isom"), ascii.encode("iso2"), ascii.encode("avc1"), ascii.encode("mp41"));
}

function moovBox(tracks) {
  const movieTimescale = 1000;
  const movieDuration = Math.max(...tracks.map(track => Math.round(track.duration / track.timescale * movieTimescale)));
  const mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(movieTimescale), u32(movieDuration), u32(0x00010000), u16(0x0100), u16(0), new Uint8Array(8), MATRIX, new Uint8Array(24), u32(tracks.length + 1));
  return box("moov", mvhd, ...tracks.map((track, index) => trackBox(track, index + 1, movieTimescale)));
}

/** Minimal standards-compliant MP4 multiplexer for WebCodecs H.264 + AAC. */
export function muxMp4(video, audio = null) {
  const ftyp = ftypBox();
  const tracks = audio && audio.samples.length ? [video, audio] : [video];
  const ordered = tracks.flatMap(track => track.samples.map(sample => ({ ...sample, track, time: sample.timestamp / track.timescale }))).sort((left, right) => left.time - right.time);
  let cursor = ftyp.length + 8;
  const payloads = [];
  for (const sample of ordered) {
    sample.track.samples[sample.index].offset = cursor;
    payloads.push(sample.data);
    cursor += sample.data.length;
  }
  const mdat = box("mdat", ...payloads);
  const moov = moovBox(tracks);
  return new Blob([ftyp, mdat, moov], { type: "video/mp4" });
}

/**
 * Streams mdat payloads to a FileSystemWritableFileStream (from showSaveFilePicker)
 * while encoding, so only sample metadata (offset/size for stco/stsz) stays in memory.
 * The on-disk layout matches muxMp4 exactly: ftyp, then mdat (its size is patched in
 * once known), then moov. Sample offsets use the same ftyp.length + 8 base and
 * cumulative sizes as the in-memory path.
 */
export async function beginStreamedMux(writable) {
  const ftyp = ftypBox();
  await writable.write(ftyp);
  const mdatHeaderAt = ftyp.length;
  await writable.write(new Uint8Array(8)); // mdat size placeholder, patched in finish()
  const state = { cursor: ftyp.length + 8, chain: Promise.resolve() };
  return {
    streamSample(sample) {
      sample.offset = state.cursor;
      state.cursor += sample.size;
      const data = sample.data;
      sample.data = null; // bytes are queued for writing; only metadata stays in memory
      state.chain = state.chain.then(() => writable.write(data));
    },
    drain() { return state.chain; },
    async finish(tracks) {
      await state.chain;
      const mdatSize = state.cursor - ftyp.length;
      await writable.seek(mdatHeaderAt);
      await writable.write(concat(u32(mdatSize), ascii.encode("mdat")));
      await writable.seek(state.cursor);
      const moov = moovBox(tracks);
      await writable.write(moov);
      await writable.close();
      return state.cursor + moov.length;
    },
    async abort() {
      try { await writable.abort(); } catch { /* already closed or never opened */ }
    },
  };
}
