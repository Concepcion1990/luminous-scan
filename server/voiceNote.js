/**
 * Voice notes — the recording half of team Messages (Nov 19, 2026).
 *
 * A phone's browser records in whatever container it likes:
 * Android/Chrome hand back WebM/Opus, iPhone/Safari hand back
 * MP4/AAC, and neither plays the other's. The owner's rule is
 * that a voice note is the person's OWN voice, heard back exactly
 * as spoken — the only processing allowed is this conversion
 * into ONE common format so every note plays on every phone.
 *
 * That format is MP3 (mono, 64 kbps: plenty for a voice, small
 * on the wire). Conversion runs through ffmpeg (present in the
 * production image's runtime stage). A recording that cannot be
 * converted is refused outright — nothing unconverted is ever
 * stored, so "stored" always means "plays everywhere".
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// What a browser's MediaRecorder may hand back. Anything else is
// not a voice note and is refused before a byte is converted.
const VOICE_INPUT_TYPES = new Map([
  ['audio/webm', 'webm'],
  ['audio/mp4', 'mp4'],
  ['audio/x-m4a', 'm4a'],
  ['audio/m4a', 'm4a'],
  ['audio/mpeg', 'mp3'],
  ['audio/ogg', 'ogg'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
]);

// A voice note is a spoken message, not an upload channel: the
// composer stops at 3 minutes, and 8 MB of decoded audio is far
// beyond anything a 3-minute note needs at browser bitrates.
export const VOICE_MAX_BYTES = 8 * 1024 * 1024;
export const VOICE_MAX_DURATION_MS = 10 * 60 * 1000;

export function parseVoiceDataUrl(value) {
  const text = String(value || '');
  // A browser's MediaRecorder names its container WITH its
  // parameters — Chrome's data URL reads
  // "data:audio/webm;codecs=opus;base64,…". The parameters are
  // part of how the recording describes itself, not a different
  // format: accept and discard them, and judge the bare type.
  const match = text.match(/^data:([a-z0-9/+.-]+)(?:;[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = VOICE_INPUT_TYPES.get(mime);
  if (!ext) return null;
  let bytes;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > VOICE_MAX_BYTES) return null;
  return { mime, ext, bytes };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/**
 * Convert recorded bytes to MP3. Resolves with the MP3 Buffer;
 * rejects when the input is not readable audio or ffmpeg is
 * unavailable — the caller refuses the note either way.
 */
export async function convertVoiceToMp3(bytes, ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-note-'));
  const stamp = crypto.randomUUID();
  const inPath = path.join(dir, `${stamp}.${ext}`);
  const outPath = path.join(dir, `${stamp}.mp3`);
  try {
    fs.writeFileSync(inPath, bytes);
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inPath,
      '-vn', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k',
      outPath,
    ]);
    const mp3 = fs.readFileSync(outPath);
    if (!mp3.length) throw new Error('ffmpeg produced an empty file');
    return mp3;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
