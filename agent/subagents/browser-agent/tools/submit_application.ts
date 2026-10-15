import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import { kernel } from "@agent/subagents/browser-agent/lib/kernel";
import { requireOwnedBrowserSession } from "@agent/subagents/browser-agent/lib/owned-browser";
import { recordJobApplication } from "@db/services/jobs/applications";
import { consumeJobSubmissionGrant } from "@db/services/jobs/grants";

const followUpMs = 7 * 86_400_000;

export default defineTool({
  description:
    "Submit a prefilled job application. This is the only way to press an application's final submit button. It needs the grant_token the coordinator passed you after the user approved this exact submission; a grant works once, for the browser session it names, for 15 minutes. Give session_id, grant_token and a CSS selector for the final submit button. Returns the page URL and visible text after submitting so you can report whether it went through.",
  inputSchema: z.object({
    grant_token: z.uuid(),
    selector: z.string().trim().min(1).max(1_000),
    session_id: z.string().trim().min(1).max(500),
  }),
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    await requireOwnedBrowserSession(scope, input.session_id);
    const grant = await consumeJobSubmissionGrant(
      scope,
      input.grant_token,
      input.session_id
    );
    if (!grant) {
      throw new Error(
        "No valid submission grant for this browser session. Do not submit; report that the user's approval is needed."
      );
    }
    const result = await kernel.browsers.playwright.execute(
      input.session_id,
      {
        code: `
const button = page.locator(${JSON.stringify(input.selector)}).first();
await button.waitFor({ state: "visible", timeout: 10_000 });
await button.click();
await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(2_000);
return {
  text: (await page.locator("body").innerText()).slice(0, 1_500),
  url: page.url(),
};`,
        timeout_sec: 45,
      },
      { signal: context.abortSignal }
    );
    const page = z
      .object({ text: z.string(), url: z.string() })
      .safeParse(result.success ? result.result : undefined);
    if (!page.success) {
      throw new Error(
        `${result.error ?? "The submit click failed."} The grant is spent; the user must approve again.`
      );
    }
    await recordJobApplication(scope, {
      channel: new URL(page.data.url).hostname,
      company: grant.company,
      followUpAt: new Date(Date.now() + followUpMs),
      postingId: grant.postingId ?? undefined,
      role: grant.role,
      status: "applied",
    });
    return {
      pageText: page.data.text,
      pageUrl: page.data.url,
      submitted: true,
    };
  },
});
