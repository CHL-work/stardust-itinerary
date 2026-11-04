import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

import { AppInvalidInputError } from "@/lib/app/repository";
import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_COUNT, AI_IMAGE_MAX_EDGE, AI_IMAGE_REQUEST_MAX_BYTES, type AiImageInput } from "@/lib/ai/image-types";
import type { PreparedAiImage } from "@/lib/ai/image-server-types";

const MAX_PIXELS = 40_000_000;
export class AiImageInputError extends AppInvalidInputError {
  constructor() {
    super("Use up to 3 valid JPEG, PNG or WebP pictures, each no larger than 2 MiB after resizing.");
    this.name = "AI_IMAGE_INVALID";
  }
}
const invalid = () => new AiImageInputError();

/** Read incrementally so a missing or dishonest Content-Length cannot bypass the cap. */
export async function readAiRequestJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > AI_IMAGE_REQUEST_MAX_BYTES)) throw invalid();
  if (!request.body) throw new AppInvalidInputError("The AI request body is missing.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > AI_IMAGE_REQUEST_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw invalid();
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppInvalidInputError("The AI request body must be valid JSON."); }
}

/** Decode, bound and re-encode instead of trusting MIME labels, EXIF or uploaded bytes. */
export async function prepareAiImages(inputs: readonly AiImageInput[] = []): Promise<PreparedAiImage[]> {
  if (inputs.length > AI_IMAGE_MAX_COUNT) throw invalid();
  const images: PreparedAiImage[] = [];
  for (const input of inputs) {
    if (!input || !["image/jpeg", "image/png", "image/webp"].includes(input.mediaType)
      || typeof input.data !== "string" || !input.data.length
      || input.data.length > Math.ceil(AI_IMAGE_MAX_BYTES / 3) * 4
      || input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.data)) throw invalid();
    const raw = Buffer.from(input.data, "base64");
    if (!raw.length || raw.length > AI_IMAGE_MAX_BYTES || raw.toString("base64") !== input.data) throw invalid();
    // Reject unsupported decoders before sharp sees the bytes (not merely after
    // metadata inspection), especially SVG and other document-like formats.
    const matchesSignature = input.mediaType === "image/jpeg"
      ? raw.length >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff
      : input.mediaType === "image/png"
        ? raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : raw.length >= 12 && raw.toString("ascii", 0, 4) === "RIFF" && raw.toString("ascii", 8, 12) === "WEBP";
    if (!matchesSignature) throw invalid();
    try {
      const decoder = sharp(raw, { limitInputPixels: MAX_PIXELS, failOn: "warning", animated: true });
      const metadata = await decoder.metadata();
      const expected = input.mediaType.slice(6);
      if (metadata.format !== expected || !metadata.width || !metadata.height
        || metadata.width * metadata.height > MAX_PIXELS || (metadata.pages ?? 1) > 1) throw invalid();
      const { data, info } = await decoder.rotate().resize({ width: AI_IMAGE_MAX_EDGE, height: AI_IMAGE_MAX_EDGE,
        fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
      if (data.length > AI_IMAGE_MAX_BYTES) throw invalid();
      images.push({ id: randomUUID(), mediaType: "image/jpeg", data, width: info.width, height: info.height,
        sha256: createHash("sha256").update(data).digest("hex") });
    } catch { throw invalid(); }
  }
  return images;
}
