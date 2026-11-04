-- Legacy sourced observations were not assessed against the stricter
-- event-specific material-impact policy. Preserve their evidence and history,
-- but do not qualify them merely because they were previously displayed.
ALTER TABLE event_disruption_observations
  ADD COLUMN qualification_policy_version integer NOT NULL DEFAULT 0
    CONSTRAINT event_disruption_observations_qualification_version_ck
    CHECK (qualification_policy_version IN (0, 1));

COMMENT ON COLUMN event_disruption_observations.qualification_policy_version IS
  'Server qualification policy: 0 is legacy/unqualified; 1 passed the high-confidence event-specific material-impact gate. Immutable with its source observation; a recheck appends a new qualified observation.';
