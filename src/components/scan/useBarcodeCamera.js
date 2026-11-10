import { useEffect, useRef, useState } from 'react';
import { createCodeReader, createFrameGrabber } from '@/lib/codeReader';

/** The centre crop is tried first — that is where people hold the code. */
const CROPS = [0.62, 1];
const RETRY_MS = 140;

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
    let captured = false;
    let timer = null;
    let stream = null;

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
        setMessage('This browser cannot open a camera. Type the code below instead.');
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
            ? 'Camera access is blocked. Allow the camera in your browser settings, or type the code below.'
            : 'The camera could not start. Close other apps using it, or type the code below.'
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
        if (captured || disposed) return;
        const text = String(value || '').trim();
        if (!text) return;
        captured = true;
        stopCamera();
        setStatus('done');
        onDetectRef.current(text);
      };

      const tick = async () => {
        if (disposed || stopped || captured) return;
        try {
          for (const crop of CROPS) {
            const canvas = grab(video, crop);
            if (!canvas) break;
            const value = await reader.read(canvas);
            if (value) {
              handle(value);
              return;
            }
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