// 最もシンプルな Vercel Function
export function GET(request: Request) {
  return new Response(JSON.stringify({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    path: new URL(request.url).pathname 
  }), {
    headers: { "Content-Type": "application/json" },
  });
}

export function POST(request: Request) {
  return GET(request);
}
