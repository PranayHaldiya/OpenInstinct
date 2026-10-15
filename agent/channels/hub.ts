import { defineChannel, GET, POST } from "eve/channels";
import { z } from "zod";
import {
  routeTelegramUpdate,
  telegramUpdateSchema,
} from "@agent/lib/hub/router";
import { verifyHubToken } from "@agent/lib/hub/token";
import { ingestJobs } from "@agent/lib/jobs/ingest";
import { listCandidateJobPostings } from "@db/services/jobs/postings";
import { remoteScopes } from "@shared/jobs/schema";
import { env } from "@shared/environment";

const notFound = () => new Response(null, { status: 404 });

// Hub-only HTTP surface: the shared Telegram webhook and the job index that
// per-user VMs read. On any other deployment these routes answer 404.
export default defineChannel({
  routes: [
    POST("/eve/v1/hub/telegram", async (request, { waitUntil }) => {
      if (env.OI_ROLE !== "hub") return notFound();
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (
        !env.TELEGRAM_WEBHOOK_SECRET_TOKEN ||
        secret !== env.TELEGRAM_WEBHOOK_SECRET_TOKEN
      ) {
        return new Response(null, { status: 401 });
      }
      const update = telegramUpdateSchema.safeParse(await request.json());
      if (!update.success) return new Response(null, { status: 400 });
      // Telegram retries slow webhooks; acknowledge at once and route after.
      waitUntil(routeAndLog(update.data));
      return new Response(null, { status: 200 });
    }),
    // Operator trigger for a job ingest outside the four-hourly schedule.
    POST("/eve/v1/hub/ingest", async (request, { waitUntil }) => {
      if (env.OI_ROLE !== "hub" || !env.OI_HUB_SECRET) return notFound();
      if (request.headers.get("x-oi-hub-secret") !== env.OI_HUB_SECRET) {
        return new Response(null, { status: 401 });
      }
      waitUntil(ingestAndLog());
      return new Response(null, { status: 202 });
    }),
    GET("/eve/v1/hub/jobs", async (request) => {
      if (env.OI_ROLE !== "hub" || !env.OI_HUB_SECRET) return notFound();
      const telegramUserId = request.headers.get("x-oi-user") ?? "";
      // Maritime's edge rewrites Authorization, so hub credentials travel
      // in their own headers.
      const token = request.headers.get("x-oi-hub-token");
      if (
        !token ||
        !/^\d{1,20}$/.test(telegramUserId) ||
        !verifyHubToken(env.OI_HUB_SECRET, telegramUserId, token)
      ) {
        return new Response(null, { status: 401 });
      }
      const query = z
        .object({
          scopes: z
            .string()
            .transform((value) => value.split(","))
            .pipe(z.array(z.enum(remoteScopes)).min(1)),
          since: z.iso.datetime().transform((value) => new Date(value)),
        })
        .safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!query.success) return new Response(null, { status: 400 });
      const postings = await listCandidateJobPostings({
        remoteScopes: query.data.scopes,
        since: query.data.since,
      });
      return Response.json({ postings });
    }),
  ],
});

async function routeAndLog(update: Parameters<typeof routeTelegramUpdate>[0]) {
  try {
    await routeTelegramUpdate(update);
  } catch (error) {
    console.error("[hub] routing failed", error);
  }
}

async function ingestAndLog() {
  try {
    console.info("[jobs] ingest finished", await ingestJobs());
  } catch (error) {
    console.error("[jobs] ingest failed", error);
  }
}
