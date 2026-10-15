import {
  defaultTelegramAuth,
  telegramChannel,
  type TelegramContext,
  type TelegramMessage,
} from "eve/channels/telegram";
import {
  findUserIdByTelegramUserId,
  redeemTelegramLinkCode,
} from "@db/services/telegram-links";
import type { z } from "zod";
import {
  sendMessageToolResultSchema,
  type sendMessageOutputSchema,
} from "@shared/chat/message-delivery";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { env } from "@shared/environment";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "../lib/linq-image-artifact/markdown";
import { finalizeScheduledReportDelivery } from "@agent/lib/schedules/report-lifecycle";

const botUsername = env.TELEGRAM_BOT_USERNAME;
const unlinkedReply =
  "I don't know who you are yet. Open your OpenInstinct workspace and tap Connect Telegram.";

export default telegramChannel({
  botUsername,
  credentials: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    // Without a configured secret, reject every webhook rather than trusting it.
    ...(env.TELEGRAM_WEBHOOK_SECRET_TOKEN
      ? { webhookSecretToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN }
      : { webhookVerifier: () => false }),
  },
  events: {
    async "action.result"(event, channel, session) {
      const message = sendMessageToolResultSchema.safeParse(event.result);
      if (event.status !== "completed" || !message.success) return;
      await channel.telegram.post(telegramText(message.data.output));
      await finalizeScheduledReportDelivery(session);
    },
  },
  async onMessage(context, message) {
    const sender = message.from;
    if (!sender || sender.isBot) return null;
    const isPrivate = message.chat.type === "private";

    const linkCode = /^\/start(?:@[A-Za-z0-9_]+)?\s+(\S+)$/.exec(
      message.text.trim()
    )?.[1];
    if (isPrivate && linkCode) {
      const linkedUserId = await redeemTelegramLinkCode(linkCode, sender.id);
      await context.telegram.post(
        linkedUserId
          ? "Connected. Text me whenever you need something."
          : "That link has expired. Tap Connect Telegram in your workspace for a new one."
      );
      return null;
    }

    if (!shouldDispatch(message)) return null;
    const userId = await findUserIdByTelegramUserId(sender.id);
    if (!userId) {
      // Only the linked account authenticates a principal; never mint one for
      // an unknown Telegram user, and stay quiet in groups.
      if (isPrivate) await notifyUnlinked(context);
      return null;
    }
    const auth = defaultTelegramAuth(message);
    if (!auth) return null;
    await context.telegram.startTyping();
    const principalId = `better-auth:${userId}`;
    const scope = accessScopeForUser(principalId);
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          conversationChannel: "telegram",
          conversationId: `telegram:${message.chat.id}`,
          workspaceId: scope.workspaceId,
        },
        principalId,
      },
    };
  },
});

function shouldDispatch(message: TelegramMessage) {
  const text = message.text || message.caption;
  if (!text.trim() && message.attachments.length === 0) return false;
  if (message.chat.type === "private") return true;
  if (message.chat.type === "channel") return false;
  if (message.replyToMessage?.from?.isBot) return true;
  return (
    botUsername !== undefined &&
    text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)
  );
}

async function notifyUnlinked(context: TelegramContext) {
  await context.telegram.post(unlinkedReply);
}

function telegramText(output: z.infer<typeof sendMessageOutputSchema>) {
  if (output.kind === "link") return output.url;
  const text = output.text ?? "";
  // Browser image artifacts are private; Telegram delivery is text-only for now.
  const imageNote =
    extractImageArtifactMarkdownReferences(text).length > 0
      ? "(I took a screenshot, but I can't send images on Telegram yet.)"
      : undefined;
  return [
    stripImageArtifactMarkdownReferences(text),
    ...(output.attachments?.map((attachment) => attachment.url) ?? []),
    imageNote,
  ]
    .filter(Boolean)
    .join("\n\n");
}
