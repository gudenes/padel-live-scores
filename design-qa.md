# Matches sidebar design QA

Selected target: second generated image, exec-d3311bf4-055b-4ba7-9d69-b2639847d9d4.png.
Implementation: local /scouting, Watchlist active. Desktop evidence: /Volumes/Crucial/Apps/codex/home/scouter-tmp/watchlist-rail-desktop.png. Final normal-viewport evidence: /Volumes/Crucial/Apps/codex/home/scouter-tmp/watchlist-rail-preview.png.

Scope: apply the selected navigation/filter structure to the existing production match components. Real roster, scores, metadata and existing approved button variants replace illustrative mock data. Existing match cards intentionally remain taller because they retain scouting metadata and access actions. No change to match scoring or permissions.

Compared reference and desktop screenshot together. Sidebar, content separation, watched-player section, two-column results and compact filters implemented. Initial rail buttons were centered because a CSS module selector targeted a global class incorrectly; fixed selectors and recaptured. Existing saved-player avatar now resolves from the visible match roster. Native view navigation is text-led rather than the mock's decorative icons; optional later polish.

Browser checks: scouting dropdown -> In progress produced one real matching watchlist result; clearing chip restored ten matches. Manage players search returned Andrea Ustero Prieto. No test bookmark was added or removed. Mobile viewport check showed stacked rail and single-column cards without horizontal overflow (document width equals viewport width). Viewport reset after testing.

final result: passed
