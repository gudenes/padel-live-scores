# Hosted match videos (R2)

Video storage and analysis are separate. This release uploads MP4/WebM bytes directly from the browser to a **private** Cloudflare R2 bucket. The laptop still runs Lab Vision. No cloud GPU job is started. R2 does not transcode videos; use browser-playable H.264/AAC MP4 (faststart preferred) or supported WebM. Existing audio is preserved.

## User flow

1. Open the match report → Video review → Add video. Complete the frame, calibration and identity steps as usual, or choose an already prepared MP4 in Video setup.
2. Select **Upload to Cloudflare** in Online video. The original broadcast offset is saved with the file.
3. Progress appears while 64 MiB parts upload. Pause stops the current part. Resume uses server-listed completed parts. After reload, select the same file in the same browser to recover its upload identifier. Keep the tab open during transfer.
4. Only after all parts and total byte count are verified is the video made available to authenticated report viewers. On another device it loads automatically. Playback links expire after 24 hours; reload obtains a fresh one.
5. Local file playback takes precedence while a file is selected. Replacing the hosted video does not remove the previous R2 object. Retention/deletion is intentionally not automated yet.

## Server configuration (never NEXT_PUBLIC)

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_VIDEO_BUCKET=padel-labs-match-videos`

Use Object Read & Write credentials scoped only to this bucket. Keep public access disabled. Apply `supabase/migrations/20261109180000_match_video_uploads.sql` before enabling. Browser database access is revoked; routes check authentication, match identity and operator ownership. Uploads are operator-only in this initial release. Signed part URLs expire after one hour; playback URLs after 24 hours. Treat both as bearer links.

Bucket CORS:

```json
[{"AllowedOrigins":["https://admin.padelnachos.com","http://localhost:3006","http://localhost:3007"],"AllowedMethods":["GET","HEAD","PUT"],"AllowedHeaders":["Content-Type","Range"],"ExposeHeaders":["ETag","Content-Length","Content-Range","Accept-Ranges"],"MaxAgeSeconds":3600}]
```

Retain R2's default incomplete multipart cleanup (7 days). An expired abandoned upload needs a new upload ID. Limits: 20 GiB/file, 24h video duration; 10 start/resume initializations/hour/operator, 120 API operations/minute/operator. Never proxy file bytes through Next/Railway. No public bucket URL or credential is sent to the browser.

## Validation / activation

Unit tests cover file validation, part ranges and exact completion, plus authentication, origin, owner and retry guards. Production build checks TS integration. Before release, test direct PUT + range playback using a small video and test pause/resume with >64 MiB. Storage configuration is a deployment prerequisite; do not describe uploads as live until this test passes.

Validated 2026-11-09: private R2 multipart object (76,173,065 bytes), persisted-part listing, CORS and 206 byte-range reads. Authenticated browser uploaded opening-sample.mp4 to 100%. Test media is detached from the match after verification.
