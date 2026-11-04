INSERT INTO app_users (id, display_name) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Demo Owner'),
  ('00000000-0000-4000-8000-000000000002', 'Sample Member');

INSERT INTO trips (
  id, owner_user_id, name, destination_name, time_zone, default_locale, default_currency, starts_on, ends_on
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'Example Journey',
  'Japan',
  'Asia/Tokyo',
  'zh-HK-lihkg',
  'JPY',
  '2030-04-01',
  '2030-04-03'
);

INSERT INTO trip_members (trip_id, id, user_id, display_name, role, status) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'Demo Owner',
    'owner',
    'active'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'Sample Member',
    'editor',
    'active'
  );

INSERT INTO member_permissions (
  trip_id, member_id, can_edit_itinerary, itinerary_requires_approval,
  can_edit_expenses, expense_requires_approval, can_sync_calendar,
  updated_by_member_id
) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    true, false, true, false, true,
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    true, false, true, false, true,
    '20000000-0000-4000-8000-000000000001'
  );

INSERT INTO trip_ai_settings (
  trip_id, enabled, owner_default_model,
  member_daily_limit, updated_by_member_id
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  true,
  'gpt-6.1-sol',
  20,
  '20000000-0000-4000-8000-000000000001'
);

INSERT INTO trip_days (trip_id, id, day_date, label) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '2030-04-01',
    'Arrival sample'
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '2030-04-02',
    NULL
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    '2030-04-03',
    NULL
  );

INSERT INTO itinerary_items (
  trip_id, id, trip_day_id, created_by_member_id, title, item_type,
  starts_at, ends_at, location_name
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '示範午餐',
  'meal',
  '2030-04-01T12:00:00+09:00',
  '2030-04-01T13:00:00+09:00',
  '示範餐廳'
);

INSERT INTO itinerary_revisions (
  trip_id, itinerary_item_id, revision, changed_by_member_id, snapshot, reason
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  1,
  '20000000-0000-4000-8000-000000000001',
  '{"title":"示範午餐","status":"planned"}',
  'fixture'
);

INSERT INTO expenses (
  trip_id, id, payer_member_id, itinerary_item_id, description,
  amount_minor, currency, status, occurred_at
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'Sample shared lunch',
  6000,
  'JPY',
  'posted',
  '2030-04-01T12:30:00+09:00'
);

INSERT INTO expense_splits (trip_id, expense_id, member_id, share_minor) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    3000
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    3000
  );

INSERT INTO expense_revisions (
  trip_id, expense_id, revision, changed_by_member_id, snapshot
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  1,
  '20000000-0000-4000-8000-000000000001',
  '{"description":"Sample shared lunch","amount_minor":6000,"currency":"JPY","status":"posted"}'
);

INSERT INTO audit_events (
  trip_id, id, actor_member_id, entity_type, entity_id, action, after_state, metadata
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'itinerary_item',
  '40000000-0000-4000-8000-000000000001',
  'created',
  '{"revision":1}',
  '{"source":"fixture"}'
);

INSERT INTO outbox_events (
  trip_id, id, topic, aggregate_type, aggregate_id, payload, idempotency_key
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'itinerary.item.changed',
  'itinerary_item',
  '40000000-0000-4000-8000-000000000001',
  '{"revision":1,"source":"fixture"}',
  'fixture-itinerary-item-1-revision-1'
);
