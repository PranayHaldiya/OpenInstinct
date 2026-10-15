import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import { kernel } from "@agent/subagents/browser-agent/lib/kernel";
import { requireOwnedBrowserSession } from "@agent/subagents/browser-agent/lib/owned-browser";
import { readJobDocument } from "@db/services/jobs/documents";

export default defineTool({
  description:
    "Attach one of the user's saved documents, such as a resume, to a file input in an owned browser. Give session_id, the document label named in the assignment, and a CSS selector for the page's file input (an input[type=file], which may be hidden behind an upload button). The tool copies the file into the browser machine and sets it on the input; the file's content never enters your context. Returns the attached file names so you can confirm the upload, then check the page shows it.",
  inputSchema: z.object({
    label: z.string().trim().min(1).max(100),
    selector: z.string().trim().min(1).max(1_000),
    session_id: z.string().trim().min(1).max(500),
  }),
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    await requireOwnedBrowserSession(scope, input.session_id);
    const document = await readJobDocument(scope, input.label);
    if (!document) {
      throw new Error(
        `The user has no saved document labeled "${input.label}".`
      );
    }
    const filename = document.filename.replaceAll(/[^\w.-]+/g, "_");
    const path = `/tmp/${filename}`;
    await kernel.browsers.fs.writeFile(
      input.session_id,
      document.content,
      { path },
      { signal: context.abortSignal }
    );
    const result = await kernel.browsers.playwright.execute(
      input.session_id,
      {
        code: `
const input = page.locator(${JSON.stringify(input.selector)}).first();
await input.setInputFiles(${JSON.stringify(path)});
return await input.evaluate((element) =>
  element instanceof HTMLInputElement
    ? Array.from(element.files ?? [], (file) => file.name)
    : []
);`,
        timeout_sec: 30,
      },
      { signal: context.abortSignal }
    );
    const attached = z
      .array(z.string())
      .safeParse(result.success ? result.result : undefined);
    if (!attached.success || !attached.data.includes(filename)) {
      throw new Error(
        result.error ?? "The file input did not accept the document."
      );
    }
    return { attached: attached.data, label: document.label };
  },
});
