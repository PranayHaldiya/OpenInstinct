import { NextResponse, type NextRequest } from "next/server";
import { getAuthSession } from "@db/services/auth/session";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/sign-in" ||
    // The contact route verifies its signed URL; Linq downloads without cookies.
    pathname === "/contacts/openinstinct.vcf" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/eve/v1/health" ||
    // The Telegram channel verifies Telegram's webhook secret header itself.
    pathname === "/eve/v1/telegram" ||
    pathname.startsWith("/internal/scheduled-run/") ||
    // Hub routes verify Telegram's secret or a per-user hub token themselves.
    pathname.startsWith("/eve/v1/hub/") ||
    // Maritime polls the schedule list to know when to wake this VM.
    pathname === "/schedules" ||
    pathname === "/eve/v1/dev/schedules/dynamic"
  ) {
    return NextResponse.next();
  }

  if (await getAuthSession(request.headers)) return NextResponse.next();

  // A cloned NextURL keeps the base path when the app runs under a prefix.
  const signInUrl = request.nextUrl.clone();
  signInUrl.pathname = "/sign-in";
  signInUrl.search = "";
  signInUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|fonts|favicon.ico|icon\\.svg$|apple-icon\\.png$|opengraph-image\\.png$).*)",
  ],
};
