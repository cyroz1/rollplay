/**
 * Compute normalized peak amplitudes for drawing audio waveforms.
 * The peaks are computed over the mixed-down absolute amplitude of every
 * channel and normalized so the loudest bucket reaches 1, which keeps
 * quiet recordings visible instead of rendering as a flat line.
 */
export function computePeaks(audioBuffer, bucketCount = 2048) {
  const count = Math.max(1, Math.floor(Number(bucketCount)) || 1);
  const peaks = new Float32Array(count);
  const length = Math.max(0, Math.floor(audioBuffer?.length) || 0);
  const channels = Math.max(0, Math.floor(audioBuffer?.numberOfChannels) || 0);
  if (!length || !channels || typeof audioBuffer.getChannelData !== "function") return peaks;

  const data = [];
  for (let channel = 0; channel < channels; channel++) data.push(audioBuffer.getChannelData(channel));
  const perBucket = length / count;
  let loudest = 0;
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * perBucket);
    const end = Math.min(length, Math.max(start + 1, Math.floor((index + 1) * perBucket)));
    let peak = 0;
    for (let channel = 0; channel < channels; channel++) {
      const samples = data[channel];
      for (let sample = start; sample < end; sample++) {
        const amplitude = Math.abs(samples[sample]);
        if (amplitude > peak) peak = amplitude;
      }
    }
    peaks[index] = peak;
    if (peak > loudest) loudest = peak;
  }
  if (loudest > 0) {
    for (let index = 0; index < count; index++) peaks[index] = Math.min(1, peaks[index] / loudest);
  }
  return peaks;
}

function stripAudioExtension(name) {
  return String(name || "").replace(/\.[^.]+$/, "").trim().toLowerCase();
}

/**
 * Match a dropped audio file to an audio layer by filename. Compares the
 * file's base name (without extension) against each layer's sound name and
 * the base name of its referenced sample path.
 */
export function matchAudioPattern(audioPatterns, fileName) {
  const wanted = stripAudioExtension(fileName);
  if (!wanted) return null;
  for (const pattern of audioPatterns) {
    const candidates = [
      pattern.soundName,
      pattern.soundKey,
      typeof pattern.samplePath === "string" ? pattern.samplePath.split("/").at(-1) : "",
    ].map(stripAudioExtension);
    if (candidates.some(candidate => candidate && (candidate === wanted || candidate.startsWith(wanted) || wanted.startsWith(candidate)))) {
      return pattern;
    }
  }
  return null;
}
