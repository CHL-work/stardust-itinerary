import { ownerModelRegistry, ownerModels, providerDefaultModels, type OwnerModel } from "@/lib/app/types";

/** Providers a user can store their own API key for, in display and fallback order. */
export const aiKeyProviderOrder = ["openai", "anthropic", "google"] as const;
export type AiKeyProvider = (typeof aiKeyProviderOrder)[number];

/** Registered models a user can run on the keys they hold, in registry order. */
export function ownKeyModels(providers: Iterable<string>): OwnerModel[] {
  const held = new Set(providers);
  return ownerModels.filter((model) => held.has(ownerModelRegistry[model].provider));
}

/**
 * A model the requester can pay for with their own key, or null. An explicitly requested model uses
 * the requester's key whenever they hold one for its provider. With no explicit choice, an
 * operator-sponsored trip keeps its free sponsorship; otherwise the trip default (or the default
 * model of the first provider in `aiKeyProviderOrder`) of a provider the requester holds a key for
 * is used. Shared by the server's funding decision and the browser's model picker.
 */
export function ownKeyModel(
  requestedModel: OwnerModel | undefined, defaultModel: OwnerModel | undefined,
  ownProviders: ReadonlySet<string>, sponsoredAvailable: boolean,
): OwnerModel | null {
  if (requestedModel) return ownProviders.has(ownerModelRegistry[requestedModel].provider) ? requestedModel : null;
  if (sponsoredAvailable || ownProviders.size === 0) return null;
  if (defaultModel && Object.hasOwn(ownerModelRegistry, defaultModel) && ownProviders.has(ownerModelRegistry[defaultModel].provider)) {
    return defaultModel;
  }
  const provider = aiKeyProviderOrder.find((name) => ownProviders.has(name));
  return provider ? providerDefaultModels[provider] : null;
}
