import { BrowserMultiFormatReader } from "@zxing/browser";

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
      video: { facingMode: { ideal: "environment" } },
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

    const reader = new BrowserMultiFormatReader();
    zxingControls = await reader.decodeFromStream(stream, videoElement, (result) => {
      const rawValue = String(result?.getText?.() || "").trim();
      if (!rawValue) {
        return;
      }

      onDetected(rawValue);
      cleanup();
    });
  } catch (error) {
    cleanup();
    onError?.(error instanceof Error ? error.message : "Unable to access camera.");
  }

  return cleanup;
}