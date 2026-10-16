import {
  createTelegramFetchFile,
  createTelegramFileUrl,
  type TelegramAttachment,
} from "eve/channels/telegram";
import { saveJobDocument } from "@db/services/jobs/documents";
import type { AccessScope } from "@shared/identity/access-scope";
import { env } from "@shared/environment";

const documentTypes = new Map([
  ["application/pdf", ".pdf"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".docx",
  ],
]);

/** Telegram bots can download files up to 20 MB; resumes stay well under. */
export const maxDocumentBytes = 10 * 1024 * 1024;

const typesByExtension = new Map([
  ...[...documentTypes].map(([type, extension]) => [extension, type] as const),
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

/**
 * fetch for Telegram's Bot API that labels file downloads by extension.
 * Telegram serves every file as application/octet-stream, which media-type
 * checks on uploads would otherwise reject.
 */
export async function telegramFetch(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const response = await fetch(input, init);
  const path = new URL(input instanceof Request ? input.url : String(input))
    .pathname;
  const type = typesByExtension.get(
    /\.[a-z0-9]+$/i.exec(path)?.[0].toLowerCase() ?? ""
  );
  if (!path.startsWith("/file/bot") || !type) return response;
  const headers = new Headers(response.headers);
  headers.set("content-type", type);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

const fetchFile = createTelegramFetchFile({
  api: { fetch: telegramFetch },
  credentials: { botToken: env.TELEGRAM_BOT_TOKEN },
  policy: {
    allowedMediaTypes: [...documentTypes.keys()],
    maxBytes: maxDocumentBytes,
  },
});

/** A short label from a file name: "Jane Doe CV.pdf" becomes "jane-doe-cv". */
export function documentLabel(filename: string) {
  const label = filename
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return label || "document";
}

function mediaTypeOf(attachment: TelegramAttachment) {
  if (attachment.mediaType && documentTypes.has(attachment.mediaType)) {
    return attachment.mediaType;
  }
  const name = (attachment.fileName ?? "").toLowerCase();
  return [...documentTypes].find(([, extension]) =>
    name.endsWith(extension)
  )?.[0];
}

/**
 * Saves PDF and Word documents the user sends as job documents, so a resume
 * uploaded in chat can be attached to applications. Returns one line per
 * document for the model's context. File names are user input: quotes and
 * line breaks are stripped before they reach the model.
 */
export async function saveTelegramDocuments(
  scope: AccessScope,
  attachments: readonly TelegramAttachment[]
) {
  const lines: string[] = [];
  /* oxlint-disable eslint/no-await-in-loop -- A message carries at most a few documents; saving them in order keeps labels predictable. */
  for (const attachment of attachments) {
    const mediaType = mediaTypeOf(attachment);
    if (attachment.kind !== "document" || !mediaType) continue;
    const filename = (
      attachment.fileName ?? `document${documentTypes.get(mediaType) ?? ""}`
    )
      .replaceAll(/["\r\n]/g, "")
      .slice(0, 120);
    if ((attachment.size ?? 0) > maxDocumentBytes) {
      lines.push(
        `The user sent "${filename}", which is over the 10 MB limit for documents, so it was not saved.`
      );
      continue;
    }
    try {
      const file = await fetchFile(
        createTelegramFileUrl({
          fileId: attachment.fileId,
          filename,
          mediaType,
        }).toString()
      );
      if (!file) continue;
      const label = documentLabel(filename);
      await saveJobDocument(scope, {
        content: Buffer.isBuffer(file) ? file : file.bytes,
        filename,
        label,
        mimeType: mediaType,
      });
      lines.push(
        `The user's attachment "${filename}" is saved as job document "${label}" (replacing any document with that label). If it is a resume, agree a label with the user and rename it with jobs-documents.`
      );
    } catch (error) {
      lines.push(
        `The user's attachment "${filename}" could not be saved: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return lines;
}
