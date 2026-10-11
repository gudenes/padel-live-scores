type SubItem = { href: string; label: string }
type Item = { href: string; label: string; icon: string; pill?: 'live'; cnt?: number; children?: SubItem[] }
type Group = { label?: string; items: Item[] }

export const GROUPS: Group[] = [
  { items: [
    { href: '/today', label: 'Today', icon: 'today' },
    { href: '/growth', label: 'Growth', icon: 'users' },
    { href: '/odds', label: 'Live Odds', icon: 'odds', pill: 'live', children: [
      { href: '/today', label: 'Overview' },
      { href: '/odds/calibration', label: 'Calibration' },
      { href: '/odds/projections', label: 'Projections' },
      { href: '/odds/methodology', label: 'Methodology' },
    ] },
  ]},
  { label: 'Play · Prediction Market', items: [
    { href: '/play/markets', label: 'Markets', icon: 'list' },
    { href: '/play/templates', label: 'Templates', icon: 'grid' },
    { href: '/play/simulation', label: 'Simulation', icon: 'play' },
  ]},
  { label: 'Tournament Ops', items: [
    { href: '/tournament-explorer', label: 'Tournament Explorer', icon: 'grid' },
    { href: '/scouting', label: 'Matches', icon: 'list' },
    { href: '/team-access', label: 'Team Access', icon: 'users' },
    { href: '/scouting/methodology', label: 'Scouting Methodology · V1', icon: 'doc' },
    { href: '/entry-lists', label: 'Entry Lists', icon: 'list' },
    { href: '/needs-review', label: 'Needs Review', icon: 'flag' },
    { href: '/simulator', label: 'Simulator', icon: 'play' },
  ]},
  { label: 'Catalogs', items: [
    { href: '/players', label: 'Players', icon: 'users' },
    { href: '/teams', label: 'Teams', icon: 'users' },
    { href: '/player-suggestions', label: 'Suggestions', icon: 'flag' },
    { href: '/player-claims', label: 'Claims', icon: 'flag' },
    { href: '/brands', label: 'Brands', icon: 'tag' },
    { href: '/streams', label: 'Streams', icon: 'video' },
    { href: '/yt-channels', label: 'YouTube Channels', icon: 'yt' },
    { href: '/partners', label: 'Partners', icon: 'share' },
    { href: '/ads', label: 'Ad Banners', icon: 'tag' },
  ]},
  { label: 'Content', items: [
    { href: '/announcements', label: 'Announcements', icon: 'bell' },
    { href: '/managed-events', label: 'Managed Events', icon: 'tag' },
    { href: '/news', label: 'News', icon: 'doc' },
    { href: '/news-sources', label: 'News Sources', icon: 'list' },
    { href: '/highlights', label: 'Highlights', icon: 'film' },
    { href: '/team-image', label: 'Team Image', icon: 'film' },
  ]},
  { label: 'System', items: [
    { href: '/system/integration-health', label: 'Integration Health', icon: 'heart' },
    { href: '/system/data-quality', label: 'Data Quality', icon: 'check' },
    { href: '/system/data-readiness', label: 'Data Readiness', icon: 'grid' },
    { href: '/system/padelgod-health', label: 'Padelgod Health', icon: 'server' },
    { href: '/system/shadow-mode', label: 'Shadow Mode', icon: 'eye' },
    { href: '/system/coverage-matrix', label: 'Coverage Matrix', icon: 'matrix' },
    { href: '/system/feature-flags', label: 'Feature Flags', icon: 'toggle' },
    { href: '/system/tier-visibility', label: 'Tier Visibility', icon: 'eye' },
    { href: '/system/betting-integration', label: 'Betting Integration', icon: 'doc' },
    { href: '/system/ocr-health', label: 'OCR Health', icon: 'doc' },
    { href: '/system/seo', label: 'SEO', icon: 'search' },
    { href: '/system/architecture', label: 'Architecture', icon: 'arch' },
    { href: '/system/broadcast', label: 'Broadcast', icon: 'bell' },
    { href: '/system/notifications', label: 'Notifications', icon: 'bell' },
  ]},
]


const tournamentRoutes = new Set(['/tournament-explorer', '/entry-lists', '/needs-review', '/simulator'])
export const tournamentLinks = GROUPS.flatMap(group => group.items).filter(item => tournamentRoutes.has(item.href))
export const workspaceGroups = GROUPS.map(group => ({ ...group, items: group.items.filter(item => !tournamentRoutes.has(item.href) && !['/today', '/scouting'].includes(item.href)) })).filter(group => group.items.length)
export function activeDestination(path: string) {
  return GROUPS.flatMap(group => group.items.flatMap(item => [item.href, ...(item.children?.map(child => child.href) ?? [])])).filter(href => path === href || path.startsWith(href + '/')).sort((a, b) => b.length - a.length)[0]
}
