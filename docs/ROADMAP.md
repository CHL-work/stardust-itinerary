# Roadmap

Where the project is going, in job-sized steps. Each job gets a file in [`jobs/`](jobs/) when work starts; see the [job system](JOB_SYSTEM.md). Entries below are plans unless marked done; the code and the feature contracts are the source of truth for what exists.

## Goals

- **A public instance anyone can try:** sign in with Google and bring your own AI key, or try a guest account that is deleted within a day.
- **Easy self-hosting:** one `docker compose up`, or the same Kubernetes manifests the public instance uses.
- **Visible engineering:** infrastructure as code, a reproducible deploy pipeline, and a security model that is documented and tested.

## Status

| Job | What | Status |
| --- | --- | --- |
| JOB-058 | Public repository with fresh history (MIT); one container image for web, workers, migrations and backups; Docker Compose self-hosting | Done |
| JOB-059 | GKE Autopilot in OpenTofu (`infra/`), Kustomize manifests (`deploy/k8s`), Secret Manager mounts, encrypted backups, deploy script | Done; the GitHub deploy workflow is still to come |
| JOB-060 | Move the public instance from its earlier single VM to GKE without losing writes | Rehearsed on staging |
| JOB-061 | Bring-your-own API keys | In review: Settings → AI keys, encrypted storage, per-request isolation, own-key funding, AI on in every trip, and fixes from a security review. Usage display moves to JOB-066 |
| JOB-062 | Gemini models (`gemini-4-argon`, `gemini-3.8-flash`, `gemini-3.5-flash-lite`) with Google Search grounding | Done |
| JOB-063 | Trip-owner key sharing | In progress |
| JOB-064 | Guest mode and public sign-up | Planned |
| JOB-065 | Public-launch security and privacy review | Planned; required before public sign-up |
| JOB-066 | Showcase documentation, a private feedback repository, deploy workflow polish | Planned |

## Planned work in more detail

### JOB-061: bring-your-own API keys

- **Settings → AI keys** for OpenAI, Anthropic and Gemini.
- **Stored safely:** each key is checked with a cheap model-list call before it is saved, encrypted at rest under a dedicated rotatable key, and never shown again after saving; only its last four characters are.
- **One credential resolver** replaces today's operator-funding gates. Each request uses:
  1. the requester's own key for the chosen provider; otherwise
  2. a trip owner's shared key (JOB-063); otherwise
  3. nothing, and the user sees a prompt to add a key.
- **Per-request isolation:** keys go to a per-request provider process with a fresh temporary state directory.
- **Usage ledger** per request (provider, model, tokens, estimated cost, whose key), visible to the key's owner.

### JOB-063: trip-owner key sharing

- The invite dialog gets a checkbox, **"Let this member use my AI keys"**, off by default. Owners can switch it on or off per member at any time.
- The grant names the sponsoring owner, and stops working if that owner removes the key, leaves or is removed.
- **Limits:** members using shared keys use one trip-level model the owner chooses. They get a daily request limit (default 20) and an optional monthly cost cap.
- All grant changes are audited; copy is in all four languages.

### JOB-064: guest mode and public sign-up

- **"Try as guest"** behind Cloudflare Turnstile and rate limits.
- **Seeded demo trip:** each guest starts with a synthetic one.
- **Sandboxed in the database:** guest and real trips never mix. Guests get no invitations and no Calendar, and use AI only with their own key.
- **Purge:** an hourly job hard-deletes guests older than 24 hours through a guarded function that may only touch guest-only rows.
- **Public sign-up** with Google, and self-service account deletion.

### JOB-065: public-launch review

- **Threat model** covering guest flooding, key theft, prompt injection aimed at secrets, storage and cost abuse, and log redaction.
- **Credential follow-ups** from the JOB-061 review:
  - an encryption-key ring with re-encryption, so the key can be rotated;
  - an explicit credential context for operator-funded calls in the web server.
- **Pages:** a privacy policy, terms, and [security reporting](../SECURITY.md).
- **Optional:** Google OAuth verification, which removes the unverified-app warning for Calendar.

### JOB-066: showcase and operations polish

- **Case study** of the design for readers who want the why.
- **Own-key usage:** in Settings, each key's owner sees their usage per provider (moved from JOB-061).
- **Feedback issues** go to a private repository, never this public one, because reports can contain user text.
- **Deploy workflow:** GitHub Actions with keyless Google authentication and an approval step before production.
