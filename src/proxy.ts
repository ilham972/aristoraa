import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// `/manifest.json` must be publicly fetchable: Chrome requests the PWA
// manifest without auth cookies, so if Clerk protects it the request is
// redirected to /sign-in, Chrome can't parse the HTML as JSON ("Manifest
// Line 1, column 1, Syntax error"), and the app becomes non-installable.
// (The matcher excludes `.js`/`.png` but not `.json`, so this is needed.)
const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/manifest.json']);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.redirect(new URL('/sign-in', request.url));
    }
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
