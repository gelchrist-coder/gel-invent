import { BrowserMultiFormatReader } from "@zxing/browser";
import BarcodeFormat from "@zxing/library/esm/core/BarcodeFormat";
import DecodeHintType from "@zxing/library/esm/core/DecodeHintType";

type NativeBarcodeDetector = new (config?: { formats?: string[] }) => {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
};

type StartCameraBarcodeScanOptions = {
  videoElement: HTMLVideoElement;
  onDetected: (value: string) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
};

const SCAN_FORMATS = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code"];
const ZXING_SCAN_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
];

function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

export async function startCameraBarcodeScan({
  videoElement,
  onDetected,
  onError,
  signal,
}: StartCameraBarcodeScanOptions): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    onError?.("Camera scanning is not supported on this browser.");
    return () => {};
  }

  let animationFrameId: number | null = null;
  let retryTimerId: number | null = null;
  let stream: MediaStream | null = null;
  let stopped = false;
  let zxingControls: { stop: () => void } | null = null;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;

    if (animationFrameId != null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    if (retryTimerId != null) {
      window.clearTimeout(retryTimerId);
      retryTimerId = null;
    }

    if (zxingControls) {
      zxingControls.stop();
      zxingControls = null;
    }

    stopMediaStream(stream);
    stream = null;

    if (videoElement.srcObject) {
      videoElement.srcObject = null;
    }

    if (signal) {
      signal.removeEventListener("abort", cleanup);
    }
  };

  if (signal?.aborted) {
    cleanup();
    return cleanup;
  }

  signal?.addEventListener("abort", cleanup);

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });

    if (signal?.aborted) {
      cleanup();
      return cleanup;
    }

    const BarcodeDetectorApi = (window as typeof window & {
      BarcodeDetector?: NativeBarcodeDetector;
    }).BarcodeDetector;

    if (BarcodeDetectorApi) {
      videoElement.srcObject = stream;
      await videoElement.play().catch(() => {
        // Ignore autoplay errors and continue.
      });

      const detector = new BarcodeDetectorApi({ formats: SCAN_FORMATS });

      const detectFrame = async () => {
        if (stopped || signal?.aborted) return;

        if (videoElement.readyState < 2) {
          animationFrameId = window.requestAnimationFrame(() => {
            void detectFrame();
          });
          return;
        }

        try {
          const results = await detector.detect(videoElement);
          const rawValue = String(results[0]?.rawValue || "").trim();
          if (rawValue) {
            onDetected(rawValue);
            cleanup();
            return;
          }
        } catch {
          // Keep scanning even if a frame fails.
        }

        animationFrameId = window.requestAnimationFrame(() => {
          void detectFrame();
        });
      };

      void detectFrame();
      return cleanup;
    }

    videoElement.srcObject = stream;
    await videoElement.play().catch(() => {
      // Ignore autoplay errors and continue.
    });

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_SCAN_FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      onError?.("Camera scanning could not start because image capture is unavailable.");
      cleanup();
      return cleanup;
    }

    const detectFromCanvas = async () => {
      if (stopped || signal?.aborted) return;

      const frameWidth = videoElement.videoWidth;
      const frameHeight = videoElement.videoHeight;
      if (!frameWidth || !frameHeight || videoElement.readyState < 2) {
        retryTimerId = window.setTimeout(() => {
          void detectFromCanvas();
        }, 120);
        return;
      }

      // Scan the centered guide area first; this is where the UI tells users to place the barcode.
      const cropWidth = Math.max(320, Math.floor(frameWidth * 0.78));
      const cropHeight = Math.max(140, Math.floor(frameHeight * 0.34));
      const cropX = Math.max(0, Math.floor((frameWidth - cropWidth) / 2));
      const cropY = Math.max(0, Math.floor((frameHeight - cropHeight) / 2));

      canvas.width = cropWidth;
      canvas.height = cropHeight;
      context.drawImage(videoElement, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

      try {
        const result = reader.decodeFromCanvas(canvas);
        const rawValue = String(result?.getText?.() || "").trim();
        if (rawValue) {
          onDetected(rawValue);
          cleanup();
          return;
        }
      } catch {
        // Keep trying while the camera is open.
      }

      retryTimerId = window.setTimeout(() => {
        void detectFromCanvas();
      }, 180);
    };

    void detectFromCanvas();
  } catch (error) {
    cleanup();
    onError?.(error instanceof Error ? error.message : "Unable to access camera.");
  }

  return cleanup;
}