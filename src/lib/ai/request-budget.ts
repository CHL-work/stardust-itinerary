import { AI_IMAGE_EXTRACTION_BUDGET_MS } from "@/lib/ai/image-types";

// One bounded request covers planning, research and final composition. The
// ten-minute identity/concurrency lease is intentionally not extended.
export const AI_TEXT_WORK_BUDGET_MS = 180_000;
export const AI_DELIVERY_GRACE_MS = 20_000;

export function aiRequestWorkBudgetMs(hasImages: boolean): number {
  return AI_TEXT_WORK_BUDGET_MS + (hasImages ? AI_IMAGE_EXTRACTION_BUDGET_MS : 0);
}

export function aiRequestDeliveryTimeoutMs(hasImages: boolean): number {
  return aiRequestWorkBudgetMs(hasImages) + AI_DELIVERY_GRACE_MS;
}
