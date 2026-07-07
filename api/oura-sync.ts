const endpoints = [
  'daily_sleep',
  'sleep',
  'daily_readiness',
  'daily_activity',
  'daily_stress',
  'daily_spo2',
  'workout',
] as const

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function isoDayOffset(daysAgo: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'GET') {
      return json(405, { error: 'method_not_allowed' })
    }

    const authorization = request.headers.get('authorization')

    if (!authorization?.toLowerCase().startsWith('bearer ')) {
      return json(401, { error: 'missing_bearer_token' })
    }

    const url = new URL(request.url)
    const startDate = url.searchParams.get('start_date') ?? isoDayOffset(120)
    const endDate = url.searchParams.get('end_date') ?? isoDayOffset(0)
    const selected = url.searchParams.getAll('endpoint')
    const requestedEndpoints = selected.length
      ? endpoints.filter((endpoint) => selected.includes(endpoint))
      : endpoints

    if (!requestedEndpoints.length) {
      return json(400, { error: 'no_supported_endpoints_requested' })
    }

    const results = await Promise.all(
      requestedEndpoints.map(async (endpoint) => {
        const ouraUrl = new URL(
          `https://api.ouraring.com/v2/usercollection/${endpoint}`,
        )
        ouraUrl.searchParams.set('start_date', startDate)
        ouraUrl.searchParams.set('end_date', endDate)

        const response = await fetch(ouraUrl, {
          headers: { Authorization: authorization },
        })

        const payload = await response.json().catch(() => ({}))

        return {
          endpoint,
          ok: response.ok,
          status: response.status,
          payload,
        }
      }),
    )

    return json(200, {
      start_date: startDate,
      end_date: endDate,
      data: Object.fromEntries(
        results
          .filter((result) => result.ok)
          .map((result) => [result.endpoint, result.payload]),
      ),
      errors: results
        .filter((result) => !result.ok)
        .map((result) => ({
          endpoint: result.endpoint,
          status: result.status,
          detail: result.payload,
        })),
    })
  },
}
