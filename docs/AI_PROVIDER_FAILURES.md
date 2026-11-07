# AI provider failure feedback

Upstream provider failures are distinct from Stardust's own permission, quota and session errors. An owner exempt from the application prompt cap still faces the model provider's account limits. The app never buys extra usage, changes credentials or resets limits. Paid requests never automatically change models. The narrow free-service fallback below is the exception.

Free AI (JOB-086) may try the next configured, freshly verified zero-price model within Kilo only, for eligible unavailability/output failures. Every attempt is capped and audited before I/O; authentication, billing and rate-limit responses stop fallback. A valid `Retry-After` becomes safe retry metadata, not a silent sleep/replay. Catalog failure, exhausted caps or unavailable models never enable a paid key or a different gateway. Raw upstream text is not shown or logged as diagnostics.

The same safe localized formatter is used when the final no-tools answer after research encounters a known provider failure. The application saves a no-proposal explanatory answer through the existing completion path, with the safe provider category in finalization audit metadata; it does not misclassify the lookup as failed verification. Other finalization failures distinguish remaining-budget exhaustion, timeout, unsupported repeat research and generic completion failure. No partial model patch or new preference candidate is published. Existing historical answers are not rewritten.

## Diagnosis and behavior

The Claude Agent SDK can report a rejected rate limit as an assistant `rate_limit` error followed by an error result whose subtype is nevertheless `success` (with `is_error` set). Checking the subtype alone, or wrapping every failure in a plain `Error`, hides the useful cause, so classification combines the result's `is_error` flag with the preceding assistant error code and any rejected rate-limit reset time.

Typed provider categories survive direct delivery, phone reconnection and self-only conversation history. Rate limiting is distinct from provider authentication, billing/account setup, unavailable models, temporary provider failures and invalid provider output. Provider authentication does not become HTTP 401: that code still means the application's own session is unavailable.

The UI uses neutral English, Hong Kong Cantonese in both tone modes, or Japanese. When the provider supplies a valid reset instant, it is shown as an estimated time in the trip's time zone, not the server's zone or copied provider prose. Missing/invalid reset data never becomes an invented countdown. An owner with model-selection permission may manually choose another allowed model; a restricted member receives wait/contact-owner guidance. Existing model/role policy remains authoritative.

An allowed or near-limit warning is not a failed response. The typed terminal signal controls failure; ordinary successful answers remain successful. Optional public research retains its existing unverified-evidence fallback instead of discarding valid proposals merely because an optional lookup was unavailable.

Optional research execution is separate from cleanup. A successful public-fact/hours result survives a failed SDK close or temporary-workspace disposal; the phase records `cleanupFailed: true` without replacing its original outcome, evidence or reported usage. A timeout, abort or provider failure still owns its original outcome when cleanup also fails. Cleanup of the main planning workspace is independent as well: its bounded disposal failure is audited, but returned output still proceeds through the usual validation and completion fences instead of being discarded solely for cleanup. Claude planning closes its query on completion/abort. Structured hours may be reused from the initial lookup; missing optional evidence produces neutral informational feedback rather than a closure warning. None of this triggers automatic provider retries or model changes. See [hours verification](AI_VENUE_HOURS.md).

## Persistence and privacy

Existing `ai_requests.error_code` stores a stable safe category. The append-only `request.failed` event may include a narrowly validated `providerFailure` object: code, provider and optional ISO reset time. Raw SDK messages, account identifiers, utilization, billing settings, credentials, stderr and arbitrary event payload fields are not copied into this object.

Direct HTTP errors and recovered/history messages project only this allowlist for the exact authorized failed request. Metadata must agree with its failure code; legacy generic failures stay generic. Other members' histories and identity-invalidated conversations remain inaccessible. This uses existing columns; no old failed request is rewritten with inferred provider details.

A terminal initial planning/image provider failure ends the admitted request without publishing partial changes; optional research failure retains the advisory fallback described above. A failed admitted request's client key remains non-replayable; reload/reconnection reads the result rather than starting another call. A deliberate later submission is a new request under normal policy. Showing a reset time is not a retry scheduler or a guarantee that the provider will be available at that instant.

## Verification and operations

Tests cover typed rate limits including `success` plus `is_error`, warnings versus failures, reset validation, safe redaction, direct/recovered/history parity, own-trip/identity guards, all locales, trip-zone rendering and no automatic resubmission or model switch. Run the full guarded `pnpm check` with a disposable loopback database ([database tests](DATABASE.md#5-tests)). Do not replay real bookings or use a live application database for synthetic planner fixtures.

Rollback can omit the optional display metadata but must preserve existing request/recovery idempotency and audit rows. Provider quotas remain an external limit; the application cannot guarantee success while the provider account is rate-limited. Deploy and roll back with [deployment](DEPLOYMENT.md) or [self-hosting](SELF_HOSTING.md).
