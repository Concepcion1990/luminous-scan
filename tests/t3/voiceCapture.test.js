/**
 * Voice-note capture fix (Nov 19, 2026).
 *
 * The shipped capture trusted MediaRecorder's container to
 * tell the truth about time; on the owner's Android phone the
 * produced WebM was already broken in the review player —
 * head missing, voice pitch-squeezed, note ending early —
 * before any server conversion. The fix captures samples
 * through WebAudio and counts them: duration is the sample
 * count at the context's true rate, stored as 16-bit PCM WAV
 * whose header rate and sample-count length no player can
 * squeeze or shift. These tests pin the pure helpers, the
 * size guarantee against the server's 8 MB cap, the WAV's
 * acceptance by the real server parser, and the composer's
 * wiring (PCM first, MediaRecorder only as fallback).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVoiceWav, encodeWav16, resamplePcm, trimWakeHead, VOICE_WAV_RATE } from '../../src/lib/voiceCapture.js';
import { parseVoiceDataUrl, VOICE_MAX_BYTES } from '../../server/voiceNote.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const workforceSrc = fs.readFileSync(path.join(here, '../../src/pages/Workforce.jsx'), 'utf8');

test('resamplePcm preserves duration to within one output sample', () => {
  const oneSecond = new Float32Array(44100).fill(0.25);
  const out = resamplePcm(oneSecond, 44100, 16000);
  assert.equal(out.length, 16000);
  const threeMinutes = new Float32Array(48000 * 180);
  assert.equal(resamplePcm(threeMinutes, 48000, 16000).length, 16000 * 180);
  const same = resamplePcm(oneSecond, 16000, 16000);
  assert.equal(same, oneSecond, 'equal rates return the samples untouched');
});

test('resamplePcm keeps events at their true times (the counting proof in miniature)', () => {
  // Bursts at 1.0 s and 2.0 s of a 44.1 kHz capture must land
  // at 1.0 s and 2.0 s of the 16 kHz copy — no squeeze, no shift.
  const rate = 44100;
  const samples = new Float32Array(rate * 3);
  for (const at of [1.0, 2.0]) {
    const start = Math.floor(at * rate);
    for (let i = 0; i < 4410; i += 1) samples[start + i] = 0.8;
  }
  const out = resamplePcm(samples, rate, VOICE_WAV_RATE);
  const loud = [];
  for (let i = 0; i < out.length; i += 1) if (Math.abs(out[i]) > 0.4) loud.push(i / VOICE_WAV_RATE);
  assert.ok(Math.abs(loud[0] - 1.0) < 0.01, `first burst at ${loud[0]}`);
  assert.ok(Math.abs(loud[loud.length - 1] - 2.1) < 0.01, `last burst ends at ${loud[loud.length - 1]}`);
});

test('encodeWav16 writes a truthful header and clamps out-of-range samples', () => {
  const bytes = encodeWav16(new Float32Array([0, 0.5, 2, -2]), 16000);
  assert.equal(bytes.length, 44 + 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...bytes.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint32(24, true), 16000, 'the header states the true rate');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint16(34, true), 16, '16-bit');
  assert.equal(view.getInt16(44 + 4, true), 32767, 'over-range samples clamp, never wrap');
  assert.equal(view.getInt16(44 + 6, true), -32767);
});

test('buildVoiceWav: a full 3-minute note fits the server cap and keeps its duration', () => {
  const wav = buildVoiceWav(new Float32Array(48000 * 180), 48000);
  assert.equal(wav.sampleRate, VOICE_WAV_RATE);
  assert.equal(wav.durationMs, 180000, 'duration is the sample count, exactly');
  assert.ok(wav.bytes.length <= VOICE_MAX_BYTES, `${wav.bytes.length} bytes within the 8 MB server cap`);
  assert.equal(wav.bytes.length, 44 + 16000 * 180 * 2);
});

test('buildVoiceWav: a low-rate capture is stored at its own rate, duration exact', () => {
  const wav = buildVoiceWav(new Float32Array(8000 * 5), 8000);
  assert.equal(wav.sampleRate, 8000, 'no pointless upsampling');
  assert.equal(wav.durationMs, 5000);
});

test('the built WAV passes the real server parser as audio/wav, bytes intact', () => {
  const wav = buildVoiceWav(new Float32Array(44100).fill(0.1), 44100);
  const dataUrl = `data:audio/wav;base64,${Buffer.from(wav.bytes).toString('base64')}`;
  const parsed = parseVoiceDataUrl(dataUrl);
  assert.ok(parsed, 'the server accepts the capture the fix produces');
  assert.equal(parsed.ext, 'wav');
  assert.ok(parsed.bytes.equals(Buffer.from(wav.bytes)));
});

test('trimWakeHead: a late-waking mic\u2019s dead head comes off, the speech onset stays whole', () => {
  // The owner's phone, in miniature (release 337): half a second
  // of digital silence while the microphone wakes, then a word
  // whose onset ramps up — a quiet breath, then full voice.
  const rate = 16000;
  const samples = new Float32Array(rate * 2);
  const wordAt = Math.floor(0.5 * rate);
  for (let i = 0; i < 800; i += 1) samples[wordAt + i] = 0.05; // the soft onset
  for (let i = 800; i < 8000; i += 1) samples[wordAt + i] = 0.6; // the word itself
  const out = trimWakeHead(samples, rate);
  const leadIn = Math.floor(0.15 * rate);
  assert.equal(out.length, samples.length - (wordAt - leadIn), 'only the dead head is gone');
  assert.equal(out[leadIn], samples[wordAt], 'the soft onset is the first sound, unclipped');
  assert.equal(out[leadIn + 800], samples[wordAt + 800], 'the full-voice body follows whole');
  const wav = buildVoiceWav(out, rate);
  assert.equal(wav.durationMs, Math.round((out.length / rate) * 1000), 'the sent duration counts the sent samples');
});

test('trimWakeHead: an instantly-awake mic and a silent take pass through untouched', () => {
  const rate = 16000;
  const instant = new Float32Array(rate).fill(0.4);
  assert.equal(trimWakeHead(instant, rate), instant, 'sound from the first window: same array, no trim, no padding');
  const silent = new Float32Array(rate * 3);
  assert.equal(trimWakeHead(silent, rate), silent, 'an all-silence take keeps its recorded length');
  const early = new Float32Array(rate);
  early[Math.floor(0.05 * rate)] = 0.5; // sound inside the lead-in of the head
  assert.equal(trimWakeHead(early, rate), early, 'sound within the lead-in leaves the take alone');
});

test('the capture waits for flowing audio and trims the wake head in finish()', () => {
  const src = fs.readFileSync(path.join(here, '../../src/lib/voiceCapture.js'), 'utf8');
  assert.match(src, /FLOW_SAMPLES/, 'begin() waits for real buffers, not just a running context');
  assert.match(src, /flowWaiter/, 'the first-buffer arrival is what releases begin()');
  assert.match(src, /trimWakeHead\(joined/, 'finish() returns the onset-restored samples');
  assert.match(workforceSrc, /await capture\.begin\(\);/, 'the composer still starts the clock only after begin() resolves');
});

test('the composer captures by sample count first; MediaRecorder is only the fallback', () => {
  assert.match(workforceSrc, /import \{ buildVoiceWav, createPcmCapture \} from '@\/lib\/voiceCapture';/);
  const pcmAt = workforceSrc.indexOf('createPcmCapture(stream)');
  const recorderAt = workforceSrc.indexOf('new MediaRecorder(stream');
  assert.ok(pcmAt > 0 && recorderAt > pcmAt, 'PCM capture is attempted before the device recorder');
  assert.match(workforceSrc, /rec\.durationMs = wav\.durationMs;/, 'the sent duration is the sample-counted one');
  assert.match(workforceSrc, /new Blob\(\[wav\.bytes\], \{ type: 'audio\/wav' \}\)/);
  assert.match(workforceSrc, /const VOICE_MAX_MS = 3 \* 60 \* 1000;/, 'the 3-minute composer cap is unchanged');
  assert.match(workforceSrc, /recorder\.start\(\);/, 'the fallback keeps the shipped no-timeslice start');
});
