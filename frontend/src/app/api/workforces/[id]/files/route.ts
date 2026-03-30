import { type NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

const BACKEND = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1:8080'
).replace(/\/$/, '');

type Ctx = { params: Promise<{ id: string }> };

const FORWARDED_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'last-modified',
  'content-disposition'
];

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as any)?.accessToken as string | undefined;
  if (!accessToken) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const relPath = req.nextUrl.searchParams.get('path')?.trim();
  if (!relPath) {
    return NextResponse.json({ success: false, error: 'path is required' }, { status: 400 });
  }

  const upstreamUrl = new URL(`${BACKEND}/api/v1/workforces/${id}/files`);
  upstreamUrl.searchParams.set('path', relPath);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: 'no-store'
    });
  } catch {
    return NextResponse.json({ success: false, error: 'upstream unavailable' }, { status: 502 });
  }

  const headers = new Headers();
  for (const key of FORWARDED_HEADERS) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers
  });
}
