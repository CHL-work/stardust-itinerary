ALTER TABLE member_permissions
  ALTER COLUMN itinerary_requires_approval SET DEFAULT true;

UPDATE member_permissions permissions
   SET itinerary_requires_approval = true,
       updated_at = CURRENT_TIMESTAMP
  FROM trip_members member
 WHERE member.trip_id = permissions.trip_id
   AND member.id = permissions.member_id
   AND member.role = 'editor'
   AND NOT permissions.itinerary_requires_approval;

COMMENT ON COLUMN member_permissions.itinerary_requires_approval IS
  'New editor memberships require owner review for itinerary mutations by default; the owner may explicitly change this per-member policy.';
