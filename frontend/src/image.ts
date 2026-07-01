type CompressOptions = {
  maxSize?: number;
  mime?: "image/jpeg" | "image/png" | "image/webp";
  quality?: number;
};

// Downscale + compress an uploaded image to a small data URL. Loads via an
// object URL (not FileReader) so it handles large images and mobile photos
// (incl. not-yet-downloaded iCloud photos) reliably.
export function compressImageToDataUrl(file: File, options: CompressOptions = {}): Promise<string> {
  const { maxSize = 240, mime = "image/jpeg", quality = 0.72 } = options;

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(objectUrl);

    img.onerror = () => {
      cleanup();
      reject(new Error("Couldn't read that image. Please pick a PNG or JPG (a screenshot works too)."));
    };

    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Image processing is not supported on this device."));
          return;
        }
        // JPEG has no transparency; flatten onto white so it never comes out black.
        if (mime === "image/jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(mime, quality));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Could not process the image."));
      } finally {
        cleanup();
      }
    };

    img.src = objectUrl;
  });
}
