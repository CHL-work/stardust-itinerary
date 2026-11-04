ALTER TABLE change_requests
  ADD COLUMN proposal_revision integer NOT NULL DEFAULT 1
    CHECK (proposal_revision >= 1),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE change_requests
   SET updated_at = created_at;

COMMENT ON COLUMN change_requests.proposal_revision IS
  'Optimistic concurrency token for edits to the proposed patch; canonical entity revisions remain separate.';

COMMENT ON COLUMN change_requests.updated_at IS
  'Last proposal-edit time. Proposal edits are also recorded in append-only audit_events.';
