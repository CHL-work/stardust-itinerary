-- Trip owners can let chosen members use the owner's own AI keys in that trip (JOB-063, D-076).
-- A grant names the owner whose keys pay. It is usable only while that sponsor is an active owner
-- who holds a key; application code checks this on every request.
CREATE TABLE trip_ai_key_grants (
  trip_id uuid NOT NULL,
  member_id uuid NOT NULL,
  sponsor_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, member_id),
  FOREIGN KEY (trip_id, member_id) REFERENCES trip_members (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, sponsor_member_id) REFERENCES trip_members (trip_id, id) ON DELETE CASCADE,
  CHECK (member_id <> sponsor_member_id)
);

CREATE INDEX trip_ai_key_grants_sponsor_idx ON trip_ai_key_grants (trip_id, sponsor_member_id);

COMMENT ON TABLE trip_ai_key_grants IS
  'Members who may use a trip owner''s own AI keys in that trip. Never holds key material.';

-- People who join through a link created with this set receive a grant from the link's creator.
ALTER TABLE trip_join_links
  ADD COLUMN shares_ai_keys boolean NOT NULL DEFAULT false;

-- For a request on a shared key, the owner whose key paid. Set exactly when credential_source is
-- 'shared'; historical rows have neither.
ALTER TABLE ai_requests
  ADD COLUMN credential_sponsor_member_id uuid,
  ADD CONSTRAINT ai_requests_credential_sponsor_fk
    FOREIGN KEY (trip_id, credential_sponsor_member_id) REFERENCES trip_members (trip_id, id),
  ADD CONSTRAINT ai_requests_credential_sponsor_ck
    CHECK ((credential_source = 'shared') = (credential_sponsor_member_id IS NOT NULL));
