// Keep the admin startup hook beside src/app so Next discovers it.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installFipProxy } = await import('../../../shared/fip-http.mjs')
    installFipProxy()
  }
}
