import { createHash } from "node:crypto";
import type { AccessScope } from "@shared/identity/access-scope";
import { readBrowserImageContent } from "@db/services/browser-image-content";
import { readReadyBrowserImageArtifact } from "@db/services/browser-images";
import { maximumWorkerCompletionImages } from "@agent/subagents/browser-agent/lib/completion";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "./markdown";

interface LinqImageArtifactFile {
  readonly data: Buffer;
  readonly filename: string;
  readonly mimeType: string;
}

export async function prepareLinqImageArtifactDelivery(
  message: string,
  input: {
    readonly rootSessionId: string;
    readonly scope: AccessScope;
    readonly signal?: AbortSignal;
  }
) {
  const references = extractImageArtifactMarkdownReferences(message);
  if (references.length === 0) {
    return { failedArtifactIds: [], files: [], text: message };
  }

  const selected = references.slice(0, maximumWorkerCompletionImages);
  const loaded = await Promise.all(
    selected.map(async (reference) => ({
      image: await readLinqImageArtifact(input.scope, reference.id, {
        rootSessionId: input.rootSessionId,
        signal: input.signal,
      }).catch(() => undefined),
      reference,
    }))
  );
  const failedArtifactIds = [
    ...loaded
      .filter((item) => item.image === undefined)
      .map((item) => item.reference.id),
    ...references
      .slice(maximumWorkerCompletionImages)
      .map((reference) => reference.id),
  ];
  const files = loaded.flatMap(({ image }) =>
    image
      ? [
          {
            data: Buffer.from(image.bytes),
            filename: image.filename,
            mimeType: image.mediaType,
          } satisfies LinqImageArtifactFile,
        ]
      : []
  );

  return {
    failedArtifactIds,
    files,
    text: stripImageArtifactMarkdownReferences(message),
  };
}

async function readLinqImageArtifact(
  scope: AccessScope,
  artifactId: string,
  options: { readonly rootSessionId: string; readonly signal?: AbortSignal }
) {
  const artifact = await readReadyBrowserImageArtifact(scope, artifactId, {
    rootSessionId: options.rootSessionId,
  });
  if (
    !artifact?.byteSize ||
    !artifact.contentHash ||
    !artifact.filename ||
    !artifact.mediaType
  )
    return undefined;
  const bytes = await readBrowserImageContent(
    {
      byteSize: artifact.byteSize,
      mediaType: artifact.mediaType,
      storagePathname: artifact.storagePathname,
    },
    options.signal
  );
  if (!bytes) return undefined;
  if (createHash("sha256").update(bytes).digest("hex") !== artifact.contentHash)
    return undefined;
  return {
    bytes,
    filename: artifact.filename,
    id: artifact.id,
    mediaType: artifact.mediaType,
  };
}
