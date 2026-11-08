import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { AuthConfig } from "@/lib/auth/config";
import type { GoogleIdentity } from "@/lib/auth/google";
import { freshAuthenticationCeiling, readCurrentSessionCeiling, rollingSessionExpiry } from "@/lib/auth/session-lifetime";
import { closeMemberAiConversationForIdentityChange } from "@/lib/ai/conversation";
import { revokeAiKeyGrants } from "@/lib/app/ai-key-grants";
import { recordRefusal } from "@/lib/admin/daily-counts";
import {
  AccountSuspendedError,
  ClaimUnavailableError,
  JoinUnavailableError,
  MembershipDisabledError,
  RateLimitError,
  SessionUnavailableError,
} from "@/lib/auth/errors";
import {
  createDeviceLabel,
  createOpaqueToken,
  hashOpaqueToken,
  hashRateLimitKey,
} from "@/lib/auth/tokens";

const CLAIM_LIFETIME_MS = 48 * 60 * 60 * 1_000;

export type ClaimPreview = {
  tripId: string;
  tripName: string;
  memberId: string;
  memberDisplayName: string;
  role: "owner" | "editor" | "viewer";
  expiresAt: Date;
};

export type JoinPreview = {
  tripId: string;
  tripName: string;
  maxMembers: number;
  memberCount: number;
  remainingSeats: number;
};

export type SessionGrant = {
  rawToken: string;
  sessionId: string;
  tripId: string;
  memberId: string;
  userId: string;
  role: "owner" | "editor" | "viewer";
  expiresAt: Date;
  absoluteExpiresAt: Date;
};

export type AuthenticatedSession = Omit<SessionGrant, "rawToken"> & {
  displayName: string;
  issuer: string;
  subject: string;
  generation: number;
};

export type SessionDevice = {
  id: string;
  deviceLabel: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  current: boolean;
};

type IssueClaimInput = {
  tripId: string;
  memberId: string;
  actorMemberId: string | null;
  actorUserId?: string;
};

type ManageJoinLinkInput = {
  tripId: string;
  actorMemberId: string;
  actorUserId?: string;
  /** People who join through the link may use the issuing owner's own AI keys (JOB-063). */
  sharesAiKeys?: boolean;
};

async function lockAuthTrip(client: PoolClient, tripId: string): Promise<void> {
  const trip = await client.query("SELECT id FROM trips WHERE id = $1 FOR UPDATE",[tripId]);
  if (trip.rowCount !== 1) throw new SessionUnavailableError("Trip access is unavailable.");
}

async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function disconnectMemberCalendarForIdentityChange(
  client: PoolClient,
  input: {
    tripId: string;
    memberId: string;
    actorMemberId: string | null;
    cause: "identity_unbound" | "owner_recovery";
  },
): Promise<void> {
  const links = await client.query(
    `DELETE FROM calendar_event_links
      WHERE trip_id = $1 AND member_id = $2`,
    [input.tripId, input.memberId],
  );
  const connection = await client.query(
    `DELETE FROM calendar_connections
      WHERE trip_id = $1 AND member_id = $2`,
    [input.tripId, input.memberId],
  );
  if (!(links.rowCount || connection.rowCount)) return;
  await client.query(
    `INSERT INTO audit_events (
       trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
     ) VALUES ($1, $2, $3, 'calendar_connection', $4, 'calendar_disconnected', $5::jsonb)`,
    [
      input.tripId,
      randomUUID(),
      input.actorMemberId,
      input.memberId,
      JSON.stringify({ provider: "google_calendar", cause: input.cause }),
    ],
  );
}

function identityDisplayName(identity: GoogleIdentity): string {
  const profileName = identity.displayNameHint?.trim();
  if (profileName) {
    return profileName.slice(0, 120);
  }
  const emailName = identity.emailHint?.split("@", 1)[0]?.trim();
  return emailName ? emailName.slice(0, 120) : "Trip member";
}

export async function insertSession(
  client: PoolClient,
  config: AuthConfig,
  input: {
    tripId: string;
    memberId: string;
    userId: string;
    role: SessionGrant["role"];
    absoluteExpiresAt: Date;
    userAgent: string | null;
  },
): Promise<SessionGrant> {
  const rawToken = createOpaqueToken();
  const tokenHash = hashOpaqueToken(config.authSecret, "session", rawToken);
  const sessionId = randomUUID();
  const expiresAt = rollingSessionExpiry(input.absoluteExpiresAt);

  await client.query(
    `INSERT INTO auth_sessions (
       id, family_id, trip_id, member_id, user_id, token_hash,
       device_label, expires_at, absolute_expires_at
     ) VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      sessionId,
      input.tripId,
      input.memberId,
      input.userId,
      tokenHash,
      createDeviceLabel(input.userAgent),
      expiresAt,
      input.absoluteExpiresAt,
    ],
  );
  const selection = await client.query<{ id: string }>(
    `UPDATE app_users
        SET last_selected_trip_id = $1
      WHERE id = $2
        AND EXISTS (
          SELECT 1
            FROM trip_members tm
           WHERE tm.trip_id = $1
             AND tm.id = $3
             AND tm.user_id = app_users.id
             AND tm.status = 'active'
        )
    RETURNING id`,
    [input.tripId, input.userId, input.memberId],
  );
  if (!selection.rows[0]) {
    throw new SessionUnavailableError("The selected trip membership is unavailable.");
  }

  return {
    rawToken,
    sessionId,
    tripId: input.tripId,
    memberId: input.memberId,
    userId: input.userId,
    role: input.role,
    expiresAt,
    absoluteExpiresAt: input.absoluteExpiresAt,
  };
}

export async function previewClaim(
  pool: Pool,
  config: AuthConfig,
  rawToken: string,
): Promise<ClaimPreview | null> {
  const tokenHash = hashOpaqueToken(config.authSecret, "claim", rawToken);
  const result = await pool.query<{
    trip_id: string;
    trip_name: string;
    member_id: string;
    display_name: string;
    role: ClaimPreview["role"];
    expires_at: Date;
  }>(
    `SELECT cl.trip_id, t.name AS trip_name, cl.member_id,
            tm.display_name, tm.role, cl.expires_at
       FROM member_claim_links cl
       JOIN trips t ON t.id = cl.trip_id
       JOIN trip_members tm ON tm.trip_id = cl.trip_id AND tm.id = cl.member_id
      WHERE cl.token_hash = $1
        AND cl.consumed_at IS NULL
        AND cl.revoked_at IS NULL
        AND cl.expires_at > CURRENT_TIMESTAMP
        AND tm.status = 'invited'`,
    [tokenHash],
  );
  const row = result.rows[0];
  return row
    ? {
        tripId: row.trip_id,
        tripName: row.trip_name,
        memberId: row.member_id,
        memberDisplayName: row.display_name,
        role: row.role,
        expiresAt: row.expires_at,
      }
    : null;
}

export async function previewJoinLink(
  pool: Pool,
  config: AuthConfig,
  rawToken: string,
): Promise<JoinPreview | null> {
  const tokenHash = hashOpaqueToken(config.authSecret, "trip-join", rawToken);
  const result = await pool.query<{
    trip_id: string;
    trip_name: string;
    max_members: number;
    member_count: number;
  }>(
    `SELECT jl.trip_id, t.name AS trip_name, t.max_members,
            occupied.member_count
       FROM trip_join_links jl
       JOIN trips t ON t.id = jl.trip_id
       CROSS JOIN LATERAL (
         SELECT count(*)::integer AS member_count
           FROM trip_members tm
          WHERE tm.trip_id = jl.trip_id
            AND tm.status <> 'removed'
       ) occupied
      WHERE jl.token_hash = $1
        AND jl.revoked_at IS NULL
        AND jl.exhausted_at IS NULL
        AND occupied.member_count < t.max_members
        AND ((t.ends_on + 1)::timestamp AT TIME ZONE t.time_zone)
              + make_interval(days => $2) > CURRENT_TIMESTAMP`,
    [tokenHash, config.tripGraceDays],
  );
  const row = result.rows[0];
  return row
    ? {
        tripId: row.trip_id,
        tripName: row.trip_name,
        maxMembers: row.max_members,
        memberCount: row.member_count,
        remainingSeats: row.max_members - row.member_count,
      }
    : null;
}

export async function issueClaim(
  pool: Pool,
  config: AuthConfig,
  input: IssueClaimInput,
): Promise<{ rawToken: string; expiresAt: Date }> {
  return withTransaction(pool, async (client) => {
    await lockAuthTrip(client,input.tripId);
    const member = await client.query<{ role: ClaimPreview["role"]; status: string }>(
      `SELECT role, status
         FROM trip_members
        WHERE trip_id = $1 AND id = $2
        FOR UPDATE`,
      [input.tripId, input.memberId],
    );
    if (!member.rows[0] || ["revoked", "removed", "trip_deleted"].includes(member.rows[0].status)) {
      throw new ClaimUnavailableError();
    }

    if (input.actorMemberId) {
      const actor = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM trip_members
          WHERE trip_id = $1 AND id = $2 AND ($3::uuid IS NULL OR user_id=$3) FOR UPDATE`,
        [input.tripId, input.actorMemberId,input.actorUserId ?? null],
      );
      if (actor.rows[0]?.role !== "owner" || actor.rows[0].status !== "active") {
        throw new SessionUnavailableError("Owner authorization is required.");
      }
      if (member.rows[0].status !== "invited") {
        throw new ClaimUnavailableError();
      }
    } else if (member.rows[0].role !== "owner") {
      throw new SessionUnavailableError("Bootstrap can only issue an owner claim.");
    } else if (member.rows[0].status === "active") {
      await client.query(
        `UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
                revoke_reason = COALESCE(revoke_reason, 'owner_recovery')
        WHERE trip_id = $1 AND member_id = $2`,
        [input.tripId, input.memberId],
      );
      await disconnectMemberCalendarForIdentityChange(client, {
        tripId: input.tripId,
        memberId: input.memberId,
        actorMemberId: null,
        cause: "owner_recovery",
      });
      await closeMemberAiConversationForIdentityChange(client, {
        tripId: input.tripId,
        memberId: input.memberId,
        actorMemberId: null,
        cause: "owner_recovery",
      });
      await client.query(
        `UPDATE trip_members
            SET user_id = NULL, status = 'invited', current_revision = current_revision + 1
          WHERE trip_id = $1 AND id = $2`,
        [input.tripId, input.memberId],
      );
      await client.query(
        `INSERT INTO audit_events (
           trip_id, id, entity_type, entity_id, action, metadata
         ) VALUES ($1, $2, 'trip_member', $3, 'owner_recovery_started', $4)`,
        [
          input.tripId,
          randomUUID(),
          input.memberId,
          JSON.stringify({ source: "owner_bootstrap" }),
        ],
      );
    }

    await client.query(
      `UPDATE member_claim_links
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE trip_id = $1 AND member_id = $2
          AND consumed_at IS NULL AND revoked_at IS NULL`,
      [input.tripId, input.memberId],
    );

    const rawToken = createOpaqueToken();
    const tokenHash = hashOpaqueToken(config.authSecret, "claim", rawToken);
    const claimId = randomUUID();
    const expiresAt = new Date(Date.now() + CLAIM_LIFETIME_MS);
    await client.query(
      `INSERT INTO member_claim_links (
         id, trip_id, member_id, token_hash, expires_at, created_by_member_id
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [claimId, input.tripId, input.memberId, tokenHash, expiresAt, input.actorMemberId],
    );
    await client.query(
      `INSERT INTO audit_events (
         trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
       ) VALUES ($1, $2, $3, 'member_claim_link', $4, 'issued', $5)`,
      [
        input.tripId,
        randomUUID(),
        input.actorMemberId,
        claimId,
        JSON.stringify({ source: input.actorMemberId ? "web" : "owner_bootstrap" }),
      ],
    );
    return { rawToken, expiresAt };
  });
}

export async function revokeClaims(
  pool: Pool,
  input: IssueClaimInput,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await lockAuthTrip(client,input.tripId);
    if (!input.actorMemberId) {
      throw new SessionUnavailableError("Owner authorization is required.");
    }
    const actor = await client.query<{ role: string; status: string }>(
      `SELECT role, status FROM trip_members WHERE trip_id = $1 AND id = $2 AND ($3::uuid IS NULL OR user_id=$3) FOR UPDATE`,
      [input.tripId, input.actorMemberId,input.actorUserId ?? null],
    );
    if (actor.rows[0]?.role !== "owner" || actor.rows[0].status !== "active") {
      throw new SessionUnavailableError("Owner authorization is required.");
    }
    await client.query(
      `SELECT id FROM trip_members WHERE trip_id = $1 AND id = $2 FOR UPDATE`,
      [input.tripId, input.memberId],
    );
    const result = await client.query<{ id: string }>(
      `UPDATE member_claim_links
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE trip_id = $1 AND member_id = $2
          AND consumed_at IS NULL AND revoked_at IS NULL
      RETURNING id`,
      [input.tripId, input.memberId],
    );
    for (const row of result.rows) {
      await client.query(
        `INSERT INTO audit_events (
           trip_id, id, actor_member_id, entity_type, entity_id, action
         ) VALUES ($1, $2, $3, 'member_claim_link', $4, 'revoked')`,
        [input.tripId, randomUUID(), input.actorMemberId, row.id],
      );
    }
  });
}

export async function issueJoinLink(
  pool: Pool,
  config: AuthConfig,
  input: ManageJoinLinkInput,
): Promise<{ rawToken: string }> {
  return withTransaction(pool, async (client) => {
    const trip = await client.query<{ max_members: number; member_count: number }>(
      `SELECT t.max_members,
              (SELECT count(*)::integer
                 FROM trip_members tm
                WHERE tm.trip_id = t.id AND tm.status <> 'removed') AS member_count
         FROM trips t
        WHERE t.id = $1
        FOR UPDATE`,
      [input.tripId],
    );
    const tripRow = trip.rows[0];
    if (!tripRow) {
      throw new JoinUnavailableError();
    }

    const actor = await client.query<{ role: string; status: string }>(
      `SELECT role, status
         FROM trip_members
        WHERE trip_id = $1 AND id = $2 AND ($3::uuid IS NULL OR user_id=$3) FOR UPDATE`,
      [input.tripId, input.actorMemberId,input.actorUserId ?? null],
    );
    if (actor.rows[0]?.role !== "owner" || actor.rows[0].status !== "active") {
      throw new SessionUnavailableError("Owner authorization is required.");
    }
    if (tripRow.member_count >= tripRow.max_members) {
      throw new JoinUnavailableError(
        `This trip has reached its ${tripRow.max_members}-member limit, including the owner.`,
      );
    }

    const replaced = await client.query<{ id: string }>(
      `UPDATE trip_join_links
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE trip_id = $1
          AND revoked_at IS NULL
          AND exhausted_at IS NULL
      RETURNING id`,
      [input.tripId],
    );
    for (const row of replaced.rows) {
      await client.query(
        `INSERT INTO audit_events (
           trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
         ) VALUES ($1, $2, $3, 'trip_join_link', $4, 'revoked', $5)`,
        [
          input.tripId,
          randomUUID(),
          input.actorMemberId,
          row.id,
          JSON.stringify({ source: "replacement" }),
        ],
      );
    }

    const rawToken = createOpaqueToken();
    const tokenHash = hashOpaqueToken(config.authSecret, "trip-join", rawToken);
    const linkId = randomUUID();
    // The column exists from migration 0055; a link that shares nothing works without it.
    await client.query(
      `INSERT INTO trip_join_links (
         id, trip_id, token_hash, created_by_member_id${input.sharesAiKeys ? ", shares_ai_keys" : ""}
       ) VALUES ($1, $2, $3, $4${input.sharesAiKeys ? ", true" : ""})`,
      [linkId, input.tripId, tokenHash, input.actorMemberId],
    );
    await client.query(
      `INSERT INTO audit_events (
         trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
       ) VALUES ($1, $2, $3, 'trip_join_link', $4, 'issued', $5)`,
      [
        input.tripId,
        randomUUID(),
        input.actorMemberId,
        linkId,
        JSON.stringify({
          remainingSeats: tripRow.max_members - tripRow.member_count,
          ...(input.sharesAiKeys ? { sharesAiKeys: true } : {}),
        }),
      ],
    );
    return { rawToken };
  });
}

export async function revokeJoinLink(
  pool: Pool,
  input: ManageJoinLinkInput,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await lockAuthTrip(client,input.tripId);
    const actor = await client.query<{ role: string; status: string }>(
      `SELECT role, status
         FROM trip_members
        WHERE trip_id = $1 AND id = $2 AND ($3::uuid IS NULL OR user_id=$3) FOR UPDATE`,
      [input.tripId, input.actorMemberId,input.actorUserId ?? null],
    );
    if (actor.rows[0]?.role !== "owner" || actor.rows[0].status !== "active") {
      throw new SessionUnavailableError("Owner authorization is required.");
    }
    const revoked = await client.query<{ id: string }>(
      `UPDATE trip_join_links
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE trip_id = $1
          AND revoked_at IS NULL
          AND exhausted_at IS NULL
      RETURNING id`,
      [input.tripId],
    );
    for (const row of revoked.rows) {
      await client.query(
        `INSERT INTO audit_events (
           trip_id, id, actor_member_id, entity_type, entity_id, action
         ) VALUES ($1, $2, $3, 'trip_join_link', $4, 'revoked')`,
        [input.tripId, randomUUID(), input.actorMemberId, row.id],
      );
    }
  });
}

export async function consumeJoinLink(
  pool: Pool,
  config: AuthConfig,
  input: { rawToken: string; identity: GoogleIdentity; userAgent: string | null },
): Promise<SessionGrant> {
  if (input.identity.issuer !== "https://accounts.google.com" || !input.identity.subject) {
    throw new JoinUnavailableError("Sign in with Google before joining a trip.");
  }
  const authenticationCeiling = freshAuthenticationCeiling();
  return withTransaction(pool, async (client) => {
    const tokenHash = hashOpaqueToken(config.authSecret, "trip-join", input.rawToken);
    const candidate = await client.query<{
      id: string;
      trip_id: string;
      created_by_member_id: string;
      revoked_at: Date | null;
      exhausted_at: Date | null;
    }>(
      `SELECT id, trip_id, created_by_member_id, revoked_at, exhausted_at
         FROM trip_join_links
        WHERE token_hash = $1`,
      [tokenHash],
    );
    const candidateRow = candidate.rows[0];
    if (!candidateRow || candidateRow.revoked_at) {
      throw new JoinUnavailableError();
    }

    const trip = await client.query<{
      max_members: number;
      member_count: number;
      absolute_expires_at: Date;
    }>(
      `SELECT t.max_members,
              (SELECT count(*)::integer
                 FROM trip_members tm
                WHERE tm.trip_id = t.id AND tm.status <> 'removed') AS member_count,
              ((t.ends_on + 1)::timestamp AT TIME ZONE t.time_zone)
                + make_interval(days => $2) AS absolute_expires_at
         FROM trips t
        WHERE t.id = $1
        FOR UPDATE`,
      [candidateRow.trip_id, config.tripGraceDays],
    );
    const tripRow = trip.rows[0];
    if (!tripRow || tripRow.absolute_expires_at <= new Date()) {
      throw new JoinUnavailableError("This trip is no longer accepting members.");
    }

    const link = await client.query<{
      id: string;
      created_by_member_id: string;
      revoked_at: Date | null;
      exhausted_at: Date | null;
      shares_ai_keys: boolean;
    }>(
      `SELECT id, created_by_member_id, revoked_at, exhausted_at,
              COALESCE((to_jsonb(link)->>'shares_ai_keys')::boolean, false) AS shares_ai_keys
         FROM trip_join_links link
        WHERE id = $1
        FOR UPDATE`,
      [candidateRow.id],
    );
    const linkRow = link.rows[0];
    if (!linkRow || linkRow.revoked_at) {
      throw new JoinUnavailableError();
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      JSON.stringify([input.identity.issuer, input.identity.subject]),
    ]);
    // The identity lock can wait past the invitation window. The trip lock
    // keeps this admission deadline stable, but fresh authentication does not extend it.
    if (tripRow.absolute_expires_at <= new Date()) {
      throw new JoinUnavailableError("This trip is no longer accepting members.");
    }
    const existingIdentity = await client.query<{ user_id: string }>(
      `SELECT user_id
         FROM oidc_identities
        WHERE issuer = $1 AND subject = $2`,
      [input.identity.issuer, input.identity.subject],
    );
    let userId = existingIdentity.rows[0]?.user_id;

    if (userId) {
      const existingMembership = await client.query<{
        id: string;
        role: SessionGrant["role"];
        status: string;
      }>(
        `SELECT id, role, status
           FROM trip_members
          WHERE trip_id = $1 AND user_id = $2
          FOR UPDATE`,
        [candidateRow.trip_id, userId],
      );
      const membership = existingMembership.rows[0];
      if (membership) {
        if (membership.status !== "active") {
          throw new JoinUnavailableError(
            "This Google account has a disabled or removed membership for this trip.",
          );
        }
        await client.query(
          `UPDATE oidc_identities
              SET email_hint = $3,
                  display_name_hint = $4,
                  last_authenticated_at = CURRENT_TIMESTAMP
            WHERE issuer = $1 AND subject = $2`,
          [
            input.identity.issuer,
            input.identity.subject,
            input.identity.emailHint,
            input.identity.displayNameHint,
          ],
        );
        return insertSession(client, config, {
          tripId: candidateRow.trip_id,
          memberId: membership.id,
          userId,
          role: membership.role,
          absoluteExpiresAt: authenticationCeiling,
          userAgent: input.userAgent,
        });
      }
    }

    if (linkRow.exhausted_at || tripRow.member_count >= tripRow.max_members) {
      throw new JoinUnavailableError("This trip has reached its member limit.");
    }

    const displayName = identityDisplayName(input.identity);
    if (!userId) {
      userId = randomUUID();
      await client.query(
        `INSERT INTO app_users (id, display_name) VALUES ($1, $2)`,
        [userId, displayName],
      );
      await client.query(
        `INSERT INTO oidc_identities (
           issuer, subject, user_id, email_hint, display_name_hint, last_authenticated_at
         ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [
          input.identity.issuer,
          input.identity.subject,
          userId,
          input.identity.emailHint,
          input.identity.displayNameHint,
        ],
      );
    } else {
      await client.query(
        `UPDATE oidc_identities
            SET email_hint = $3,
                display_name_hint = $4,
                last_authenticated_at = CURRENT_TIMESTAMP
          WHERE issuer = $1 AND subject = $2`,
        [
          input.identity.issuer,
          input.identity.subject,
          input.identity.emailHint,
          input.identity.displayNameHint,
        ],
      );
    }

    const memberId = randomUUID();
    await client.query(
      `INSERT INTO trip_members (
         trip_id, id, user_id, display_name, role, status
       ) VALUES ($1, $2, $3, $4, 'editor', 'active')`,
      [candidateRow.trip_id, memberId, userId, displayName],
    );
    await client.query(
      `INSERT INTO member_permissions (
         trip_id, member_id, can_edit_itinerary, itinerary_requires_approval,
         can_edit_expenses, expense_requires_approval, can_sync_calendar,
         updated_by_member_id
       ) VALUES ($1, $2, true, true, true, false, true, $3)`,
      [candidateRow.trip_id, memberId, linkRow.created_by_member_id],
    );
    await client.query(
      `INSERT INTO audit_events (
         trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
       ) VALUES ($1, $2, $3, 'trip_member', $3, 'joined', $4)`,
      [
        candidateRow.trip_id,
        randomUUID(),
        memberId,
        JSON.stringify({ source: "reusable_join_link", joinLinkId: linkRow.id }),
      ],
    );
    if (linkRow.shares_ai_keys) {
      // The link was created to share its owner's AI keys (JOB-063). That holds only while the
      // creator is still an active owner; the grant never carries key material.
      const grant = await client.query(
        `INSERT INTO trip_ai_key_grants (trip_id, member_id, sponsor_member_id)
         SELECT $1, $2, sponsor.id FROM trip_members sponsor
          WHERE sponsor.trip_id = $1 AND sponsor.id = $3 AND sponsor.role = 'owner' AND sponsor.status = 'active'
         ON CONFLICT (trip_id, member_id) DO NOTHING`,
        [candidateRow.trip_id, memberId, linkRow.created_by_member_id],
      );
      if (grant.rowCount) {
        await client.query(
          `INSERT INTO audit_events (
             trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
           ) VALUES ($1, $2, $3, 'trip_member', $4, 'ai_keys_shared', $5)`,
          [
            candidateRow.trip_id,
            randomUUID(),
            linkRow.created_by_member_id,
            memberId,
            JSON.stringify({ source: "join_link", sponsorMemberId: linkRow.created_by_member_id, joinLinkId: linkRow.id }),
          ],
        );
      }
    }

    return insertSession(client, config, {
      tripId: candidateRow.trip_id,
      memberId,
      userId,
      role: "editor",
      absoluteExpiresAt: authenticationCeiling,
      userAgent: input.userAgent,
    });
  });
}

export async function consumeClaim(
  pool: Pool,
  config: AuthConfig,
  input: { rawToken: string; identity: GoogleIdentity; userAgent: string | null },
): Promise<SessionGrant> {
  if (input.identity.issuer !== "https://accounts.google.com" || !input.identity.subject) {
    throw new ClaimUnavailableError();
  }
  const authenticationCeiling = freshAuthenticationCeiling();
  return withTransaction(pool, async (client) => {
    const tokenHash = hashOpaqueToken(config.authSecret, "claim", input.rawToken);
    const candidate = await client.query<{ id: string; trip_id: string; member_id: string }>(
      `SELECT id, trip_id, member_id
         FROM member_claim_links
        WHERE token_hash = $1`,
      [tokenHash],
    );
    const claimCandidate = candidate.rows[0];
    if (!claimCandidate) {
      throw new ClaimUnavailableError();
    }
    await lockAuthTrip(client,claimCandidate.trip_id);

    const member = await client.query<{
      user_id: string | null;
      display_name: string;
      role: SessionGrant["role"];
      status: string;
      absolute_expires_at: Date;
    }>(
      `SELECT tm.user_id, tm.display_name, tm.role, tm.status,
              ((t.ends_on + 1)::timestamp AT TIME ZONE t.time_zone)
                + make_interval(days => $3) AS absolute_expires_at
         FROM trip_members tm
         JOIN trips t ON t.id = tm.trip_id
        WHERE tm.trip_id = $1 AND tm.id = $2
        FOR UPDATE OF tm`,
      [claimCandidate.trip_id, claimCandidate.member_id, config.tripGraceDays],
    );
    const memberRow = member.rows[0];
    // Travel dates govern new invitation admission, not subsequent member access.
    if (!memberRow || memberRow.status !== "invited" || memberRow.absolute_expires_at <= new Date()) {
      throw new ClaimUnavailableError();
    }

    const claim = await client.query<{ id: string }>(
      `SELECT id FROM member_claim_links
        WHERE id = $1
          AND consumed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        FOR UPDATE`,
      [claimCandidate.id],
    );
    if (!claim.rows[0]) {
      throw new ClaimUnavailableError();
    }

    // An owner invitation admits only an operator account when operators are configured (JOB-078: any of them).
    const operatorEmails = config.ownerGoogleEmails ?? [];
    if (
      memberRow.role === "owner" &&
      operatorEmails.length > 0 &&
      !operatorEmails.includes(input.identity.emailHint?.toLowerCase() ?? "")
    ) {
      throw new ClaimUnavailableError();
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      JSON.stringify([input.identity.issuer, input.identity.subject]),
    ]);
    if (memberRow.absolute_expires_at <= new Date()) {
      throw new ClaimUnavailableError();
    }
    const existingIdentity = await client.query<{ user_id: string }>(
      `SELECT user_id FROM oidc_identities
        WHERE issuer = $1 AND subject = $2`,
      [input.identity.issuer, input.identity.subject],
    );
    let userId = existingIdentity.rows[0]?.user_id;
    if (!userId) {
      userId = randomUUID();
      await client.query(
        `INSERT INTO app_users (id, display_name) VALUES ($1, $2)`,
        [userId, input.identity.displayNameHint || memberRow.display_name],
      );
      await client.query(
        `INSERT INTO oidc_identities (
           issuer, subject, user_id, email_hint, display_name_hint, last_authenticated_at
         ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [
          input.identity.issuer,
          input.identity.subject,
          userId,
          input.identity.emailHint,
          input.identity.displayNameHint,
        ],
      );
    } else {
      await client.query(
        `UPDATE oidc_identities
            SET email_hint = $3,
                display_name_hint = $4,
                last_authenticated_at = CURRENT_TIMESTAMP
          WHERE issuer = $1 AND subject = $2`,
        [
          input.identity.issuer,
          input.identity.subject,
          input.identity.emailHint,
          input.identity.displayNameHint,
        ],
      );
    }

    if (memberRow.user_id && memberRow.user_id !== userId) {
      throw new ClaimUnavailableError();
    }

    await client.query(
      `UPDATE trip_members
          SET user_id = $3, status = 'active', current_revision = current_revision + 1
        WHERE trip_id = $1 AND id = $2`,
      [claimCandidate.trip_id, claimCandidate.member_id, userId],
    );
    if (memberRow.role === "owner") {
      await client.query(
        `UPDATE trips SET owner_user_id = $2 WHERE id = $1`,
        [claimCandidate.trip_id, userId],
      );
    }
    await client.query(
      `UPDATE member_claim_links SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [claimCandidate.id],
    );
    await client.query(
      `UPDATE member_claim_links
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE trip_id = $1 AND member_id = $2 AND id <> $3
          AND consumed_at IS NULL AND revoked_at IS NULL`,
      [claimCandidate.trip_id, claimCandidate.member_id, claimCandidate.id],
    );
    await client.query(
      `INSERT INTO audit_events (
         trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
       ) VALUES ($1, $2, $3, 'trip_member', $3, 'identity_claimed', $4)`,
      [
        claimCandidate.trip_id,
        randomUUID(),
        claimCandidate.member_id,
        JSON.stringify({ issuer: input.identity.issuer, source: "web" }),
      ],
    );

    return insertSession(client, config, {
      tripId: claimCandidate.trip_id,
      memberId: claimCandidate.member_id,
      userId,
      role: memberRow.role,
      absoluteExpiresAt: authenticationCeiling,
      userAgent: input.userAgent,
    });
  });
}

export async function signInExistingIdentity(
  pool: Pool,
  config: AuthConfig,
  input: { identity: GoogleIdentity; userAgent: string | null },
): Promise<SessionGrant> {
  const authenticationCeiling = freshAuthenticationCeiling();
  return withTransaction(pool, async (client) => {
    const result = await client.query<{
      user_id: string;
      trip_id: string;
      member_id: string;
      role: SessionGrant["role"];
    }>(
      `SELECT oi.user_id, tm.trip_id, tm.id AS member_id, tm.role
         FROM oidc_identities oi
         JOIN app_users au ON au.id = oi.user_id
         JOIN trip_members tm ON tm.user_id = oi.user_id AND tm.status = 'active'
         JOIN trips t ON t.id = tm.trip_id
        WHERE oi.issuer = $1 AND oi.subject = $2
        ORDER BY
          (tm.trip_id = au.last_selected_trip_id) DESC,
          CASE
            WHEN (CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date
                   BETWEEN t.starts_on AND t.ends_on THEN 0
            WHEN (CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date < t.starts_on THEN 1
            ELSE 2
          END,
          CASE
            WHEN (CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date < t.starts_on
              THEN t.starts_on
          END ASC NULLS LAST,
          CASE
            WHEN (CURRENT_TIMESTAMP AT TIME ZONE t.time_zone)::date >= t.starts_on
              THEN t.ends_on
          END DESC NULLS LAST,
          (tm.role = 'owner') DESC,
          t.name
        LIMIT 1`,
      [input.identity.issuer, input.identity.subject],
    );
    const selected = result.rows[0];
    if (!selected) {
      const membershipState = await client.query<{
        has_disabled_membership: boolean;
      }>(
        `SELECT count(*) FILTER (WHERE tm.status = 'revoked') > 0 AS has_disabled_membership
           FROM oidc_identities oi
           JOIN trip_members tm ON tm.user_id = oi.user_id
          WHERE oi.issuer = $1 AND oi.subject = $2`,
        [input.identity.issuer, input.identity.subject],
      );
      const state = membershipState.rows[0];
      if (state?.has_disabled_membership) {
        throw new MembershipDisabledError();
      }
      throw new SessionUnavailableError("No active trip membership is bound to this Google account.");
    }
    // Rank without locking a member first: issuing a session can update the
    // user's last-selected-trip FK. Trip/role mutations use the same trip-first
    // ordering, so revalidate the exact candidate after acquiring that lock.
    await lockAuthTrip(client, selected.trip_id);
    const current = await client.query<{
      user_id: string;
      trip_id: string;
      member_id: string;
      role: SessionGrant["role"];
    }>(
      `SELECT oi.user_id, tm.trip_id, tm.id AS member_id, tm.role
         FROM oidc_identities oi
         JOIN trip_members tm ON tm.user_id = oi.user_id AND tm.status = 'active'
        WHERE oi.issuer = $1 AND oi.subject = $2 AND oi.user_id = $3
          AND tm.trip_id = $4 AND tm.id = $5
        FOR UPDATE OF tm`,
      [input.identity.issuer, input.identity.subject,
        selected.user_id, selected.trip_id, selected.member_id],
    );
    const row = current.rows[0];
    if (!row) throw new SessionUnavailableError("The selected trip membership changed. Sign in again.");
    await client.query(
      `UPDATE oidc_identities
          SET email_hint = $3, display_name_hint = $4,
              last_authenticated_at = CURRENT_TIMESTAMP
        WHERE issuer = $1 AND subject = $2`,
      [
        input.identity.issuer,
        input.identity.subject,
        input.identity.emailHint,
        input.identity.displayNameHint,
      ],
    );
    return insertSession(client, config, {
      tripId: row.trip_id,
      memberId: row.member_id,
      userId: row.user_id,
      role: row.role,
      absoluteExpiresAt: authenticationCeiling,
      userAgent: input.userAgent,
    });
  });
}

export async function verifySession(
  pool: Pool,
  config: AuthConfig,
  rawToken: string,
): Promise<AuthenticatedSession | null> {
  const tokenHash = hashOpaqueToken(config.authSecret, "session", rawToken);
  const result = await pool.query<{
    id: string;
    trip_id: string;
    member_id: string;
    user_id: string;
    role: AuthenticatedSession["role"];
    expires_at: Date;
    absolute_expires_at: Date;
    display_name: string;
    issuer: string;
    subject: string;
    generation: number;
  }>(
    `UPDATE auth_sessions s
        SET last_seen_at = CURRENT_TIMESTAMP
       FROM trip_members tm, oidc_identities oi, app_users au
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP
        AND s.absolute_expires_at > CURRENT_TIMESTAMP
        AND tm.trip_id = s.trip_id AND tm.id = s.member_id
        AND tm.user_id = s.user_id AND tm.status = 'active'
        AND oi.user_id = s.user_id
        -- A suspended account's sessions stop working at once (JOB-069). to_jsonb tolerates
        -- databases from before migration 0059.
        AND au.id = s.user_id AND (to_jsonb(au) ->> 'suspended_at') IS NULL
    RETURNING s.id, s.trip_id, s.member_id, s.user_id, tm.role,
              s.expires_at, s.absolute_expires_at, tm.display_name,
              oi.issuer, oi.subject, s.generation`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    sessionId: row.id,
    tripId: row.trip_id,
    memberId: row.member_id,
    userId: row.user_id,
    role: row.role,
    expiresAt: row.expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    displayName: row.display_name,
    issuer: row.issuer,
    subject: row.subject,
    generation: row.generation,
  };
}

export async function rotateSession(
  pool: Pool,
  config: AuthConfig,
  rawToken: string,
): Promise<SessionGrant> {
  const outcome = await withTransaction(pool, async (client) => {
    const tokenHash = hashOpaqueToken(config.authSecret, "session", rawToken);
    const replay = await client.query<{ id: string }>(
      `UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
              revoke_reason = COALESCE(revoke_reason, 'refresh_token_replay')
        WHERE previous_token_hash = $1
      RETURNING id`,
      [tokenHash],
    );
    if (replay.rows[0]) {
      return { replayDetected: true as const };
    }

    const current = await client.query<{
      id: string;
      trip_id: string;
      member_id: string;
      user_id: string;
      role: SessionGrant["role"];
      absolute_expires_at: Date;
    }>(
      `SELECT s.id, s.trip_id, s.member_id, s.user_id, tm.role, s.absolute_expires_at
         FROM auth_sessions s
         JOIN trip_members tm ON tm.trip_id = s.trip_id AND tm.id = s.member_id
         JOIN app_users au ON au.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > CURRENT_TIMESTAMP
          AND s.absolute_expires_at > CURRENT_TIMESTAMP
          AND tm.user_id = s.user_id AND tm.status = 'active'
          AND (to_jsonb(au) ->> 'suspended_at') IS NULL
        FOR UPDATE OF s`,
      [tokenHash],
    );
    const row = current.rows[0];
    if (!row) {
      throw new SessionUnavailableError();
    }

    const newRawToken = createOpaqueToken();
    const newHash = hashOpaqueToken(config.authSecret, "session", newRawToken);
    const expiresAt = rollingSessionExpiry(row.absolute_expires_at);
    await client.query(
      `UPDATE auth_sessions
          SET previous_token_hash = token_hash,
              token_hash = $2,
              generation = generation + 1,
              rotated_at = CURRENT_TIMESTAMP,
              last_seen_at = CURRENT_TIMESTAMP,
              expires_at = $3
        WHERE id = $1`,
      [row.id, newHash, expiresAt],
    );
    return {
      replayDetected: false as const,
      grant: {
        rawToken: newRawToken,
        sessionId: row.id,
        tripId: row.trip_id,
        memberId: row.member_id,
        userId: row.user_id,
        role: row.role,
        expiresAt,
        absoluteExpiresAt: row.absolute_expires_at,
      },
    };
  });
  if (outcome.replayDetected) {
    throw new SessionUnavailableError("Session refresh replay detected.");
  }
  return outcome.grant;
}

export async function revokeSession(
  pool: Pool,
  sessionId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
            revoke_reason = COALESCE(revoke_reason, 'user_sign_out')
      WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
}

export async function switchSessionTrip(
  pool: Pool,
  config: AuthConfig,
  session: AuthenticatedSession,
  targetTripId: string,
  userAgent: string | null,
): Promise<SessionGrant> {
  if (targetTripId === session.tripId) {
    throw new SessionUnavailableError("This trip is already selected.");
  }

  return withTransaction(pool, async (client) => {
    // Consistent order prevents opposite-direction switches and member removal
    // from holding a session row while waiting for a trip/member lock.
    const trips = [...new Set([session.tripId,targetTripId])].sort();
    for (const tripId of trips) await lockAuthTrip(client,tripId);
    const authenticationCeiling = await readCurrentSessionCeiling(client, session);

    const target = await client.query<{
      member_id: string;
      role: SessionGrant["role"];
    }>(
      `SELECT tm.id AS member_id, tm.role
         FROM trip_members tm
        WHERE tm.trip_id = $1 AND tm.user_id = $2 AND tm.status = 'active'
        FOR UPDATE OF tm`,
      [targetTripId, session.userId],
    );
    const targetMembership = target.rows[0];
    if (!targetMembership) {
      throw new SessionUnavailableError("That trip is unavailable to this Google identity.");
    }

    const grant = await insertSession(client, config, {
      tripId: targetTripId,
      memberId: targetMembership.member_id,
      userId: session.userId,
      role: targetMembership.role,
      absoluteExpiresAt: authenticationCeiling,
      userAgent,
    });
    await client.query(
      `UPDATE auth_sessions
          SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = 'trip_switch'
        WHERE id = $1`,
      [session.sessionId],
    );
    await client.query(
      `INSERT INTO audit_events (
         trip_id, id, actor_member_id, entity_type, entity_id, action, metadata
       ) VALUES
         ($1,$2,$3,'auth_session',$4,'trip_switched_out',$5::jsonb),
         ($6,$7,$8,'auth_session',$9,'trip_switched_in',$10::jsonb)`,
      [
        session.tripId, randomUUID(), session.memberId, session.sessionId,
        JSON.stringify({ targetTripId }),
        targetTripId, randomUUID(), targetMembership.member_id, grant.sessionId,
        JSON.stringify({ previousTripId: session.tripId }),
      ],
    );
    return grant;
  });
}

export async function revokeMemberSessions(
  pool: Pool,
  input: { tripId: string; memberId: string; actorMemberId: string; actorUserId?: string },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await lockAuthTrip(client,input.tripId);
    const actor = await client.query<{ role: string; status: string }>(
      `SELECT role, status FROM trip_members WHERE trip_id = $1 AND id = $2 AND ($3::uuid IS NULL OR user_id=$3) FOR UPDATE`,
      [input.tripId, input.actorMemberId,input.actorUserId ?? null],
    );
    if (actor.rows[0]?.role !== "owner" || actor.rows[0].status !== "active") {
      throw new SessionUnavailableError("Owner authorization is required.");
    }
    await client.query(
      `UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
              revoke_reason = COALESCE(revoke_reason, 'owner_revoked')
        WHERE trip_id = $1 AND member_id = $2`,
      [input.tripId, input.memberId],
    );
    await client.query(
      `INSERT INTO audit_events (
         trip_id, id, actor_member_id, entity_type, entity_id, action
       ) VALUES ($1, $2, $3, 'trip_member', $4, 'sessions_revoked')`,
      [input.tripId, randomUUID(), input.actorMemberId, input.memberId],
    );
  });
}

export async function unbindMemberIdentity(
  pool: Pool,
  input: { tripId: string; memberId: string; actorMemberId: string; actorUserId?: string },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await lockAuthTrip(client,input.tripId);
    const actor = await client.query<{ role: string; status: string }>(
      `SELECT role, status FROM trip_members WHERE trip_id = $1 AND id = $2 AND ($3::uuid IS NULL OR user_id=$3) FOR UPDATE`,
      [input.tripId, input.actorMemberId,input.actorUserId ?? null],
    );
    if (actor.rows[0]?.role !== "owner" || actor.rows[0].status !== "active") {
      throw new SessionUnavailableError("Owner authorization is required.");
    }
    const target = await client.query<{ user_id: string | null; role: string }>(
      `SELECT user_id, role FROM trip_members
        WHERE trip_id = $1 AND id = $2
        FOR UPDATE`,
      [input.tripId, input.memberId],
    );
    if (!target.rows[0]) {
      throw new SessionUnavailableError("Member identity was not found.");
    }
    if (target.rows[0].role === "owner") {
      throw new SessionUnavailableError(
        "Use the owner bootstrap recovery flow to replace the owner identity.",
      );
    }
    await client.query(
      `UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
              revoke_reason = COALESCE(revoke_reason, 'identity_unbound')
        WHERE trip_id = $1 AND member_id = $2`,
      [input.tripId, input.memberId],
    );
    await disconnectMemberCalendarForIdentityChange(client, {
      tripId: input.tripId,
      memberId: input.memberId,
      actorMemberId: input.actorMemberId,
      cause: "identity_unbound",
    });
    await closeMemberAiConversationForIdentityChange(client, {
      tripId: input.tripId,
      memberId: input.memberId,
      actorMemberId: input.actorMemberId,
      cause: "identity_unbound",
    });
    // A key grant belongs to the person, not the slot: whoever claims the slot next starts without one.
    await revokeAiKeyGrants(client, {
      tripId: input.tripId, memberId: input.memberId, actorMemberId: input.actorMemberId,
      cause: "identity_unbound", roles: "member",
    });
    await client.query(
      `UPDATE trip_members
          SET user_id = NULL, status = 'invited', current_revision = current_revision + 1
        WHERE trip_id = $1 AND id = $2`,
      [input.tripId, input.memberId],
    );
    await client.query(
      `INSERT INTO audit_events (
         trip_id, id, actor_member_id, entity_type, entity_id, action
       ) VALUES ($1, $2, $3, 'trip_member', $4, 'identity_unbound')`,
      [input.tripId, randomUUID(), input.actorMemberId, input.memberId],
    );
  });
}

export async function listSessions(
  pool: Pool,
  userId: string,
  currentSessionId: string,
): Promise<SessionDevice[]> {
  const result = await pool.query<{
    id: string;
    device_label: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
  }>(
    `SELECT id, device_label, created_at, last_seen_at, expires_at
       FROM auth_sessions
      WHERE user_id = $1 AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY last_seen_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    deviceLabel: row.device_label,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    current: row.id === currentSessionId,
  }));
}

/**
 * A fixed-window limit per scope and key, stored only as a keyed hash of the key. A refused attempt
 * is also counted for the operator's admin page (JOB-069), with `userId` when the attempt belongs
 * to an account.
 */
export async function enforceRateLimit(
  pool: Pool,
  config: AuthConfig,
  input: { scope: string; key: string; maximum: number; windowSeconds: number; userId?: string },
): Promise<void> {
  const keyHash = hashRateLimitKey(config.authSecret, input.scope, input.key);
  const result = await pool.query<{ attempt_count: number; retry_after: number }>(
    `INSERT INTO auth_rate_limits (scope, key_hash, window_started_at, attempt_count)
     VALUES ($1, $2, CURRENT_TIMESTAMP, 1)
     ON CONFLICT (scope, key_hash) DO UPDATE
       SET window_started_at = CASE
             WHEN auth_rate_limits.window_started_at
                    <= CURRENT_TIMESTAMP - make_interval(secs => $3)
             THEN CURRENT_TIMESTAMP ELSE auth_rate_limits.window_started_at END,
           attempt_count = CASE
             WHEN auth_rate_limits.window_started_at
                    <= CURRENT_TIMESTAMP - make_interval(secs => $3)
             THEN 1 ELSE auth_rate_limits.attempt_count + 1 END
     RETURNING attempt_count,
       GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
         window_started_at + make_interval(secs => $3) - CURRENT_TIMESTAMP
       )))::integer) AS retry_after`,
    [input.scope, keyHash, input.windowSeconds],
  );
  const row = result.rows[0];
  if (row && row.attempt_count > input.maximum) {
    await recordRefusal(pool, input.scope, input.userId ?? null);
    throw new RateLimitError(row.retry_after);
  }
}

/**
 * Refuse a Google identity whose account the operator suspended (JOB-069), before any session or
 * onboarding grant is issued for it. A new identity has no account yet and passes.
 */
export async function assertIdentityNotSuspended(pool: Pool, identity: { issuer: string; subject: string }): Promise<void> {
  const result = await pool.query<{ suspended: boolean }>(
    `SELECT (to_jsonb(app_user) ->> 'suspended_at') IS NOT NULL AS suspended
       FROM oidc_identities identity JOIN app_users app_user ON app_user.id = identity.user_id
      WHERE identity.issuer = $1 AND identity.subject = $2`,
    [identity.issuer, identity.subject],
  );
  if (result.rows[0]?.suspended) throw new AccountSuspendedError();
}
