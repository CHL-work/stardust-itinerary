export const AI_IMAGE_MAX_COUNT = 3;
export const AI_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const AI_IMAGE_REQUEST_MAX_BYTES = 9 * 1024 * 1024;
export const AI_IMAGE_MAX_EDGE = 2048;
export const AI_IMAGE_FACTS_MAX_CHARACTERS = 12_000;
export const AI_IMAGE_EXTRACTION_BUDGET_MS = 45_000;

export type AiImageInput = {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
};

export type AiImageSummary = { id: string; width: number; height: number };
