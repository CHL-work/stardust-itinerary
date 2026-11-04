import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_COUNT, AI_IMAGE_MAX_EDGE, type AiImageInput } from "@/lib/ai/image-types";

export const AI_IMAGE_ORIGINAL_MAX_BYTES = 20 * 1024 * 1024;
const maxOriginalPixels = 40_000_000;
export type AiImageErrorCode = "count" | "format" | "size" | "dimensions" | "prepare";
export class AiImagePreparationError extends Error {
  constructor(readonly code: AiImageErrorCode) { super(code); }
}
export type AiPreparedImage = { id: string; input: AiImageInput; previewUrl: string; width: number; height: number };
export type AiImageDraftState = { images: AiPreparedImage[]; preparing: boolean; error: AiImageErrorCode | null };

/** Reject unsupported containers and oversized dimensions before browser decoding. */
export function inspectAiImageDimensions(bytes: Uint8Array, mediaType: string): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  let width = 0;
  let height = 0;
  if (mediaType === "image/png" && bytes.length >= 33
    && bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])
    && view.getUint32(8) === 13 && ascii(12, 4) === "IHDR") {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mediaType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length && bytes[offset] === 0xff) {
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += size;
    }
  } else if (mediaType === "image/webp" && bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    }
  }
  if (!width || !height) throw new AiImagePreparationError("format");
  validateDimensions(width, height);
  return { width, height };
}

function validateDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 16_384 || height > 16_384 || width * height > maxOriginalPixels) {
    throw new AiImagePreparationError("dimensions");
  }
}

export function normalizedAiImageSize(width: number, height: number) {
  validateDimensions(width, height);
  const ratio = Math.min(1, AI_IMAGE_MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

async function decodePhoto(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new AiImagePreparationError("prepare")); image.src = url; });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => { image.src = ""; URL.revokeObjectURL(url); } };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

/** Images and previews stay in memory only; JPEG re-encoding drops source metadata. */
export async function prepareAiImage(file: File): Promise<AiPreparedImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new AiImagePreparationError("format");
  if (file.size < 1 || file.size > AI_IMAGE_ORIGINAL_MAX_BYTES) throw new AiImagePreparationError("size");
  inspectAiImageDimensions(new Uint8Array(await file.arrayBuffer()), file.type);
  const decoded = await decodePhoto(file);
  const canvas = document.createElement("canvas");
  try {
    const dimensions = normalizedAiImageSize(decoded.width, decoded.height);
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new AiImagePreparationError("prepare");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.9, 0.78, 0.62]) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= AI_IMAGE_MAX_BYTES) break;
    }
    if (!blob || blob.type !== "image/jpeg" || blob.size < 1 || blob.size > AI_IMAGE_MAX_BYTES) throw new AiImagePreparationError("size");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { id: crypto.randomUUID(), input: { mediaType: "image/jpeg", data: btoa(binary) }, previewUrl: URL.createObjectURL(blob), ...dimensions };
  } finally { decoded.close(); canvas.width = 0; canvas.height = 0; }
}

/** A cancellable, memory-only draft survives composer remounts and uncertain HTTP replies. */
export function createAiImageDraft(options: {
  prepare?: (file: File) => Promise<AiPreparedImage>;
  revoke?: (url: string) => void;
} = {}) {
  let state: AiImageDraftState = { images: [], preparing: false, error: null };
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const revoke = options.revoke ?? ((url: string) => URL.revokeObjectURL(url));
  const publish = (next: AiImageDraftState) => { state = next; for (const listener of listeners) listener(); };
  const clear = () => {
    generation += 1;
    for (const image of state.images) revoke(image.previewUrl);
    publish({ images: [], preparing: false, error: null });
  };
  return {
    activate() { disposed = false; },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clear,
    async add(files: File[]) {
      if (disposed || state.preparing || !files.length) return;
      if (files.length + state.images.length > AI_IMAGE_MAX_COUNT) { publish({ ...state, error: "count" }); return; }
      const version = ++generation;
      publish({ ...state, preparing: true, error: null });
      const prepared: AiPreparedImage[] = [];
      try {
        for (const file of files) {
          const image = await (options.prepare ?? prepareAiImage)(file);
          if (disposed || generation !== version) { revoke(image.previewUrl); return; }
          prepared.push(image);
        }
        publish({ images: [...state.images, ...prepared], preparing: false, error: null });
        prepared.length = 0;
      } catch (error) {
        if (!disposed && generation === version) publish({ ...state, preparing: false, error: error instanceof AiImagePreparationError ? error.code : "prepare" });
      } finally { for (const image of prepared) revoke(image.previewUrl); }
    },
    remove(id: string) {
      if (disposed || state.preparing) return;
      for (const image of state.images) if (image.id === id) revoke(image.previewUrl);
      publish({ ...state, images: state.images.filter((image) => image.id !== id), error: null });
    },
    dispose() { disposed = true; listeners.clear(); clear(); },
  };
}
