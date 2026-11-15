import { useEffect, useRef, useState } from 'react';
import { createCodeReader, createFrameGrabber } from '@/lib/codeReader';
import { t } from '@/lib/i18n';

/** The centre crop is tried first — that is where people hold the code. */
const CROPS = [0.62, 1];
const RETRY_MS = 140;
/**
 * Auto re-arm (owner ruling, Nov 14, 2026): a capture used to stop
 * the camera dead until a "Scan next" tap remounted it. Now the
 * stream stays alive: the "Code captured" card shows briefly, then
 * the scanner returns to live capture ON ITS OWN — by the time the
 * owner scrolls back up from the result card, it is ready for the
 * next item, and a new code simply replaces the result.
 */
const REARM_MS = 1200;
/**
 * The loop guard: the same item sitting in front of the camera
 * must not re-capture itself. After a capture, that code is
 * ignored until it has been ABSENT from the frame for this many
 * consecutive decode ticks (~0.5s) — a genuine re-presentation of
 * the same code then captures promptly, and a different code
 * captures immediately at any time.
 */
const ABSENT_TICKS_TO_REARM = 4;

export default function useBarcodeCamera(onDetect) {
  const videoRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  const [status, setStatus] = useState('starting');
  const [message, setMessage] = useState('');
  onDetectRef.current = onDetect;

  useEffect(() => {
    const video = videoRef.current;
    let disposed = false;
    let stopped = false;
    let timer = null;
    let stream = null;
    // Capture-cycle state: while `cooling` the "Code captured" card
    // shows and decoding pauses; afterwards the loop watches again,
    // with lastCode held back until it has left the frame.
    let cooling = false;
    let lastCode = '';
    let absentTicks = 0;
    let sameCodeArmed = false;

    const stopCamera = () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // Stops the tracks without touching torch constraints, which previously
      // threw setPhotoOptions errors after the stream was already ended.
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      try {
        video?.pause();
      } catch {
        // Nothing to pause.
      }
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setMessage(t('scan.cameraNoBrowser'));
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch (error) {
        if (disposed) return;
        setStatus('error');
        setMessage(
          error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
            ? t('scan.cameraBlocked')
            : t('scan.cameraStartFailed')
        );
        return;
      }

      if (disposed) return stopCamera();

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can be delayed; decoding still reads the frames.
      }
      if (disposed) return stopCamera();
      setStatus('live');

      const reader = await createCodeReader();
      if (disposed) return stopCamera();
      const grab = createFrameGrabber(1280);

      const handle = (value) => {
        if (cooling || disposed) return;
        const text = String(value || '').trim();
        if (!text) return;
        lastCode = text;
        absentTicks = 0;
        sameCodeArmed = false;
        cooling = true;
        setStatus('done');
        onDetectRef.current(text);
        // The camera is NOT stopped: after the captured card has
        // had its moment, live capture resumes by itself.
        timer = setTimeout(() => {
          if (disposed || stopped) return;
          cooling = false;
          setStatus('live');
          tick();
        }, REARM_MS);
      };

      const tick = async () => {
        if (disposed || stopped || cooling) return;
        try {
          let sawLastCode = false;
          for (const crop of CROPS) {
            const canvas = grab(video, crop);
            if (!canvas) break;
            const value = await reader.read(canvas);
            if (value) {
              const text = String(value || '').trim();
              if (text && text !== lastCode) {
                handle(text);
                return;
              }
              if (text && text === lastCode && sameCodeArmed) {
                handle(text);
                return;
              }
              // The just-captured code is still sitting in the
              // frame: not a new capture — it has not left yet.
              if (text) sawLastCode = true;
            }
          }
          if (!sawLastCode) {
            // A full pass with no sighting of the last code brings
            // its re-presentation back into play.
            absentTicks += 1;
            if (absentTicks >= ABSENT_TICKS_TO_REARM) sameCodeArmed = true;
          } else {
            absentTicks = 0;
          }
        } catch {
          // A failed frame is normal while the camera focuses; try the next one.
        }
        timer = setTimeout(tick, RETRY_MS);
      };

      tick();
    };

    start();

    return () => {
      disposed = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, status, message };
}