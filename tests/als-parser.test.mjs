import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { parseAls } from "../src/als-parser.js";

const alsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="11.0">
  <LiveSet>
    <Transport><Tempo><Manual Value="128" /></Tempo></Transport>
    <Tracks>
      <MidiTrack Id="lead-track">
        <Name><EffectiveName Value="Lead &amp; Hook" /><UserName Value="" /></Name>
        <DeviceChain>
          <MainSequencer>
            <ClipTimeable><Arranger><Events>
              <MidiClip Time="4">
                <Name Value="Hook" />
                <CurrentStart Value="4" /><CurrentEnd Value="12" />
                <Loop><LoopStart Value="0" /><LoopEnd Value="4" /><LoopOn Value="true" /></Loop>
                <Notes><KeyTracks>
                  <KeyTrack><Notes>
                    <MidiNoteEvent Time="0" Duration="1" Velocity="100" IsEnabled="true" />
                    <MidiNoteEvent Time="2" Duration="0.5" Velocity="64" IsEnabled="true" />
                  </Notes><MidiKey Value="60" /></KeyTrack>
                </KeyTracks></Notes>
              </MidiClip>
            </Events></Arranger></ClipTimeable>
          </MainSequencer>
        </DeviceChain>
      </MidiTrack>
      <MidiTrack Id="drum-track">
        <Name><EffectiveName Value="Drums" /></Name>
        <DeviceChain><Devices><DrumRack Id="drums" /></Devices>
          <MainSequencer><ClipTimeable><Arranger><Events>
            <MidiClip Time="0"><CurrentStart Value="0" /><CurrentEnd Value="4" />
              <Notes><KeyTracks><KeyTrack><Notes>
                <MidiNoteEvent Time="1" Duration="0.5" Velocity="0.5" IsEnabled="true" />
              </Notes><MidiKey Value="36" /></KeyTrack></KeyTracks></Notes>
            </MidiClip>
          </Events></Arranger></ClipTimeable></MainSequencer>
        </DeviceChain>
      </MidiTrack>
    </Tracks>
  </LiveSet>
</Ableton>`;

test("parses a gzip-compressed Ableton Live Set into Rollplay's project model", async () => {
  const project = await parseAls(gzipSync(Buffer.from(alsXml)));

  assert.equal(project.sourceFormat, "Ableton Live");
  assert.equal(project.format, "als");
  assert.equal(project.version, "5.11.0");
  assert.equal(project.tempo, 128);
  assert.equal(project.ppq, 960);
  assert.equal(project.channelCount, 2);
  assert.deepEqual(project.channels.map(channel => channel.name), ["Lead & Hook", "Drums"]);
  assert.equal(project.patterns.length, 2);
  assert.equal(project.patterns[0].name, "Hook");
  assert.equal(project.patterns[0].notes.length, 4, "An eight-beat arrangement clip should expand its four-beat loop.");
  assert.equal(project.patterns[1].isPercussion, true);
  assert.equal(project.notes.length, 5);
  assert.equal(project.notes[0].at, 960, "The drum note should start at beat one.");
  assert.equal(project.notes.find(note => note.key === 36).velocity, 64, "Normalized Ableton velocity should become MIDI velocity.");
  assert.equal(project.clips[0].at, 4 * 960);
  assert.equal(project.clips[0].length, 8 * 960);
  assert.equal(project.totalTicks, 12 * 960);
  assert.equal(project.duration, 12 * 60 / 128);
});

test("accepts plain Ableton XML and falls back to sequential session clips", async () => {
  const xml = `<Ableton><LiveSet><Transport><Tempo><Manual Value="120" /></Tempo></Transport><Tracks><MidiTrack Id="1"><Name><EffectiveName Value="Session" /></Name><DeviceChain><MainSequencer><ClipSlotList>
    <ClipSlot><ClipSlot><Value><MidiClip Time="0"><CurrentStart Value="0" /><CurrentEnd Value="2" /><Notes><KeyTracks><KeyTrack><Notes><MidiNoteEvent Time="0" Duration="1" Velocity="127" /></Notes><MidiKey Value="48" /></KeyTrack></KeyTracks></Notes></MidiClip></Value></ClipSlot></ClipSlot>
    <ClipSlot><ClipSlot><Value><MidiClip Time="0"><CurrentStart Value="0" /><CurrentEnd Value="2" /><Notes><KeyTracks><KeyTrack><Notes><MidiNoteEvent Time="1" Duration="1" Velocity="127" /></Notes><MidiKey Value="55" /></KeyTrack></KeyTracks></Notes></MidiClip></Value></ClipSlot></ClipSlot>
  </ClipSlotList></MainSequencer></DeviceChain></MidiTrack></Tracks></LiveSet></Ableton>`;
  const project = await parseAls(xml);

  assert.equal(project.patterns.length, 2);
  assert.deepEqual(project.clips.map(clip => clip.at), [0, 2 * 960]);
  assert.deepEqual(project.notes.map(note => note.at), [0, 3 * 960]);
});

test("rejects non-Ableton input", async () => {
  await assert.rejects(() => parseAls(new TextEncoder().encode("not an Ableton project")), /valid Ableton Live project/);
});
