import { Camera, CameraOff, Loader2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import useBarcodeCamera from '@/components/scan/useBarcodeCamera';

export default function BarcodeScanner({ onDetect }) {
  const { videoRef, status, message } = useBarcodeCamera(onDetect);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-primary">
      <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative h-[62%] w-[78%] max-w-xs">
          <span className="absolute left-0 top-0 h-7 w-7 border-l-2 border-t-2 border-accent" />
          <span className="absolute right-0 top-0 h-7 w-7 border-r-2 border-t-2 border-accent" />
          <span className="absolute bottom-0 left-0 h-7 w-7 border-b-2 border-l-2 border-accent" />
          <span className="absolute bottom-0 right-0 h-7 w-7 border-b-2 border-r-2 border-accent" />
          {status === 'live' && (
            <span className="absolute inset-x-6 top-1/2 h-px animate-pulse bg-accent/80" />
          )}
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
          {status === 'done' && (
            <>
              <Camera className="h-5 w-5 text-accent" />
              <p className="text-sm font-medium">{t('scan.codeCaptured')}</p>
              <p className="text-xs text-primary-foreground/60">{t('scan.scanNextHint')}</p>
            </>
          )}
        </div>
      )}

      <p className="absolute bottom-3 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-primary-foreground/50">
        UPC · EAN · ISBN · Code 128 · QR
      </p>
    </div>
  );
}