import { type NextRequest, NextResponse } from 'next/server';

const BACKEND = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1:8080'
).replace(/\/$/, '');

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid request body' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/api/v1/beta/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ success: false, error: 'service unavailable' }, { status: 502 });
  }

  const json = await upstream.json().catch(() => ({}));
  return NextResponse.json(json, { status: upstream.status });
}
