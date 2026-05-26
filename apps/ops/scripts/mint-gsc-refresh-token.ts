// apps/ops/scripts/mint-gsc-refresh-token.ts
// One-time helper to mint a GSC OAuth refresh token.
// Run: npx tsx apps/ops/scripts/mint-gsc-refresh-token.ts
//
// Requires GSC_OAUTH_CLIENT_ID and GSC_OAUTH_CLIENT_SECRET in env or
// passed as CLI args. Opens the user's browser, captures the redirect
// callback on http://127.0.0.1:8765/, exchanges the auth code, prints
// the refresh token to stdout. Paste it into Vercel as
// GSC_OAUTH_REFRESH_TOKEN.

import * as http from 'node:http'
import { exec } from 'node:child_process'
import { OAuth2Client } from 'google-auth-library'

const PORT = 8765
const REDIRECT_URI = `http://127.0.0.1:${PORT}/`
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

async function main() {
  const clientId = process.env.GSC_OAUTH_CLIENT_ID ?? process.argv[2]
  const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET ?? process.argv[3]
  if (!clientId || !clientSecret) {
    console.error('Usage: GSC_OAUTH_CLIENT_ID=... GSC_OAUTH_CLIENT_SECRET=... npx tsx apps/ops/scripts/mint-gsc-refresh-token.ts')
    console.error('Or pass them as CLI args: npx tsx ... <client_id> <client_secret>')
    process.exit(1)
  }

  const oauth = new OAuth2Client({ clientId, clientSecret, redirectUri: REDIRECT_URI })
  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPE,
  })

  console.log('\nOpening browser to:\n  ' + authUrl + '\n')

  // Cross-platform "open URL in default browser"
  const openCmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32'  ? 'start' : 'xdg-open'
  exec(`${openCmd} "${authUrl}"`)

  const refreshToken = await new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url ?? '/', REDIRECT_URI)
      const code = u.searchParams.get('code')
      const error = u.searchParams.get('error')
      if (error) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('OAuth error: ' + error)
        server.close()
        return reject(new Error(error))
      }
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('Missing code parameter')
        return
      }
      try {
        const { tokens } = await oauth.getToken(code)
        if (!tokens.refresh_token) {
          throw new Error('No refresh_token in response. Did you grant `offline` access and is the OAuth app in Testing mode?')
        }
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<h1>Done</h1><p>Refresh token printed to terminal. You can close this tab.</p>')
        server.close()
        resolve(tokens.refresh_token)
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('Exchange failed: ' + String(e))
        server.close()
        reject(e)
      }
    })
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Waiting for OAuth callback on ${REDIRECT_URI} …`)
    })
  })

  console.log('\n=== GSC_OAUTH_REFRESH_TOKEN ===')
  console.log(refreshToken)
  console.log('================================')
  console.log('\nPaste the value above into Vercel env vars for the padel-ops project.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
