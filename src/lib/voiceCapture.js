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
 *
 * Rider (Nov 21, 2026): her hand-proof of the fix above found
 * the body true and smooth, but the first split-second still
 * clipped — only the tail of her first word survived. Her
 * phone's microphone wakes late: the UI said "recording" while
 * the audio path was still opening, and her first word fell
 * into that gap. Two guards, both on this PCM path only (the
 * MediaRecorder fallback is untouched):
 *   - begin() does not resolve until the context is running
 *     AND real buffers are actually flowing, so the recording
 *     clock and the "recording" face start only when the path
 *     is live. Buffers captured during the wait are kept —
 *     they are the pre-roll.
 *   - finish() trims the wake head (trimWakeHead below): the
 *     dead near-silence before the first real sound is dropped,
 *     keeping a short lead-in so a soft onset keeps its attack.
 *     Nothing is ever padded: an instant-wake mic and an
 *     all-silence take pass through sample-for-sample, and the
 *     duration stays the exact count of the samples sent.
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

/**
 * Drop the wake head: the dead air a late-waking microphone
 * leaves before the first real sound. Scans in 10 ms windows
 * for the first window whose peak reaches the sound threshold
 * and cuts everything before it except a 150 ms lead-in, so a
 * soft onset (the breath at the start of a word) keeps its
 * attack. The threshold sits far above a silent device's
 * digital zero and far below any spoken sound, so the cut can
 * only ever remove near-silence.
 *
 * Two passes stay untouched, sample for sample: sound that
 * starts in the very first window (an instantly-awake mic —
 * no dead head exists, and none is invented), and a take with
 * no sound at all (a silent note stays the length it was
 * recorded at).
 */
export function trimWakeHead(samples, sampleRate, opts = {}) {
  const threshold = opts.threshold ?? 0.01;
  const win = Math.max(1, Math.round((sampleRate * (opts.windowMs ?? 10)) / 1000));
  const leadIn = Math.round((sampleRate * (opts.leadInMs ?? 150)) / 1000);
  let onset = -1;
  for (let start = 0; start < samples.length; start += win) {
    let peak = 0;
    const end = Math.min(samples.length, start + win);
    for (let i = start; i < end; i += 1) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    if (peak >= threshold) { onset = start; break; }
  }
  if (onset <= 0) return samples;
  const cut = onset - leadIn;
  if (cut <= 0) return samples;
  return samples.slice(cut);
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
  // begin() waits for the audio path to prove it is flowing —
  // two full processor buffers delivered — before it lets the
  // recording start. flowWaiter is that wait's wake-up call.
  const FLOW_SAMPLES = 8192;
  let flowWaiter = null;
  proc.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    total += data.length;
    if (flowWaiter && total >= FLOW_SAMPLES) {
      const wake = flowWaiter;
      flowWaiter = null;
      wake();
    }
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
      // A running context is not yet a flowing microphone: on
      // a late-waking device the first buffers arrive hundreds
      // of milliseconds after resume(), and a speaker who
      // starts the moment the UI says "recording" loses their
      // first word into that gap. So the recording — the
      // caller's clock and recording face — starts only once
      // real buffers are flowing. The wait is bounded: if the
      // samples never come, begin() still resolves and the
      // take proceeds exactly as before (the buffers captured
      // during the wait are kept either way — they are the
      // pre-roll finish() trims from).
      await new Promise((resolve) => {
        if (total >= FLOW_SAMPLES) { resolve(); return; }
        const timer = setTimeout(() => { flowWaiter = null; resolve(); }, 1500);
        flowWaiter = () => { clearTimeout(timer); resolve(); };
      });
    },
    finish() {
      teardown();
      const joined = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      // The wake head comes off here, so the note that is
      // built, timed and sent starts at the speaker's first
      // real sound (plus its lead-in), never in dead air.
      return { samples: trimWakeHead(joined, ctx.sampleRate), sampleRate: ctx.sampleRate };
    },
    dispose() {
      teardown();
    },
  };
}
