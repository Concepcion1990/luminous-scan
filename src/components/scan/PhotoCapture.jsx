import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Check, ImagePlus, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import usePhotoCamera from '@/components/scan/usePhotoCamera';
import { capturedPhotoFile } from '@/lib/photoCapture';

/**
 * Take a photo — the live still camera (diagnosis
 * ~/workspace/diagnosis-photo-camera/report.md). The product
 * form's "Take a photo" button used to click a hidden file input
 * whose `capture` attribute desktop browsers ignore; this overlay
 * is the real camera on any device that has one: live preview,
 * a shutter that grabs the full frame at its native size, a
 * preview with Retake / Use this photo, and — when the camera
 * cannot be used at all — the failure line in the reader's own
 * language with the gallery door beside it. Never a dead end.
 *
 * Use this photo hands the parent a JPEG File through onCapture;
 * the parent feeds it to the same addPhotos pipeline a picked
 * file takes, so what happens to the photo after it is taken
 * (upload, the owner's photo approval) never changes.
 */
export default function PhotoCapture({ onCapture, onUseGallery }) {
  const { videoRef, status } = usePhotoCamera();
  const [still, setStill] = useState(null);
  const stillRef = useRef(null);
  stillRef.current = still;

  // A preview's object URL is revoked on retake, on use, and on
  // unmount — a snapped still must never leak.
  useEffect(
    () => () => {
      if (stillRef.current?.url) URL.revokeObjectURL(stillRef.current.url);
    },
    [],
  );

  const snap = () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setStill({ blob, url: URL.createObjectURL(blob) });
      },
      'image/jpeg',
      0.92,
    );
  };

  const retake = () => {
    if (still?.url) URL.revokeObjectURL(still.url);
    setStill(null);
  };

  const usePhoto = () => {
    const file = capturedPhotoFile(still?.blob);
    if (!file) return;
    if (still?.url) URL.revokeObjectURL(still.url);
    setStill(null);
    onCapture(file);
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-primary">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />

        {still && (
          <img src={still.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}

        {status !== 'live' && !still && (
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
                  {t('photoCapture.unavailable')}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {status === 'error' ? (
        <Button type="button" variant="outline" className="w-full" onClick={onUseGallery}>
          <ImagePlus className="mr-1.5 h-4 w-4" /> {t('productForm.chooseFromGallery')}
        </Button>
      ) : still ? (
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={retake}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> {t('photoCapture.retake')}
          </Button>
          <Button type="button" className="flex-1" onClick={usePhoto}>
            <Check className="mr-1.5 h-4 w-4" /> {t('photoCapture.usePhoto')}
          </Button>
        </div>
      ) : (
        <Button type="button" className="w-full" onClick={snap} disabled={status !== 'live'}>
          <Camera className="mr-1.5 h-4 w-4" /> {t('photoCapture.shutter')}
        </Button>
      )}
    </div>
  );
}
