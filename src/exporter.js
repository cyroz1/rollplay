import { Visualizer } from "./visualizer.js";
import { muxMp4 } from "./mp4-muxer.js";

function copyChunk(chunk) {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return data;
}
async function encodeAudio(audioBuffer, onProgress) {
  if (!audioBuffer || typeof AudioEncoder === "undefined") return null;
  const sampleRate = audioBuffer.sampleRate;
  const channels = Math.min(audioBuffer.numberOfChannels, 2);
  const track = { type: "audio", timescale: sampleRate, sampleRate, channels, duration: 0, description: null, samples: [] };
  const config = { codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, bitrate: 192000 };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) return null;

  const encoder = new AudioEncoder({
    output(chunk, metadata) {
      if (metadata?.decoderConfig?.description) track.description = new Uint8Array(metadata.decoderConfig.description);
      const timestamp = Math.round(chunk.timestamp / 1_000_000 * sampleRate);
      const duration = Math.max(1, Math.round((chunk.duration || 1024 / sampleRate * 1_000_000) / 1_000_000 * sampleRate));
      track.samples.push({ index: track.samples.length, data: copyChunk(chunk), timestamp, duration, key: true });
      track.duration = Math.max(track.duration, timestamp + duration);
    },
    error(error) { throw error; },
  });
  encoder.configure(config);

  const blockSize = 1024;
  for (let offset = 0; offset < audioBuffer.length; offset += blockSize) {
    const frames = Math.min(blockSize, audioBuffer.length - offset);
    const planar = new Float32Array(frames * channels);
    for (let channel = 0; channel < channels; channel++) planar.set(audioBuffer.getChannelData(channel).subarray(offset, offset + frames), channel * frames);
    const audio = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: frames, numberOfChannels: channels, timestamp: Math.round(offset / sampleRate * 1_000_000), data: planar });
    encoder.encode(audio);
    audio.close();
    if (encoder.encodeQueueSize > 20) await new Promise(resolve => setTimeout(resolve, 0));
    if (offset % (blockSize * 80) === 0) onProgress?.(offset / audioBuffer.length * .12, "Encoding audio…");
  }
  await encoder.flush();
  encoder.close();
  return track;
}
export function autoVideoBitrate(width, height, fps) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const safeFps = Math.max(1, Math.min(120, Number(fps) || 30));
  const rawBitrate = safeWidth * safeHeight * safeFps * .105;
  return Math.max(1_000_000, Math.min(80_000_000, Math.round(rawBitrate / 100_000) * 100_000));
}

export function bitrateForMaxFileSize(maxSize, duration, audioBitrate = 0) {
  const safeSize = Math.max(.1, Number(maxSize) || 20);
  const safeDuration = Math.max(.1, Number(duration) || .1);
  const safeAudioBitrate = Math.max(0, Number(audioBitrate) || 0);
  return Math.max(180_000, Math.floor(safeSize * 1_000_000 * 8 / safeDuration * .94 - safeAudioBitrate));
}

export async function renderMp4(project, settings, audioBuffer, onProgress) {
  if (typeof VideoEncoder === "undefined") throw new Error("MP4 export requires a recent Chrome, Edge, or another browser with WebCodecs support.");
  const [width, height] = settings.resolution.split("x").map(Number);
  const fps = Number(settings.fps);
  const duration = audioBuffer ? Math.min(project.duration, audioBuffer.duration) : project.duration;
  const frameCount = Math.ceil(duration * fps);
  const audioBudget = audioBuffer ? 192000 : 0;
  const bitrate = settings.maxSize === "auto"
    ? autoVideoBitrate(width, height, fps)
    : bitrateForMaxFileSize(settings.maxSize, duration, audioBudget);
  const canvas = new OffscreenCanvas(width, height);
  const visualizer = new Visualizer(canvas, project, settings);
  const video = { type: "video", timescale: 1_000_000, width, height, duration: 0, description: null, samples: [] };
  const config = { codec: "avc1.42002A", width, height, bitrate, framerate: fps, bitrateMode: "variable", avc: { format: "avc" }, latencyMode: "quality" };
  const supported = await VideoEncoder.isConfigSupported(config);
  if (!supported.supported) throw new Error("This browser cannot encode H.264 at the selected resolution and frame rate.");

  let encoderError;
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      if (metadata?.decoderConfig?.description) video.description = new Uint8Array(metadata.decoderConfig.description);
      const sampleDuration = Math.max(1, Math.round(chunk.duration || 1_000_000 / fps));
      video.samples.push({ index: video.samples.length, data: copyChunk(chunk), timestamp: chunk.timestamp, duration: sampleDuration, key: chunk.type === "key" });
      video.duration = Math.max(video.duration, chunk.timestamp + sampleDuration);
    },
    error(error) { encoderError = error; },
  });
  encoder.configure(config);

  const audio = await encodeAudio(audioBuffer, onProgress);
  for (let frame = 0; frame < frameCount; frame++) {
    if (encoderError) throw encoderError;
    visualizer.draw(frame / fps);
    const videoFrame = new VideoFrame(canvas, { timestamp: Math.round(frame / fps * 1_000_000), duration: Math.round(1_000_000 / fps) });
    encoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 });
    videoFrame.close();
    if (encoder.encodeQueueSize > 5) await new Promise(resolve => setTimeout(resolve, 0));
    if (frame % 12 === 0) {
      onProgress?.(.12 + frame / frameCount * .86, `Rendering frame ${frame.toLocaleString()} / ${frameCount.toLocaleString()}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  await encoder.flush();
  encoder.close();
  if (!video.description) throw new Error("The browser did not provide H.264 codec configuration.");
  onProgress?.(.99, "Building MP4…");
  const result = muxMp4(video, audio);
  onProgress?.(1, `Complete · ${(result.size / 1_000_000).toFixed(1)} MB`);
  return result;
}
