# raw_payloads cost reclaim — runbook (Pass 1)

One-time rollout for the retention + dedup change. Re-runnable safely.

## Preconditions
- Migration `20260529000001_padelgod_raw_payload_latest.sql` applied.
- Dedup + prune worker code deployed to Railway.

## 0. Baseline audit
```bash
cd "/Volumes/Crucial/Android Studio" && node /tmp/sb-cost-audit.mjs | head -20
```
Record `raw_payloads` total size and the schema totals.

## 1. Confirm dedup is live
After deploy, watch Railway logs / DB: the daily `raw_payloads` insert rate
should drop ~93% within a day. (Dedup defaults on: `RAW_PAYLOAD_DEDUP_ENABLED`
unset or != "false".)

## 2. Prune dry-run
Set Railway env `ENABLE_RAW_PAYLOADS_PRUNE=true`, keep
`RAW_PAYLOADS_PRUNE_DRY_RUN=true`. After the 03:00 UTC run, confirm the log line
`raw-payloads-prune [dry-run]: rows older than cutoff` reports a `candidateCount`
in the expected range (rows with `captured_at` older than 14 days — on first run
~1.5M).

## 3. Prune live
Flip `RAW_PAYLOADS_PRUNE_DRY_RUN=false`. The next 03:00 UTC run batch-deletes the
backlog (~150 batches at 10k). Confirm `rowsDeleted`, that `abortedEarly` is false
(no mid-run error), and that `hitMaxBatches` is false. (If `hitMaxBatches` is true,
the run stopped at the batch cap — more rows may remain; it will continue clearing
on subsequent days, or raise `maxBatches` to finish in one run.)

## 4. One-time VACUUM FULL (returns disk)
Plain DELETE does not shrink the on-disk file. After the backlog is deleted, run
once in a low-activity window (brief ACCESS EXCLUSIVE lock; safe because
raw_payloads is write-only by background workers and never read by the app):

```bash
cd "/Volumes/Crucial/Android Studio" && node -e "
const pg=require('pg');const fs=require('fs');
const u=fs.readFileSync('/Users/GuDenes/Projects/padel-live-scores/.env.local','utf8').split('\n').find(l=>l.startsWith('DATABASE_URL=')).slice(13).replace(/^[\"']|[\"']\$/g,'');
const c=new pg.Client({connectionString:u,ssl:{rejectUnauthorized:false}});
c.connect()
 .then(()=>{console.log('VACUUM FULL starting...');return c.query('VACUUM FULL padelgod.raw_payloads');})
 .then(()=>c.query('ANALYZE padelgod.raw_payloads'))
 .then(()=>{console.log('done');return c.end();})
 .catch(e=>{console.error(e.message);process.exit(1);});
"
```
`VACUUM FULL` cannot run inside a transaction — `client.query` runs it directly, which is correct.

## 5. Verify
```bash
cd "/Volumes/Crucial/Android Studio" && node /tmp/sb-cost-audit.mjs | head -20
```
Expect `padelgod.raw_payloads` down to ~2–3 GB and the schema total well under
the 24 GB baseline.

## Rollback
- Disable dedup: set `RAW_PAYLOAD_DEDUP_ENABLED=false` (reverts to storing every body).
- Disable prune: set `ENABLE_RAW_PAYLOADS_PRUNE=false`.
Deleted rows are not recoverable, but they are write-only debug artifacts with no
consumer — there is nothing to restore.
