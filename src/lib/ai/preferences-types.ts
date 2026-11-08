import type { AiEffort } from "@/lib/ai/effort";
import type { KeyedModelProvider, SelectableOwnerModel } from "@/lib/app/types";

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
