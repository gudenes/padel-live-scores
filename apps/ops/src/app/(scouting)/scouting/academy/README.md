# Scout Academy preview

Authenticated route: `/scouting/academy`. Accessible from the scout launch menu alongside Playground.

The foundation lesson demonstrates the opening rally, then lets the trainee classify 30 complete rallies from the opening 20-minute clip. Player, ending outcome, and shot are compared independently against the saved scouting reference. Practice results remain in browser local storage, scoped to the signed-in user; no production points are written. This is reference agreement, not an assessment certification. First-fault input is demonstrated but not graded.

## Media

Production uses the private `scout-training` storage bucket and `milano-opening-20min.mp4`. Authenticated page requests receive a four-hour signed playback URL. `SCOUT_TRAINING_VIDEO_URL` can override the source. Local preview defaults to `/training-media/milano.mp4`; local media is deliberately ignored by Git. The poster ships with the scout assets.

Local source: `/Volumes/Crucial/dev/training-media/a49ca888-c50a-4097-b767-c32b734b8379/milano-training-opening-20min.mp4`.

Source match: a49ca888-c50a-4097-b767-c32b734b8379. YouTube source dMeQPf-f4eg, excerpt 04:08:10–04:28:10. Reference timestamps are offset by 14890 seconds. The first serve starts at clip 00:07 as confirmed by the user; other cues follow the existing scout. Coaches must review timings and classifications before onboarding release.

Uploaded media: 45,927,545 bytes, full 20-minute duration. The original high-quality file is retained locally.

## Validation

`npx vitest run 'src/app/(scouting)/scouting/academy/__tests__/scoring.test.ts'`

`npx tsc --noEmit`

Manual: start guided rally, Play, verify pause at 00:07, Start rally, First fault, player → outcome → shot → confirm, then Now it's my turn. Check an incorrect answer, retry, next rally, and progress after refresh. Check video decoding in each supported browser; the uploaded training clip uses H.264/AAC at 480p and 30 fps.

The lesson now embeds the actual `/scout-web/panel.html?playground&academy=1` UI. The academy bridge only runs inside an embedded Playground and validates both message origin and parent window. The shared engine stays in memory and rejects server synchronization. Guided cues spotlight the actual Start rally, First fault, player outcome, Volley and Save point buttons; the video overlay explains each step.
