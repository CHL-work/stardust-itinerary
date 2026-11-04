-- Recovery metadata is private to one bound actor. Legacy/system requests stay
-- nullable and no historical prompt/result is converted into a browser receipt.
ALTER TABLE ai_requests
  ADD COLUMN client_request_id uuid,
  ADD COLUMN request_payload_hash text,
  ADD COLUMN response_json jsonb,
  ADD CONSTRAINT ai_requests_client_request_pair_ck CHECK (
    (client_request_id IS NULL) = (request_payload_hash IS NULL)
  ),
  ADD CONSTRAINT ai_requests_client_request_actor_ck CHECK (
    client_request_id IS NULL OR (
      initiator_kind = 'member'
      AND actor_user_id IS NOT NULL
      AND actor_member_id IS NOT NULL
    )
  ),
  ADD CONSTRAINT ai_requests_request_payload_hash_ck CHECK (
    request_payload_hash IS NULL OR request_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT ai_requests_response_json_ck CHECK (
    response_json IS NULL OR (
      initiator_kind = 'member'
      AND actor_user_id IS NOT NULL
      AND actor_member_id IS NOT NULL
      AND status = 'succeeded'
      AND completed_at IS NOT NULL
      AND jsonb_typeof(response_json) = 'object'
      AND octet_length(response_json::text) <= 131072
    )
  );

CREATE UNIQUE INDEX ai_requests_client_request_identity_uq
  ON ai_requests (trip_id, actor_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Current time cannot appear in an index predicate. Admission takes a
-- user-scoped transaction advisory lock and evaluates the bounded age in SQL.
CREATE INDEX ai_requests_user_started_idx
  ON ai_requests (actor_user_id, created_at DESC)
  WHERE initiator_kind = 'member'
    AND actor_user_id IS NOT NULL
    AND status = 'started';

COMMENT ON COLUMN ai_requests.client_request_id IS
  'Browser-generated retry identity scoped to one trip and bound user. Reuse returns the original request, never a second provider call.';
COMMENT ON COLUMN ai_requests.request_payload_hash IS
  'SHA-256 of the canonical submission payload, used to reject a client-key retry with different prompt/model/locale data.';
COMMENT ON COLUMN ai_requests.response_json IS
  'Bounded allowlisted successful response receipt for self-only recovery. Not raw provider output, prompt text, or internal audit data.';
