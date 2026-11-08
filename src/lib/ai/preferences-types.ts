import type { AiEffort } from "@/lib/ai/effort";
import type { KeyedModelProvider, SelectableOwnerModel } from "@/lib/app/types";

/** Why a web search check of a key did not pass: no search with that model, a refused key, or a provider failure. */
export type RoutineCheckFailure = "no_search" | "auth" | "provider";

/**
 * The automatic check that turns routine checks on after a key is saved (JOB-096): due to start, running,
 * or failed for the key saved now.
 */
export type RoutineAutoCheck = { state: "due" | "running" | "failed"; model: SelectableOwnerModel; reason: RoutineCheckFailure | null };

/** Browser-safe shape of the account's AI preferences (JOB-094); the reads and writes live in preferences.ts. */
export type AiPreferences = {
  chatEffort: AiEffort | null;
  routine: {
    enabled: boolean;
    model: SelectableOwnerModel | null;
    effort: AiEffort;
    /** True when checks are on and the saved key still matches the one that passed the search check. */
    active: boolean;
    lastCheckAt: string | null;
    checksToday: number;
    /** The member turned checks off; saving a key then leaves them off (JOB-096). */
    optedOut: boolean;
    autoCheck: RoutineAutoCheck | null;
  };
  /** Providers the account holds keys for, which decide the models offered. */
  providers: KeyedModelProvider[];
  revision: number;
};

export type AiPreferencesPatch = {
  expectedRevision: number;
  chatEffort?: AiEffort | null;
  routine?: { enabled: boolean; model?: SelectableOwnerModel; effort?: AiEffort };
};
