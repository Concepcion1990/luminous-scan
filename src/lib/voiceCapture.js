/**
 * Voice-note capture (fix, Nov 19, 2026).
 *
 * The shipped capture trusted MediaRecorder's container to
 * tell the truth about time. On the owner's Android phone it
 * did not: the WebM her phone produced was already broken in
 * the review player — before any server conversion — with the
 * first ~1.5 s missing, the surviving voice pitch-squeezed and
 * the note ending early. The sandbox's capture path stamps
 * honestly (measured: beep spacings exactly 1.000 s at 8k /
 * 44.1k / 48k inputs, and the server's MP3 conversion
 * preserves timing to the millisecond), so the fault is the
 * device recorder's clock, not the server's.
 *
 * This capture never consults a container clock. It taps the
 * microphone stream with WebAudio and counts SAMPLES at the
 * context's true rate: the duration of the note is the sample
 * count divided by that rate, by construction. The samples are
 * stored as plain 16-bit PCM in a WAV — a format whose header
 * states its rate and whose length is its sample count, so no
 * player can squeeze, stretch or misplace any of it. The
 * server accepts WAV and converts it to MP3 exactly as before.
 *
 * The stored rate is 16 kHz mono: plenty for a voice, and a
 * full 3-minute note is 5,760,000 bytes — inside the server's
 * 8 MB cap with room to spare.
 */

export const VOICE_WAV_RATE = 16000;

/**
 * Linear-interpolation resample of mono Float32 samples.
 * Duration is preserved to within one output sample: the
 * output count is round(n * toRate / fromRate).
 */
export function resamplePcm(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const outLength = Math.round((samples.length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] || 0;
    const b = idx + 1 < samples.length ? samples[idx + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Encode mono Float32 samples as a 16-bit PCM WAV byte array. */
export function encodeWav16(samples, sampleRate) {
  const n = samples.length;
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return bytes;
}

/**
 * Build the voice note's WAV from captured samples at the
 * capture context's true rate. Returns the WAV bytes, the rate
 * they are stored at, and the note's true duration in ms —
 * counted in samples, never read from a clock or a container.
 */
export function buildVoiceWav(samples, captureRate) {
  const targetRate = captureRate > VOICE_WAV_RATE ? VOICE_WAV_RATE : captureRate;
  const stored = resamplePcm(samples, captureRate, targetRate);
  return {
    bytes: encodeWav16(stored, targetRate),
    sampleRate: targetRate,
    durationMs: Math.round((samples.length / captureRate) * 1000),
  };
}

/**
 * A live PCM capture over an already-open microphone stream.
 * Browser-only: every platform global is touched inside the
 * functions, so importing this module in Node is safe.
 *
 *   const capture = createPcmCapture(stream);
 *   await capture.begin();          // throws if audio cannot run
 *   capture.sampleCount();          // samples collected so far
 *   capture.sampleRate;             // the context's true rate
 *   const { samples, sampleRate } = capture.finish();
 *   capture.dispose();              // abandon without a note
 */
export function createPcmCapture(stream) {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) throw new Error('webaudio-unavailable');
  const ctx = new Ctor();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is the one capture node every browser with
  // getUserMedia still runs (Android WebView, iOS Safari,
  // desktop). Its output is never written, so connecting it to
  // the destination — which some browsers require before the
  // node is clocked — plays silence, never the microphone.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let total = 0;
  proc.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    total += data.length;
  };

  let tornDown = false;
  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    try { proc.disconnect(); } catch { /* already gone */ }
    try { source.disconnect(); } catch { /* already gone */ }
    ctx.close().catch(() => {});
  };

  return {
    sampleRate: ctx.sampleRate,
    sampleCount: () => total,
    async begin() {
      source.connect(proc);
      proc.connect(ctx.destination);
      await ctx.resume();
      if (ctx.state !== 'running') {
        teardown();
        throw new Error('webaudio-suspended');
      }
    },
    finish() {
      teardown();
      const samples = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      return { samples, sampleRate: ctx.sampleRate };
    },
    dispose() {
      teardown();
    },
  };
}
