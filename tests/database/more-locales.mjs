import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createGuestSession, guestDemoTitles } from "../../src/lib/app/guest.ts";
import { localizedCatalog } from "../../src/lib/locale-packs/index.ts";

const added = ["zh-CN", "zh-TW", "es", "pt-BR", "fr", "de", "ru", "id"];

/**
 * More interface languages (JOB-084, D-096): migration 0063 lets trips, destination lookups and feedback
 * diagnostics record the eight added locales and still refuses unknown ones, and a guest's demo trip is
 * written in an added language. Synthetic data only, at migration head.
 */
export async function testMoreLocales(pool, connectionString) {
  const userId = randomUUID();
  await pool.query("INSERT INTO app_users(id,display_name) VALUES($1,'Synthetic polyglot')", [userId]);
  const insertTrip = (locale) => pool.query(`INSERT INTO trips(id,owner_user_id,name,time_zone,default_locale,default_currency,starts_on,ends_on)
    VALUES($1,$2,'Synthetic locale trip','UTC',$3,'EUR','2031-05-01','2031-05-02')`, [randomUUID(), userId, locale]);
  for (const locale of added) await insertTrip(locale);
  await assert.rejects(insertTrip("xx-XX"), (error) => error.code === "23514", "an unknown trip locale is refused");

  const definitions = await pool.query(`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conname IN ('trips_default_locale_check', 'account_ai_lookups_display_locale_check')`);
  assert.equal(definitions.rowCount, 2);
  for (const row of definitions.rows) for (const locale of [...added, "en", "zh-HK", "zh-HK-lihkg", "ja-JP"]) {
    assert.ok(row.definition.includes(`'${locale}'`), `${row.conname} allows ${locale}`);
  }

  const diagnostics = (locale) => JSON.stringify({ page: "today", locale, formFactor: "phone", osFamily: "ios",
    browserFamily: "safari", online: true, breadcrumbs: [{ page: "today", action: "locale_change", at: "2031-05-01T09:00:00Z" }] });
  const valid = async (locale) => (await pool.query("SELECT app_valid_feedback_diagnostics($1::jsonb) AS ok", [diagnostics(locale)])).rows[0].ok;
  for (const locale of added) assert.equal(await valid(locale), true, `feedback diagnostics accept ${locale}`);
  assert.equal(await valid("ja-JP"), true);
  assert.equal(await valid("xx-XX"), false, "feedback diagnostics refuse an unknown locale");

  const config = { authSecret: "synthetic-more-locales-secret-only", tripGraceDays: 2,
    appBaseUrl: new URL("http://localhost:3100"), databaseUrl: connectionString };
  const guest = await createGuestSession(pool, config, { userAgent: "Synthetic guest browser", locale: "es", address: "198.51.100.84" },
    { GUEST_ACTIVE_LIMIT: "1000", GUEST_PER_ADDRESS_LIMIT: "1000" });
  const spanish = localizedCatalog("es", "guestDemo", guestDemoTitles);
  assert.notEqual(spanish.trip, guestDemoTitles.en.trip, "the Spanish pack names the demo trip");
  const trip = (await pool.query("SELECT default_locale, name FROM trips WHERE id=$1", [guest.tripId])).rows[0];
  assert.deepEqual(trip, { default_locale: "es", name: spanish.trip });
  const titles = (await pool.query("SELECT title FROM itinerary_items WHERE trip_id=$1 ORDER BY starts_at", [guest.tripId])).rows.map((row) => row.title);
  assert.deepEqual(titles, spanish.events);
}
