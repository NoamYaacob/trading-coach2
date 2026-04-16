export async function GET() {
  return Response.json({
    ok: true,
    service: "trading-coach-v2",
    timestamp: new Date().toISOString(),
  });
}
