// Sanity check: parse Buenos Aires P1 2026's real schedule_notes
//   npx tsx scripts/sanity-buenos-aires-schedule.ts
import { parseScheduleNotes } from '../src/parsers/fip-schedule-notes.js';

const notes = `QUALIFYING
Men: 10 – 11 May
Q1 Sun 10 Start time: 9.00 am
Q2 Mon 11 Start time: 9.00 am
Women: 11 – 12 May
Q1 Mon 11 Start time: 9.00 am
Q2 Tue 12 Start time: 10.00 am
MAIN DRAW : 1st ROUND
Men: 12 May
Start time: 10.00 am
Women: 12 – 13 May
Tue 12 Start time: 2.00 pm
Wed 13 Start time: 10.00 am
MAIN DRAW : 2nd ROUND
Men: 13 May
Start time: 10.00 am
MAIN DRAW : ROUND OF 16
14 May
Start time: 10.00 am
MAIN DRAW : QUARTER-FINALS
15 May
Start time: 9.00 am
MAIN DRAW : SEMI-FINALS
16 May
Start time: 1.00 pm
MAIN DRAW : FINALS
17 May
Start time: 2.00 pm`;

console.log('WITHOUT level (current prod):');
console.log(parseScheduleNotes(notes, '2026-05-10', '2026-05-17'));

console.log('\nWITH level=p1 (after fix):');
console.log(parseScheduleNotes(notes, '2026-05-10', '2026-05-17', { level: 'p1' }));
