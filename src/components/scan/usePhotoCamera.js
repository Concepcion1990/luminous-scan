import { useEffect, useRef, useState } from 'react';
import { classifyCameraError, photoDoorDecision } from '@/lib/photoCapture';

/**
 * The still-photo camera: useBarcodeCamera's start/stop/error
 * skeleton WITHOUT the decode loop. The stream starts on mount
 * and every track stops on unmount — and every way out of the
 * overlay (Use photo, Cancel, the gallery door) closes and
 * unmounts it, so every exit path stops the camera. A failure lands as a
 * classified `failure` (see classifyCameraError); the component
 * turns any of them into the same graceful exit — the failure
 * line plus the gallery door, never a dead end.
 */
export default function usePhotoCamera() {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('starting');
  const [failure, setFailure] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    let disposed = false;
    let stream = null;

    const stopCamera = () => {
      // Stops the tracks without touching torch constraints (the
      // useBarcodeCamera discipline).
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      try {
        video?.pause();
      } catch {
        // Nothing to pause.
      }
    };

    const start = async () => {
      if (photoDoorDecision(navigator.mediaDevices) !== 'camera') {
        setStatus('error');
        setFailure('no-api');
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
        setFailure(classifyCameraError(error));
        return;
      }

      if (disposed) return stopCamera();

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can be delayed; the frames still arrive.
      }
      if (disposed) return stopCamera();
      setStatus('live');
    };

    start();

    return () => {
      disposed = true;
      stopCamera();
    };
  }, []);

  return { videoRef, status, failure };
}
