import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@db/services/auth";
import { withBasePath } from "@shared/environment/public/env";

async function loadHandlers() {
  return toNextJsHandler(await getAuth());
}

let handlersPromise: ReturnType<typeof loadHandlers> | undefined;

function getHandlers() {
  handlersPromise ??= loadHandlersWithRetry();
  return handlersPromise;
}

async function loadHandlersWithRetry() {
  try {
    return await loadHandlers();
  } catch (error) {
    handlersPromise = undefined;
    throw error;
  }
}

export async function GET(request: Request) {
  return (await getHandlers()).GET(publicRequest(request));
}

export async function POST(request: Request) {
  return (await getHandlers()).POST(publicRequest(request));
}

// Next.js strips its base path from route handler URLs, but better-auth
// routes by its public base URL, which keeps a prefix such as /a/<agentId>.
function publicRequest(request: Request) {
  const url = new URL(request.url);
  const path = withBasePath(url.pathname);
  if (path === url.pathname) return request;
  return new Request(new URL(`${path}${url.search}`, url), request);
}
