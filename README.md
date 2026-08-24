# ROLLPLAY

A dependency-free, browser-native FL Studio project visualizer, MIDI exporter, and MP4 renderer. Drop an `.flp`, optionally add your finished audio, customize the piano-roll visualization, and export a video without uploading your music to a server.

## Features

- Reads FL Studio project binaries directly, including FL Studio 26 pattern notes and playlist arrangements.
- Extracts tempo, channels, named patterns, arranged clips, note velocity, and timing.
- Displays a responsive, animated piano roll with per-pattern colors, a vertical playhead, hit effects, hearts, and percussion diamonds.
- Offers portrait and landscape frame presets; landscape mode drops notes toward a horizontal playhead near the bottom.
- Switches any track independently between melodic piano-roll bars and step-percussion diamond rendering.
- Reorders track layers with drag-and-drop or up/down controls, keeping previews, hit effects, and exported video in sync.
- Adjusts horizontal zoom from one to eight visible bars, changing piano-roll scale and perceived scroll speed in previews and exports.
- Loads MP3, WAV, OGG, FLAC, and other browser-supported audio formats.
- Exports standards-compliant multi-track MIDI with project tempo.
- Renders H.264/AAC MP4 directly in supported browsers using WebCodecs and a built-in ISO BMFF multiplexer.
- Supports portrait, landscape, and square exports at 24, 30, or 60 FPS.
- Computes a video bitrate from a configurable maximum file size.
- Runs without runtime dependencies, external CDNs, API keys, or a backend.

## Run locally

```bash
git clone https://github.com/cyroz1/rollplay.git
cd rollplay
npm run dev
```

Open `http://localhost:4173`. Node.js 18 or newer is sufficient; no installation step is required.

## Publish

The application is a static website. Publish `index.html`, `styles.css`, and the `src/` directory with any static hosting provider, or run the included Node server. The development server also sets cross-origin isolation headers suitable for modern browser media APIs.

## Browser support

Project parsing, preview, playback, and MIDI export work in current browsers. MP4 rendering requires a Chromium-based browser with WebCodecs `VideoEncoder`, H.264 encoding, and AAC `AudioEncoder` support. Hardware and browser support can vary by export resolution and frame rate.

## Test

```bash
npm test
```

The optional FL Studio 26 regression fixture is intentionally not committed. When available adjacent to the repository as `../upload/key.flp`, tests additionally validate 148 BPM, 15 patterns, 172 clips, and 6,550 arranged notes.

## Privacy

Uploaded project and audio files stay in the browser. Project files, audio, generated videos, local dependencies, and screenshots are ignored by Git and never need to be committed.
