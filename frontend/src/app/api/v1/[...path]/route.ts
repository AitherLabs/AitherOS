import { type NextRequest, NextResponse } from 'next/server';

// Evaluated at request time — no build required when BACKEND_URL changes.
const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:8080';

// Hop-by-hop headers that must not be forwarded.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
]);

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const upstream = `${BACKEND}/api/v1/${path.join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'host') return;       // let fetch set the correct host
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    headers.set(key, value);
  });

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  let res: Response;
  try {
    res = await fetch(upstream, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error duplex is required for streaming request bodies
      duplex: 'half',
    });
  } catch (err) {
    console.error(`[proxy] upstream error ${upstream}:`, err);
    return NextResponse.json({ error: 'upstream unavailable' }, { status: 502 });
  }

  const resHeaders = new Headers();
  res.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    resHeaders.set(key, value);
  });

  return new NextResponse(res.body, {
    status: res.status,
    headers: resHeaders,
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
export async function PUT(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return proxy(req, (await params).path);
}
