import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve("database/migrations");
const fixturePath = path.resolve("database/fixtures/demo.sql");

describe("database migration contracts", () => {
  it("uses ordered immutable SQL files without proprietary extensions", async () => {
    const names = (await readdir(migrationsDirectory)).sort();
    expect(names).toEqual([
      "0001_core_trip_data.sql",
      "0002_audit_and_outbox.sql",
      "0003_identity_and_sessions.sql",
      "0004_collaboration_ai_and_costs.sql",
      "0005_permissions_expense_calendar.sql",
      "0006_trip_context_and_days.sql",
      "0007_member_management_and_quota.sql",
      "0008_private_itinerary_and_claim_lifecycle.sql",
      "0009_trip_capacity_and_reusable_join_links.sql",
      "0010_ai_conversation_memory.sql",
      "0011_off_topic_ai_attribution.sql",
      "0012_change_request_effective_audience.sql",
      "0013_ai_pending_review_audience.sql",
      "0014_ai_memory_and_preferences.sql",
      "0015_normalized_preference_catalog.sql",
      "0016_preference_catalog_import_integrity.sql",
      "0017_preference_catalog_import_hardening.sql",
      "0018_transport_endpoints.sql",
      "0019_split_legacy_transport_routes.sql",
      "0020_live_trip_context.sql",
      "0021_disruption_current_integrity.sql",
      "0022_weather_refresh_leases.sql",
      "0023_weather_refresh_member_leases.sql",
      "0024_disruption_event_cadence.sql",
      "0025_transport_weather_targets.sql",
      "0026_pending_change_request_editing.sql",
      "0027_pending_itinerary_visibility.sql",
      "0028_last_selected_trip.sql",
      "0029_pending_expense_audience.sql",
      "0030_editor_approval_defaults.sql",
      "0031_private_itinerary_owner_review.sql",
      "0032_disruption_localizations.sql",
      "0033_ai_request_recovery.sql",
      "0034_ai_conversation_history.sql",
      "0035_ai_image_inputs.sql",
      "0036_account_onboarding.sql",
      "0037_member_removal.sql",
      "0038_cancelled_event_removal.sql",
      "0039_disruption_qualification.sql",
      "0040_member_payments.sql",
      "0041_member_payment_removal.sql",
      "0042_calendar_imports.sql",
      "0043_preference_conversations.sql",
      "0044_feedback_triage.sql",
      "0049_custom_ai_instructions.sql",
      "0050_account_ai_lookups.sql",
      "0051_model_refresh.sql",
      "0052_trip_deletion.sql",
      "0053_api_key_transport.sql",
      "0054_user_ai_credentials.sql",
      "0055_ai_key_sharing.sql",
      "0056_guest_accounts.sql",
      "0057_guest_hardening.sql",
      "0058_private_feedback_repository.sql",
      "0059_platform_admin.sql",
      "0060_guest_free_ai.sql",
      "0061_flight_details.sql",
      "0062_flight_status.sql",
      "0063_more_locales.sql",
      "0064_user_secret_manager.sql",
      "0065_account_language.sql",
      "0066_vertex_express_credentials.sql",
      "0067_event_time_zones.sql",
    ]);

    const sql = await Promise.all(
      names.map((name) => readFile(path.join(migrationsDirectory, name), "utf8")),
    );
    const combined = sql.join("\n");

    expect(combined).not.toMatch(/CREATE\s+EXTENSION/i);
    expect(combined).toMatch(/FOREIGN KEY \(trip_id, trip_day_id\)/);
    expect(combined).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
    expect(combined).toMatch(/UNIQUE \(trip_id, idempotency_key\)/);
    expect(combined).toMatch(/CREATE TABLE member_claim_links/);
    expect(combined).toMatch(/octet_length\(token_hash\) = 32/);
    expect(combined).toMatch(/CREATE TABLE auth_sessions/);
    expect(combined).toMatch(/previous_token_hash/);
    expect(combined).toMatch(/CREATE TABLE itinerary_item_viewers/);
    expect(combined).toMatch(/app_member_can_view_itinerary_item/);
    expect(combined).toMatch(/CREATE TABLE trip_join_links/);
    expect(combined).toMatch(/ADD COLUMN max_members/);
    expect(combined).toMatch(/app_validate_trip_capacity/);
    expect(combined).toMatch(/CREATE TABLE ai_conversations/);
    expect(combined).toMatch(/ai_requests_conversation_fk/);
    expect(combined).toMatch(/ai_requests_conversation_identity_ck/);
    expect(combined).toMatch(/conversation_id IS NULL OR actor_user_id IS NOT NULL/);
    expect(combined).toMatch(/ai_requests_actor_user_fk/);
    expect(combined).toMatch(/FOREIGN KEY \(actor_user_id\) REFERENCES app_users \(id\) ON DELETE RESTRICT/);
    expect(combined).toMatch(/CREATE OR REPLACE FUNCTION app_member_can_view_change_request/);
    expect(combined).toMatch(/app_member_can_view_expense\(cr\.trip_id, cr\.entity_id, target_member_id\)/);
    expect(combined).toMatch(/cr\.proposed_patch \? 'viewerMemberIds'/);
    expect(combined).toMatch(/cr\.proposed_patch \? 'itineraryItemId'/);
    expect(combined).toMatch(/'itineraryAudienceSnapshot'/);
    expect(combined).toMatch(/ir\.created_at <= targets\.created_at/);
    expect(combined).toMatch(/submit-time effective private audiences/);
    expect(combined).toMatch(/cr\.source = 'ai'/);
    expect(combined).toMatch(/cr\.status IN \('pending', 'rejected'\)/);
    expect(combined).toMatch(/requester and active owner for review/);
    expect(combined).toMatch(/CREATE TABLE ai_conversation_checkpoints/);
    expect(combined).toMatch(/CREATE TABLE ai_personal_memories/);
    expect(combined).toMatch(/ai_personal_memories_search_idx/);
    expect(combined).toMatch(/to_tsvector\(/);
    expect(combined).toMatch(/CREATE TABLE preference_catalog_entities/);
    expect(combined).toMatch(/CREATE TABLE preference_catalog_aliases/);
    expect(combined).toMatch(/CREATE TABLE preference_catalog_relations/);
    expect(combined).toMatch(/CREATE TABLE user_catalog_preferences/);
    expect(combined).toMatch(/CREATE TABLE preference_import_batches/);
    expect(combined).toMatch(/CREATE TABLE preference_import_rows/);
    expect(combined).toMatch(/CREATE TABLE user_catalog_preference_evidence/);
    expect(combined).toMatch(/affinity_explicit OR affinity = 'unspecified'/);
    expect(combined).toMatch(/filesystem_presence/);
    expect(combined).toMatch(/catalog_expansion/);
    expect(combined).toMatch(/preference_catalog_relations_no_group_cycle/);
    expect(combined).toMatch(/ai_personal_memory_revisions_append_only/);
    expect(combined).toMatch(/ADD COLUMN catalog_sha256 bytea/);
    expect(combined).toMatch(/UNIQUE \(app_user_id, source_sha256\)/);
    expect(combined).toMatch(/app_purge_user_preference_data/);
    expect(combined).toMatch(/preference_import_rows_append_only/);
    expect(combined).toMatch(/preference_import_batches_immutable/);
    expect(combined).toMatch(/user_catalog_preferences_owner_entity_ref_uk/);
    expect(combined).toMatch(/user_catalog_preference_evidence_import_preference_fk/);
    expect(combined).toMatch(/stardust-preference-catalog-graph/);
    expect(combined).toMatch(/verified_reviewed_preference_batches/);
    expect(combined).toMatch(/FOR SHARE/);
    expect(combined).toMatch(/departure_location_name/);
    expect(combined).toMatch(/destination_location_name/);
    expect(combined).toMatch(/itinerary_items_transport_endpoint_ck/);
    expect(combined).toMatch(/split legacy route labels/iu);
    expect(combined).toMatch(/CREATE TABLE event_weather_forecasts/);
    expect(combined).toMatch(/target_role IN \('location', 'departure', 'destination'\)/);
    expect(combined).toMatch(/PRIMARY KEY \(trip_id, itinerary_item_id, target_role\)/);
    expect(combined).toMatch(/CREATE TABLE weather_refresh_leases/);
    expect(combined).toMatch(/PRIMARY KEY \(trip_id, member_id\)/);
    expect(combined).toMatch(/CREATE TABLE event_disruption_observations/);
    expect(combined).toMatch(/CREATE TABLE event_disruption_current/);
    expect(combined).toMatch(/CREATE TABLE event_disruption_localizations/);
    expect(combined).toMatch(/event_disruption_localizations_observation_item_fk/);
    expect(combined).toMatch(/event_disruption_localizations_append_only/);
    expect(combined).toMatch(/CREATE TABLE event_disruption_check_state/);
    expect(combined).toMatch(/check_scope IN \('current_day', 'future_day'\)/);
    expect(combined).toMatch(/initiator_kind IN \('member', 'system'\)/);
    expect(combined).toMatch(/ADD COLUMN proposal_revision/);
    expect(combined).toMatch(/proposal_revision >= 1/);
    expect(combined).toMatch(/ADD COLUMN updated_at/);

    const pendingVisibilityMigration = await readFile(
      path.join(migrationsDirectory, "0027_pending_itinerary_visibility.sql"),
      "utf8",
    );
    expect(pendingVisibilityMigration).toMatch(/cr\.status = 'pending'/);
    expect(pendingVisibilityMigration).toMatch(/viewer\.status = 'active'/);
    expect(pendingVisibilityMigration).toMatch(/WHEN 'trip' THEN true/);
    expect(pendingVisibilityMigration).toMatch(/WHEN 'private' THEN/);
    expect(pendingVisibilityMigration).toMatch(/viewer\.role = 'owner'/);
    expect(pendingVisibilityMigration).toMatch(/cr\.requested_by_member_id = target_member_id/);
    expect(pendingVisibilityMigration).toMatch(/viewerMemberIds/);
    expect(pendingVisibilityMigration).toMatch(/RENAME TO app_member_can_view_change_request_v0013/);
    expect(pendingVisibilityMigration).toMatch(/app_member_can_view_change_request_v0013/);

    const lastSelectedTripMigration = await readFile(
      path.join(migrationsDirectory, "0028_last_selected_trip.sql"),
      "utf8",
    );
    expect(lastSelectedTripMigration).toMatch(/ADD COLUMN IF NOT EXISTS last_selected_trip_id uuid/);
    expect(lastSelectedTripMigration).toMatch(/app_users_last_selected_trip_fk/);
    expect(lastSelectedTripMigration).toMatch(/ON DELETE SET NULL/);
    expect(lastSelectedTripMigration).toMatch(/events\.action = 'trip_switched_in'/);

    const pendingExpenseAudienceMigration = await readFile(
      path.join(migrationsDirectory, "0029_pending_expense_audience.sql"),
      "utf8",
    );
    expect(pendingExpenseAudienceMigration).toMatch(/cr\.entity_type = 'expense'/);
    expect(pendingExpenseAudienceMigration).toMatch(/cr\.operation = 'create'/);
    expect(pendingExpenseAudienceMigration).toMatch(/cr\.status IN \('pending', 'rejected'\)/);
    expect(pendingExpenseAudienceMigration).toMatch(/viewer\.status = 'active'/);
    expect(pendingExpenseAudienceMigration).toMatch(/viewer\.role = 'owner'/);
    expect(pendingExpenseAudienceMigration).toMatch(/cr\.requested_by_member_id = target_member_id/);
    expect(pendingExpenseAudienceMigration).toMatch(/payerMemberId/);
    expect(pendingExpenseAudienceMigration).toMatch(/splitMemberIds/);
    expect(pendingExpenseAudienceMigration).toMatch(/RENAME TO app_member_can_view_change_request_v0028/);
    expect(pendingExpenseAudienceMigration).toMatch(/app_member_can_view_change_request_v0028/);

    const editorApprovalDefaultsMigration = await readFile(
      path.join(migrationsDirectory, "0030_editor_approval_defaults.sql"),
      "utf8",
    );
    expect(editorApprovalDefaultsMigration).toMatch(/ALTER COLUMN itinerary_requires_approval SET DEFAULT true/);
    expect(editorApprovalDefaultsMigration).toMatch(/member\.role = 'editor'/);
    expect(editorApprovalDefaultsMigration).toMatch(/SET itinerary_requires_approval = true/);
    expect(editorApprovalDefaultsMigration).not.toMatch(/SET can_edit_itinerary = true/);

    const privateItineraryOwnerReviewMigration = await readFile(
      path.join(migrationsDirectory, "0031_private_itinerary_owner_review.sql"),
      "utf8",
    );
    expect(privateItineraryOwnerReviewMigration).toMatch(/reviewer\.role = 'owner'/);
    expect(privateItineraryOwnerReviewMigration).toMatch(/reviewer\.status = 'active'/);
    expect(privateItineraryOwnerReviewMigration).toMatch(/cr\.entity_type = 'itinerary_item'/);
    expect(privateItineraryOwnerReviewMigration).toMatch(/cr\.status IN \('pending', 'rejected'\)/);
    expect(privateItineraryOwnerReviewMigration).toMatch(/cr\.operation IN \('create', 'update'\)/);
    expect(privateItineraryOwnerReviewMigration).toMatch(/cr\.status = 'approved'/);
    expect(privateItineraryOwnerReviewMigration).toMatch(/cr\.reviewed_by_member_id = reviewer\.id/);
    expect(privateItineraryOwnerReviewMigration).toMatch(/RENAME TO app_member_can_view_change_request_v0029/);
    expect(privateItineraryOwnerReviewMigration).toMatch(/app_member_can_view_change_request_v0029/);
    expect(privateItineraryOwnerReviewMigration).not.toMatch(/CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+app_member_can_view_itinerary_item/i);

    const aiRecoveryMigration = await readFile(
      path.join(migrationsDirectory, "0033_ai_request_recovery.sql"),
      "utf8",
    );
    expect(aiRecoveryMigration).toMatch(/ADD COLUMN client_request_id uuid/);
    expect(aiRecoveryMigration).toMatch(/ADD COLUMN request_payload_hash text/);
    expect(aiRecoveryMigration).toMatch(/ADD COLUMN response_json jsonb/);
    expect(aiRecoveryMigration).toMatch(/CREATE UNIQUE INDEX ai_requests_client_request_identity_uq/);
    expect(aiRecoveryMigration).toMatch(/ON ai_requests \(trip_id, actor_user_id, client_request_id\)/);
    expect(aiRecoveryMigration).toMatch(/CREATE INDEX ai_requests_user_started_idx/);
    expect(aiRecoveryMigration).not.toMatch(/CREATE UNIQUE INDEX ai_requests_user_started_idx/);
    expect(aiRecoveryMigration).not.toMatch(/WHERE[\s\S]*\b(?:CURRENT_TIMESTAMP|now\(\))/u);
    expect(aiRecoveryMigration).toMatch(/octet_length\(response_json::text\) <= 131072/);

    const aiHistoryMigration = await readFile(
      path.join(migrationsDirectory, "0034_ai_conversation_history.sql"),
      "utf8",
    );
    expect(aiHistoryMigration).toMatch(/ADD COLUMN closed_reason text/);
    expect(aiHistoryMigration).toMatch(/ADD COLUMN history_revoked_at timestamptz/);
    expect(aiHistoryMigration).toMatch(/event\.action IN \('identity_unbound', 'owner_recovery_started'\)/);
    expect(aiHistoryMigration).toMatch(/changed\.actor_user_id = conversation\.actor_user_id/);
    expect(aiHistoryMigration).toMatch(/'legacy_unknown'/);
    expect(aiHistoryMigration).toMatch(/ai_conversations_close_pair_ck/);
    expect(aiHistoryMigration).toMatch(/ai_conversations history revocation is permanent/);
    expect(aiHistoryMigration).toMatch(/ai_conversations identity is immutable/);
    expect(aiHistoryMigration).toMatch(/CREATE INDEX ai_conversations_private_history_idx/);
    expect(aiHistoryMigration).toMatch(/CREATE INDEX ai_requests_private_conversation_history_idx/);
  });

  it("retires structured preferences without cascading into conversation or trip history", async () => {
    const sql = await readFile(path.join(migrationsDirectory, "0049_custom_ai_instructions.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN ai_instructions text NOT NULL DEFAULT ''/);
    expect(sql).toMatch(/length\(ai_instructions\) <= 8000/);
    expect(sql).toMatch(/ADD COLUMN ai_instructions_revision integer NOT NULL DEFAULT 1/);
    expect(sql).toMatch(/ai_instructions_revision >= 1/);
    expect(sql).toMatch(/WHERE purpose = 'preferences' AND closed_at IS NULL/);
    expect(sql).toMatch(/CHECK \(purpose = 'trip' OR closed_at IS NOT NULL\)/);
    expect(sql).toMatch(/CREATE TRIGGER ai_conversation_retired_purpose_insert_guard/);
    expect(sql).toMatch(/AI conversation purpose is immutable/);
    expect(sql.match(/^DROP TABLE /gm)).toHaveLength(13);
    expect(sql.match(/^DROP FUNCTION /gm)).toHaveLength(8);
    expect(sql).not.toMatch(/DROP [^;]+CASCADE/iu);
    expect(sql).not.toMatch(/DROP (?:TABLE|COLUMN) (?:ai_conversations|ai_requests|ai_conversation_checkpoints|audit_events|purpose)\b/iu);
    expect(sql).not.toMatch(/DELETE FROM|TRUNCATE /iu);
  });

  it("keeps fixtures synthetic and credential-free", async () => {
    const fixture = await readFile(fixturePath, "utf8");

    expect(fixture).toContain("Example Journey");
    expect(fixture).toContain("Sample Member");
    expect(fixture).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(fixture).not.toMatch(/(?:sk-ant-|sk-proj-|AIza|ghp_)/);
    expect(fixture).not.toMatch(/INSERT INTO (?:preferences|preference_revisions)\b/iu);
  });

  it("keeps destination lookups account-private and freezes every admission field", async () => {
    const sql = await readFile(path.join(migrationsDirectory, "0050_account_ai_lookups.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE account_ai_lookups");
    expect(sql).toContain("REFERENCES app_users (id) ON DELETE RESTRICT");
    expect(sql).toContain("UNIQUE (user_id,client_request_id)");
    expect(sql).toContain("octet_length(request_payload_hash) = 32");
    expect(sql).toContain("entitlement IN ('platform_operator','trip_creator')");
    expect(sql).toContain("authentication_mode = 'chatgpt_subscription'");
    expect(sql).toContain("to_jsonb(NEW) - ARRAY");
    expect(sql).toContain("to_jsonb(OLD) - ARRAY");
    expect(sql).toContain("OLD.status <> 'started'");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON account_ai_lookups");
    expect(sql).not.toMatch(/REFERENCES trips|REFERENCES trip_members|ALTER TABLE trips|UPDATE trips/);
  });
});
