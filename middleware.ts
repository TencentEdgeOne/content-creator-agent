import { NextRequest, NextResponse } from 'next/server';

const AGENT_PATHS = ['/outline', '/create', '/create-lite', '/refine', '/suggest-keywords', '/stop', '/research', '/optimize'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!AGENT_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  if (request.headers.get('makers-conversation-id')) {
    return NextResponse.next();
  }

  const newHeaders = new Headers(request.headers);
  newHeaders.set('makers-conversation-id', crypto.randomUUID());

  return NextResponse.next({ request: { headers: newHeaders } });
}

export const config = {
  matcher: ['/outline', '/create', '/create-lite', '/refine', '/suggest-keywords', '/stop', '/research', '/optimize'],
};
