import { isSelectableModel, modelProvider, routineDefaultModels } from "@/lib/ai/effort";
import type { RoutineAutoCheck, RoutineCheckFailure } from "@/lib/ai/preferences-types";
import type { KeyedModelProvider, SelectableOwnerModel } from "@/lib/app/types";

/**
 * When routine checks turn on by themselves (JOB-096, D-108): they stay on while the member has a key that
 * passed the web search check, unless the member turned them off. A newly saved key is checked with its
 * provider's default model; a key saved again while checks run on it is checked again with the chosen
 * model. Each key is checked once until it is saved again, so a failed key is not retried in a loop, and
 * only the most recently saved key is ever tried automatically.
 */
export const ROUTINE_CHECK_STALE_MS = 3 * 60_000;
const keyedProviders: readonly KeyedModelProvider[] = ["openai", "anthropic", "google"];
const checkFailures: readonly RoutineCheckFailure[] = ["no_search", "auth", "provider"];

/** The stored routine state the decision reads; timestamps come from the database clock. */
export type RoutineAutoRow = {
  routine_enabled: boolean;
  routine_model: string | null;
  routine_verified_model: string | null;
  routine_verified_at: Date | null;
  routine_opted_out: boolean;
  routine_check_model: string | null;
  routine_check_at: Date | null;
  routine_check_result: string | null;
};

export function isRoutineCheckFailure(value: unknown): value is RoutineCheckFailure {
  return typeof value === "string" && (checkFailures as readonly string[]).includes(value);
}

function newestKeyProvider(keys: ReadonlyMap<KeyedModelProvider, Date>): KeyedModelProvider | null {
  let newest: KeyedModelProvider | null = null;
  for (const provider of keyedProviders) {
    const time = keys.get(provider);
    if (time && (!newest || time.getTime() > keys.get(newest)!.getTime())) newest = provider;
  }
  return newest;
}

/** This provider's key, as saved at keyTime, was already checked, or its check is still running. */
function alreadyChecked(row: RoutineAutoRow | null, provider: KeyedModelProvider, keyTime: Date, now: Date): boolean {
  if (!row?.routine_check_at || !isSelectableModel(row.routine_check_model) || modelProvider(row.routine_check_model) !== provider) return false;
  if (row.routine_check_at.getTime() < keyTime.getTime()) return false;
  return row.routine_check_result !== null || now.getTime() - row.routine_check_at.getTime() < ROUTINE_CHECK_STALE_MS;
}

/** Checks are on, and the saved key is the one that passed. */
export function routineIsActive(row: RoutineAutoRow | null, keys: ReadonlyMap<KeyedModelProvider, Date>): boolean {
  const model = row && isSelectableModel(row.routine_model) ? row.routine_model : null;
  const keyTime = model ? keys.get(modelProvider(model)) : undefined;
  return Boolean(row?.routine_enabled && model && keyTime && row.routine_verified_at && row.routine_verified_model === model
    && keyTime.getTime() <= row.routine_verified_at.getTime());
}

/** The model an automatic check would turn routine checks on with, or null when nothing should start. */
export function routineAutoCandidate(row: RoutineAutoRow | null, keys: ReadonlyMap<KeyedModelProvider, Date>, now: Date): SelectableOwnerModel | null {
  if (row?.routine_opted_out || routineIsActive(row, keys)) return null;
  const model = row && isSelectableModel(row.routine_model) ? row.routine_model : null;
  const modelKey = model ? keys.get(modelProvider(model)) : undefined;
  if (row?.routine_enabled && model && modelKey) {
    // On, and its key was saved again after it passed: check that key with the chosen model.
    return alreadyChecked(row, modelProvider(model), modelKey, now) ? null : model;
  }
  // Off, or on with a removed key: the most recently saved key, unless it was already checked.
  const provider = newestKeyProvider(keys);
  if (!provider || alreadyChecked(row, provider, keys.get(provider)!, now)) return null;
  return model && modelProvider(model) === provider ? model : routineDefaultModels[provider];
}

/**
 * What the AI tab shows about the automatic check: running, due to start (the tab starts it), or failed for
 * the key as saved now. Nothing while checks are on and working.
 */
export function routineAutoState(row: RoutineAutoRow | null, keys: ReadonlyMap<KeyedModelProvider, Date>, now: Date): RoutineAutoCheck | null {
  if (!row || routineIsActive(row, keys)) {
    const candidate = row ? null : routineAutoCandidate(null, keys, now);
    return candidate ? { state: "due", model: candidate, reason: null } : null;
  }
  const checked = isSelectableModel(row.routine_check_model) ? row.routine_check_model : null;
  const keyTime = checked ? keys.get(modelProvider(checked)) : undefined;
  // The latest check tested the key as it is saved now.
  const current = Boolean(checked && keyTime && row.routine_check_at && keyTime.getTime() <= row.routine_check_at.getTime());
  if (current && checked && row.routine_check_result === null && now.getTime() - row.routine_check_at!.getTime() < ROUTINE_CHECK_STALE_MS) {
    return { state: "running", model: checked, reason: null };
  }
  const candidate = routineAutoCandidate(row, keys, now);
  if (candidate) return { state: "due", model: candidate, reason: null };
  if (current && checked && isRoutineCheckFailure(row.routine_check_result) && !row.routine_opted_out) {
    return { state: "failed", model: checked, reason: row.routine_check_result };
  }
  return null;
}
