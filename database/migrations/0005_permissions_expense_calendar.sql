CREATE TABLE member_permissions (
  trip_id uuid NOT NULL,
  member_id uuid NOT NULL,
  can_edit_itinerary boolean NOT NULL DEFAULT true,
  itinerary_requires_approval boolean NOT NULL DEFAULT false,
  can_edit_expenses boolean NOT NULL DEFAULT true,
  expense_requires_approval boolean NOT NULL DEFAULT false,
  can_sync_calendar boolean NOT NULL DEFAULT true,
  updated_by_member_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, member_id),
  FOREIGN KEY (trip_id, member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, updated_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT
);

INSERT INTO member_permissions (
  trip_id, member_id, can_edit_itinerary, itinerary_requires_approval,
  can_edit_expenses, expense_requires_approval, can_sync_calendar,
  updated_by_member_id
)
SELECT tm.trip_id, tm.id,
       tm.role <> 'viewer', false,
       tm.role <> 'viewer', false,
       tm.role <> 'viewer', owner_member.id
  FROM trip_members tm
  JOIN trip_members owner_member
    ON owner_member.trip_id = tm.trip_id
   AND owner_member.role = 'owner'
ON CONFLICT (trip_id, member_id) DO NOTHING;

CREATE TABLE calendar_connections (
  trip_id uuid NOT NULL,
  member_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'google_calendar'
    CHECK (provider = 'google_calendar'),
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  calendar_id text NOT NULL DEFAULT 'primary',
  connected_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, member_id, provider),
  FOREIGN KEY (trip_id, member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE CASCADE,
  CHECK (access_token_encrypted IS NOT NULL OR refresh_token_encrypted IS NOT NULL)
);

CREATE TABLE calendar_event_links (
  trip_id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  member_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'google_calendar'
    CHECK (provider = 'google_calendar'),
  calendar_id text NOT NULL DEFAULT 'primary',
  provider_event_id text NOT NULL CHECK (length(btrim(provider_event_id)) BETWEEN 5 AND 1024),
  provider_etag text,
  provider_html_link text,
  last_synced_item_revision integer NOT NULL CHECK (last_synced_item_revision >= 1),
  sync_status text NOT NULL DEFAULT 'synced'
    CHECK (sync_status IN ('synced', 'stale', 'failed')),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, itinerary_item_id, member_id, provider),
  UNIQUE (trip_id, member_id, provider, calendar_id, provider_event_id),
  FOREIGN KEY (trip_id, itinerary_item_id)
    REFERENCES itinerary_items (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE CASCADE
);

CREATE INDEX calendar_event_links_member_idx
  ON calendar_event_links (trip_id, member_id, provider, sync_status);
