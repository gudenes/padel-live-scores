import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const id = "00000000-0000-4000-8000-000000000001";
async function setup() {
  const db = new PGlite();
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE users(id uuid primary key);CREATE TABLE profiles(id uuid primary key,notification_mute_until text);CREATE TABLE feature_flags(key text primary key,enabled boolean);CREATE TABLE play_access(user_id uuid primary key);INSERT INTO users VALUES('${id}');INSERT INTO profiles VALUES('${id}',null);INSERT INTO feature_flags VALUES('play_enabled',true);INSERT INTO play_access VALUES('${id}');`
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261007110000_play_reminders.sql",
      "utf8"
    )
  );
  await db.exec(
    `INSERT INTO play_reminder_preferences(user_id,email_enabled,push_enabled,timezone) VALUES('${id}',true,true,'Europe/Madrid')`
  );
  return db;
}
const claim = async (db, channel = "email", payload = { a: 1 }) =>
  (
    await db.query(
      `select play_claim_reminder($1,$2,(now() AT TIME ZONE 'Europe/Madrid')::date,$3) r`,
      [id, channel, payload]
    )
  ).rows[0].r;
test("one claim per channel/day, lease prevents overlap, email retry keeps original payload", async () => {
  const db = await setup();
  try {
    const first = await claim(db);
    assert.ok(first.id);
    assert.equal(await claim(db), null);
    await db.exec(
      "update play_reminder_deliveries set claimed_at=now()-interval '6 minutes'"
    );
    const retry = await claim(db, "email", { changed: true });
    assert.equal(retry.id, first.id);
    assert.deepEqual(retry.payload, { a: 1 });
    assert.equal(retry.attempts, 2);
    await db.exec(
      "update play_reminder_deliveries set state='sent',sent_at=now()"
    );
    assert.equal(await claim(db), null);
    const push = await claim(db, "push");
    assert.ok(push.id);
    await db.exec(
      "update play_reminder_deliveries set claimed_at=now()-interval '6 minutes'"
    );
    assert.equal(await claim(db, "push"), null);
  } finally {
    await db.close();
  }
});
test("access, consent, global flag and mute independently block delivery", async () => {
  const db = await setup();
  try {
    for (const [off, on] of [
      [
        "update feature_flags set enabled=false",
        "update feature_flags set enabled=true",
      ],
      ["delete from play_access", `insert into play_access values('${id}')`],
      [
        "update play_reminder_preferences set email_enabled=false",
        "update play_reminder_preferences set email_enabled=true",
      ],
      [
        "update profiles set notification_mute_until='forever'",
        "update profiles set notification_mute_until=null",
      ],
      [
        "update profiles set notification_mute_until=(now()+interval '1 hour')::text",
        "update profiles set notification_mute_until=null",
      ],
    ]) {
      await db.exec(off);
      assert.equal(await claim(db), null);
      await db.exec(on);
    }
  } finally {
    await db.close();
  }
});
test("retry expiry, rolling cap, local day and invalid timezone are enforced", async () => {
  const db = await setup();
  try {
    const first = await claim(db);
    await db.exec(
      "update play_reminder_deliveries set claimed_at=now()-interval '10 minutes',created_at=now()-interval '3 hours'"
    );
    assert.equal(await claim(db), null);
    await db.exec(
      "update play_reminder_deliveries set local_day=local_day-1,state='sent',sent_at=now()"
    );
    assert.equal(await claim(db), null);
    await db.exec("delete from play_reminder_deliveries");
    await db.exec("update play_reminder_preferences set timezone='Mars/City'");
    assert.equal(await claim(db), null);
    await db.exec(
      "update play_reminder_preferences set timezone='Europe/Madrid'"
    );
    assert.equal(
      (
        await db.query(
          `select play_claim_reminder($1,'email',(now() AT TIME ZONE 'Europe/Madrid')::date-1,'{}') r`,
          [id]
        )
      ).rows[0].r,
      null
    );
    assert.ok(first.id);
  } finally {
    await db.close();
  }
});
