import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session (IMPORTANT: must call getUser, not getSession)
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/auth') ||
    pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password');
  const isPublicRoute = pathname === '/' || isAuthRoute;

  // Helper: build a redirect using request.nextUrl (correctly resolves public domain behind proxy)
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path.split('?')[0];
    url.search = path.includes('?') ? path.split('?')[1] : '';
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach(cookie =>
      res.cookies.set(cookie.name, cookie.value),
    );
    return res;
  };

  // Domain restriction: only @ammoc.org.br emails allowed
  if (user && !user.email?.endsWith('@ammoc.org.br')) {
    await supabase.auth.signOut();
    return redirectTo('/login?error=acesso_restrito');
  }

  if (!user && !isPublicRoute) {
    return redirectTo('/login');
  }

  if (user && isAuthRoute) {
    return redirectTo('/dashboard');
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
