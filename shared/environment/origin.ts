import { env } from "@shared/environment";

export function applicationOrigin() {
  if (env.BETTER_AUTH_URL) return new URL(env.BETTER_AUTH_URL).origin;

  if (env.VERCEL_ENV) {
    const hostname =
      env.VERCEL_PROJECT_PRODUCTION_URL ??
      env.VERCEL_URL ??
      env.VERCEL_BRANCH_URL;
    if (hostname) return new URL(`https://${hostname}`).origin;
  }

  throw new Error(
    "The application origin is unavailable. Set BETTER_AUTH_URL outside Vercel."
  );
}

/**
 * The app's public base URL without a trailing slash. Unlike the origin it
 * keeps a path prefix, such as `/a/<agentId>` on a Maritime VM.
 */
export function applicationBaseUrl() {
  if (!env.BETTER_AUTH_URL) return applicationOrigin();
  const url = new URL(env.BETTER_AUTH_URL);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** An absolute URL for a root-relative app path, under any path prefix. */
export function applicationUrl(path: string) {
  return new URL(`${applicationBaseUrl()}${path}`);
}

export function betterAuthBaseURL() {
  const fallback = applicationOrigin();
  // A base URL with a path is better-auth's whole auth route base.
  if (!env.VERCEL_ENV) return applicationUrl("/api/auth").href;

  const allowedHosts = new Set(
    [
      "*.vercel.app",
      new URL(fallback).host,
      env.VERCEL_BRANCH_URL,
      env.VERCEL_PROJECT_PRODUCTION_URL,
      env.VERCEL_URL,
    ].filter((hostname): hostname is string => hostname !== undefined)
  );

  return {
    allowedHosts: [...allowedHosts],
    fallback,
    protocol: "https" as const,
  };
}
