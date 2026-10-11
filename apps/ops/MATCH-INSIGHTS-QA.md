# Match report release · 11 October 2026

The approved local match-insights prototype is integrated into the saved admin report for canonical and private scouting sessions. Production ratings use the existing selected methodology. No scoring records or public app screens are changed.

## Visual review

Compared the production components inside the actual admin shell against the approved prototype: lime/coral team identity, set-separated momentum, loser-only tie-break superscript, individual solid/dotted impact lines, court avatars with white backgrounds, shorter curved direction arrows with inline percentages, and vertically centered court.

Verified light/dark themes, set switching, serving/returning filters, and responsive layout without horizontal overflow. Temporary local validation route and its match fixture were removed before release.

## Functional checks

- TypeScript and production webpack build pass.
- 32 targeted tests pass: report permissions/context, private/public source separation, scoped direction counts, score corrections, calculation consistency, report loading/refresh/exports and navigation.
- Sanz full-match serving: 81 rallies and 161 identifiable directions. Returning: 87 rallies and 202 identifiable directions. These partition the original 168 rallies / 363 known directions.
- Unknown direction/server data stays unknown; final and same-team touches do not create measured trajectories.
- Existing JSON and CSV exports retained; historical methodology/report controls remain under Reports.
- Official metadata failure does not prevent viewing saved scouting. Official PBP remains separate from manually scouted points.

## Limitations

Court positions are illustrative. Cross-court/down-the-line is inferred from consecutive hitters and recorded positional orders; no measured ball coordinates or landing zones are claimed. Incoming exchanges are a proxy for reception, not proof of tactical intent. Partial scouting and optional official metadata gaps are labeled.
