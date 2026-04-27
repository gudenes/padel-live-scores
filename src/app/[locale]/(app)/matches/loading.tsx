// /matches itself is a server-side redirect to /matches/{today}, but
// the framework still mounts a loading state for this route while the
// redirect resolves. Without it, BottomNav taps on Scores show ~400ms
// of blank canvas before /matches/[date]/loading.tsx kicks in.
//
// Re-exports the dated loading skeleton so the user gets immediate
// visual feedback continuously through the redirect.

export { default } from './[date]/loading'
