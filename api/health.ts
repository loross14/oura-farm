export default {
  fetch() {
    return new Response(
      JSON.stringify({
        ok: true,
        service: 'oura-signal-lab',
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
        },
      },
    )
  },
}
