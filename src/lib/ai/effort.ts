import { ownerModelRegistry, selectableOwnerModels, type KeyedModelProvider, type SelectableOwnerModel } from "@/lib/app/types";

/**
 * Reasoning effort a user may choose for chat and routine checks (JOB-094, D-106). Every registered paid
 * model accepts these three levels: OpenAI `reasoning.effort`, Anthropic `effort` and Gemini
 * `thinkingLevel`. Free models take no effort.
 */
export const aiEfforts = ["low", "medium", "high"] as const;
export type AiEffort = (typeof aiEfforts)[number];

export function isAiEffort(value: unknown): value is AiEffort {
  return typeof value === "string" && (aiEfforts as readonly string[]).includes(value);
}

export function isSelectableModel(value: unknown): value is SelectableOwnerModel {
  return typeof value === "string" && (selectableOwnerModels as readonly string[]).includes(value);
}

/** Routine checks run often in the background, so each provider's default is a capable, low-cost model. */
export const routineDefaultModels: Readonly<Record<KeyedModelProvider, SelectableOwnerModel>> = {
  openai: "gpt-6.1-terra",
  anthropic: "claude-haiku-5-5",
  google: "gemini-3.8-flash",
};
export const ROUTINE_DEFAULT_EFFORT: AiEffort = "medium";

/** Trip setup is a one-line lookup: the lightest model of each provider, at low effort. */
export const lookupModels: Readonly<Record<KeyedModelProvider, SelectableOwnerModel>> = {
  openai: "gpt-6.1-terra",
  anthropic: "claude-haiku-5-5",
  google: "gemini-3.5-flash-lite",
};

export function modelProvider(model: SelectableOwnerModel): KeyedModelProvider {
  return ownerModelRegistry[model].provider;
}

/**
 * The effort a chat request uses when the user has not chosen one: each model's tuned registry value.
 * Gemini has none, so the model's own default applies (null).
 */
export function registryEffort(model: SelectableOwnerModel): AiEffort | null {
  const profile = ownerModelRegistry[model];
  if (profile.provider === "openai") return isAiEffort(profile.reasoningEffort) ? profile.reasoningEffort : null;
  if (profile.provider === "anthropic") return profile.effort;
  return null;
}
