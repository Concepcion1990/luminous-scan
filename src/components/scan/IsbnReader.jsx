import { useEffect, useRef, useState } from 'react';
import { CameraOff, Loader2, ScanText } from 'lucide-react';
import { t } from '@/lib/i18n';
import { createCodeReader, createFrameGrabber } from '@/lib/codeReader';
import { extractIsbn } from '@/lib/isbn';
import { readIsbnFromImage } from '@/lib/isbnOcr';
import { Button } from '@/components/ui/button';

/**
 * The ISBN field's reader (owner ruling, Nov 19, 2026). Two ways
 * in, one gate: the camera watches for the book's barcode (a
 * decode that yields a valid ISBN fills the field at once), and
 * the "Read number" button photographs the PRINTED digits and
 * reads them with OCR — for the books whose barcode is damaged
 * or missing, where the digits are printed right there. Either
 * way the value must pass the ISBN check digit (src/lib/isbn.js)
 * before onFill is called; a read that fails is refused in plain
 * words and the field stays exactly as it was.
 */
export default function IsbnReader({ onFill }) {
  const videoRef = useRef(null);
  const onFillRef = useRef(onFill);
  onFillRef.current = onFill;
  const [status, setStatus] = useState('starting');
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    let disposed = false;
    let stream = null;
    let timer = null;
    let filled = false;

    const stopCamera = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      try {
        video?.pause();
      } catch {
        // Nothing to pause.
      }
    };

    const fill = (isbn) => {
      if (filled || disposed) return;
      filled = true;
      onFillRef.current(isbn);
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
            : t('scan.cameraStartFailed'),
        );
        return;
      }
      if (disposed) return stopCamera();
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can be delayed; reading still uses the frames.
      }
      if (disposed) return stopCamera();
      setStatus('live');

      // The barcode bonus: while the camera is up, a decode that
      // yields a valid ISBN fills the field without another tap.
      const reader = await createCodeReader();
      if (disposed) return stopCamera();
      const grab = createFrameGrabber(1280);
      const tick = async () => {
        if (disposed || filled) return;
        try {
          for (const crop of [0.62, 1]) {
            const canvas = grab(video, crop);
            if (!canvas) break;
            // eslint-disable-next-line no-await-in-loop
            const value = await reader.read(canvas);
            if (value) {
              const found = extractIsbn(value);
              if (found.valid) {
                fill(found.isbn);
                return;
              }
            }
          }
        } catch {
          // A failed frame is normal while the camera focuses.
        }
        timer = setTimeout(tick, 220);
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

  // Photograph the band inside the guide frame and OCR it. The
  // band is upscaled — print reads better big — and the engine
  // sees one line of digits, nothing else.
  const readNumber = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || reading) return;
    setReading(true);
    setFailed(false);
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const bandH = Math.round(h * 0.44);
      const sy = Math.round((h - bandH) / 2);
      const scale = Math.min(1800 / w, 2.5);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(bandH * scale));
      canvas.getContext('2d').drawImage(
        video, 0, sy, w, bandH, 0, 0, canvas.width, canvas.height,
      );
      const found = await readIsbnFromImage(canvas);
      if (found.valid) {
        onFillRef.current(found.isbn);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-primary">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[38%] w-[86%] max-w-md">
            <span className="absolute left-0 top-0 h-7 w-7 border-l-2 border-t-2 border-accent" />
            <span className="absolute right-0 top-0 h-7 w-7 border-r-2 border-t-2 border-accent" />
            <span className="absolute bottom-0 left-0 h-7 w-7 border-b-2 border-l-2 border-accent" />
            <span className="absolute bottom-0 right-0 h-7 w-7 border-b-2 border-r-2 border-accent" />
          </div>
        </div>

        {status !== 'live' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-primary/85 px-6 text-center text-primary-foreground">
            {status === 'starting' && (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
                <p className="text-xs text-primary-foreground/70">{t('scan.startingCamera')}</p>
              </>
            )}
            {status === 'error' && (
              <>
                <CameraOff className="h-5 w-5 text-accent" />
                <p className="text-sm font-medium">{t('scan.cameraUnavailable')}</p>
                <p className="max-w-[260px] text-xs text-primary-foreground/60">
                  {message || t('scan.cameraFallback')}
                </p>
              </>
            )}
          </div>
        )}

        <p className="absolute bottom-3 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-primary-foreground/50">
          ISBN
        </p>
      </div>

      <p className="text-xs text-muted-foreground">{t('productForm.readIsbnHint')}</p>
      {failed && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {t('productForm.readIsbnFailed')}
        </p>
      )}
      <Button
        type="button"
        className="w-full"
        onClick={readNumber}
        disabled={status !== 'live' || reading}
      >
        {reading
          ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          : <ScanText className="mr-1.5 h-4 w-4" />}
        {reading ? t('productForm.readIsbnWorking') : t('productForm.readIsbnButton')}
      </Button>
    </div>
  );
}
