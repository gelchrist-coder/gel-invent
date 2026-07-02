type CompressOptions = {
  maxSize?: number;
  mime?: "image/jpeg" | "image/png" | "image/webp";
  quality?: number;
};

const READ_ERROR = "Couldn't read that image. Please pick a PNG or JPG (a screenshot works too).";

// Decode an uploaded File into something drawable. Prefers createImageBitmap,
// which reads the File bytes directly — no object URL, so nothing (a service
// worker, etc.) can intercept it. Falls back to an <img> + object URL only if
// createImageBitmap is unavailable or fails.
async function loadImageSource(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the object-URL path.
    }
  }

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(READ_ERROR));
    };
    img.src = objectUrl;
  });
}

// Downscale + compress an uploaded image to a small data URL.
export async function compressImageToDataUrl(file: File, options: CompressOptions = {}): Promise<string> {
  const { maxSize = 240, mime = "image/jpeg", quality = 0.72 } = options;

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await loadImageSource(file);
  } catch (error) {
    throw error instanceof Error ? error : new Error(READ_ERROR);
  }

  const srcWidth = source.width || 1;
  const srcHeight = source.height || 1;
  const scale = Math.min(1, maxSize / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    if ("close" in source) source.close();
    throw new Error("Image processing is not supported on this device.");
  }

  // JPEG has no transparency; flatten onto white so it never comes out black.
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();

  return canvas.toDataURL(mime, quality);
}
