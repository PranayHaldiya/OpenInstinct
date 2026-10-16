import { del, get, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { maximumBrowserImageBytes } from "@shared/browser/artifact";
import { env } from "@shared/environment";
import { browserImageContents, db } from "@db";

// Captured browser image bytes live in Vercel Blob when a store is configured
// and in Postgres otherwise, as on Maritime VMs, which have no Blob store.
function blobConfigured() {
  return Boolean(env.BLOB_STORE_ID ?? env.BLOB_READ_WRITE_TOKEN);
}

export async function storeBrowserImageContent(
  input: {
    readonly artifactId: string;
    readonly bytes: Uint8Array;
    readonly contentHash: string;
    readonly mediaType: string;
    readonly storagePathname: string;
  },
  signal?: AbortSignal
) {
  if (blobConfigured()) {
    await put(input.storagePathname, Buffer.from(input.bytes), {
      access: "private",
      abortSignal: signal,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 30 * 24 * 60 * 60,
      contentType: input.mediaType,
      maximumSizeInBytes: maximumBrowserImageBytes,
    });
    return;
  }
  const content = Buffer.from(input.bytes);
  await db
    .insert(browserImageContents)
    .values({
      artifactId: input.artifactId,
      content,
      contentHash: input.contentHash,
      storagePathname: input.storagePathname,
    })
    .onConflictDoUpdate({
      target: browserImageContents.storagePathname,
      set: { content, contentHash: input.contentHash },
    });
}

export async function deleteBrowserImageContent(storagePathname: string) {
  if (blobConfigured()) {
    await del(storagePathname);
    return;
  }
  await db
    .delete(browserImageContents)
    .where(eq(browserImageContents.storagePathname, storagePathname));
}

interface StoredImage {
  readonly byteSize: number;
  readonly mediaType: string;
  readonly storagePathname: string;
}

/**
 * Opens stored image bytes for an HTTP response. An `ifNoneMatch` that still
 * matches yields a 304 without reading the bytes. Undefined when the bytes
 * are missing or don't match the artifact's manifest.
 */
export async function openBrowserImageContent(
  image: StoredImage,
  options: { readonly ifNoneMatch?: string; readonly signal?: AbortSignal }
) {
  if (blobConfigured()) {
    const result = await get(image.storagePathname, {
      access: "private",
      abortSignal: options.signal,
      ifNoneMatch: options.ifNoneMatch,
    });
    if (!result) return undefined;
    if (result.statusCode === 304) {
      return { etag: result.blob.etag, status: 304 as const };
    }
    if (
      result.blob.size !== image.byteSize ||
      result.blob.contentType !== image.mediaType
    ) {
      return undefined;
    }
    return {
      body: result.stream,
      etag: result.blob.etag,
      status: 200 as const,
    };
  }
  const [stored] = await db
    .select({ contentHash: browserImageContents.contentHash })
    .from(browserImageContents)
    .where(eq(browserImageContents.storagePathname, image.storagePathname))
    .limit(1);
  if (!stored) return undefined;
  const etag = `"${stored.contentHash}"`;
  if (options.ifNoneMatch === etag) return { etag, status: 304 as const };
  const bytes = await readPostgresContent(image);
  if (!bytes) return undefined;
  return { body: new Response(bytes).body, etag, status: 200 as const };
}

/** Reads stored image bytes whole, or undefined when missing or mismatched. */
export async function readBrowserImageContent(
  image: StoredImage,
  signal?: AbortSignal
) {
  if (!blobConfigured()) return readPostgresContent(image);
  const result = await get(image.storagePathname, {
    access: "private",
    abortSignal: signal,
  });
  if (result?.statusCode !== 200) return undefined;
  if (
    result.blob.size !== image.byteSize ||
    result.blob.contentType !== image.mediaType
  ) {
    return undefined;
  }
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    /* oxlint-disable eslint/no-await-in-loop -- Blob response chunks form an ordered stream. */
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBrowserImageBytes) return undefined;
      chunks.push(value);
    }
    /* oxlint-enable eslint/no-await-in-loop */
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readPostgresContent(image: StoredImage) {
  const [stored] = await db
    .select({ content: browserImageContents.content })
    .from(browserImageContents)
    .where(eq(browserImageContents.storagePathname, image.storagePathname))
    .limit(1);
  if (!stored || stored.content.byteLength !== image.byteSize) return undefined;
  return new Uint8Array(stored.content);
}
