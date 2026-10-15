const userAgent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36 OpenInstinct-jobs";

/** GETs a public URL with a timeout and fails on any non-2xx status. */
export async function fetchPublic(url: string, timeoutMs = 30_000) {
  const response = await fetch(url, {
    headers: { accept: "application/json, text/html", "user-agent": userAgent },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `${String(response.status)} ${response.statusText} for ${url}`
    );
  }
  return response;
}

export async function fetchJson(url: string, timeoutMs?: number) {
  const response = await fetchPublic(url, timeoutMs);
  const body: unknown = await response.json();
  return body;
}
