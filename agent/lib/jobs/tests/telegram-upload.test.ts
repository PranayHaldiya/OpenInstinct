import { afterEach, describe, expect, it, vi } from "vitest";
import type { saveJobDocument } from "@db/services/jobs/documents";

const saved = vi.fn<typeof saveJobDocument>();

vi.mock("@db/services/jobs/documents", () => ({ saveJobDocument: saved }));
vi.mock("@shared/environment", () => ({
  env: { TELEGRAM_BOT_TOKEN: "123:token" },
}));

const scope = { userId: "better-auth:alice", workspaceId: "personal:alice" };

afterEach(() => {
  vi.unstubAllGlobals();
  saved.mockReset();
});

function stubTelegram(bytes: string) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes("/getFile")) {
      return Response.json({
        ok: true,
        result: { file_path: "documents/file_1.pdf" },
      });
    }
    // Telegram serves file downloads as a generic octet stream.
    return new Response(bytes, {
      headers: { "content-type": "application/octet-stream" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("documentLabel", () => {
  it.each([
    ["Jane Doe CV.pdf", "jane-doe-cv"],
    ["Pranay_Haldiya_Resume (2).docx", "pranay-haldiya-resume-2"],
    ["résumé.pdf", "r-sum"],
    [".pdf", "document"],
  ])("labels %s as %s", async (filename, label) => {
    const { documentLabel } = await import("../telegram-upload");
    expect(documentLabel(filename)).toBe(label);
  });
});

describe("saveTelegramDocuments", () => {
  it("saves PDF and Word documents and tells the model their labels", async () => {
    stubTelegram("%PDF-1.7 resume");
    const { saveTelegramDocuments } = await import("../telegram-upload");
    const lines = await saveTelegramDocuments(scope, [
      {
        fileId: "file-1",
        fileName: 'Jane "Doe" CV.pdf',
        kind: "document",
        mediaType: "application/pdf",
        size: 2_000,
      },
      { fileId: "photo-1", kind: "photo", mediaType: "image/jpeg" },
      {
        fileId: "file-2",
        fileName: "notes.txt",
        kind: "document",
        mediaType: "text/plain",
      },
    ]);
    expect(saved).toHaveBeenCalledOnce();
    const [, document] = saved.mock.calls[0] ?? [];
    expect(document).toMatchObject({
      filename: "Jane Doe CV.pdf",
      label: "jane-doe-cv",
      mimeType: "application/pdf",
    });
    expect(document?.content.toString()).toBe("%PDF-1.7 resume");
    expect(lines).toEqual([
      expect.stringContaining('saved as job document "jane-doe-cv"'),
    ]);
  });

  it("skips documents over the size limit without downloading them", async () => {
    const fetchMock = stubTelegram("");
    const { saveTelegramDocuments } = await import("../telegram-upload");
    const lines = await saveTelegramDocuments(scope, [
      {
        fileId: "file-1",
        fileName: "big.pdf",
        kind: "document",
        mediaType: "application/pdf",
        size: 50 * 1024 * 1024,
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect(lines).toEqual([expect.stringContaining("over the 10 MB limit")]);
  });
});

describe("telegramFetch", () => {
  it("labels file downloads by extension and leaves API calls alone", async () => {
    stubTelegram("bytes");
    const { telegramFetch } = await import("../telegram-upload");
    const file = await telegramFetch(
      "https://api.telegram.org/file/bot123:token/documents/file_1.pdf"
    );
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(await file.text()).toBe("bytes");
    const unknown = await telegramFetch(
      "https://api.telegram.org/file/bot123:token/documents/file_2.zip"
    );
    expect(unknown.headers.get("content-type")).toBe(
      "application/octet-stream"
    );
    const api = await telegramFetch(
      "https://api.telegram.org/bot123:token/getFile"
    );
    expect(api.headers.get("content-type")).toBe("application/json");
  });
});
