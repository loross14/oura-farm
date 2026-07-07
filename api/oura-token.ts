declare const process: {
  env: Record<string, string | undefined>
}

type TokenResponse = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return json(405, { error: 'method_not_allowed' })
    }

    const clientId = process.env.OURA_CLIENT_ID
    const clientSecret = process.env.OURA_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return json(500, { error: 'oura_oauth_not_configured' })
    }

    let body: { code?: string; redirectUri?: string }

    try {
      body = (await request.json()) as { code?: string; redirectUri?: string }
    } catch {
      return json(400, { error: 'invalid_json' })
    }

    if (!body.code || !body.redirectUri) {
      return json(400, { error: 'missing_code_or_redirect_uri' })
    }

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: body.code,
      redirect_uri: body.redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    })

    const response = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })

    const payload = (await response.json().catch(() => ({}))) as TokenResponse

    if (!response.ok) {
      return json(response.status, {
        error: 'oura_token_exchange_failed',
        detail: payload,
      })
    }

    return json(200, {
      access_token: payload.access_token,
      expires_in: payload.expires_in,
      scope: payload.scope,
      token_type: payload.token_type,
    })
  },
}
