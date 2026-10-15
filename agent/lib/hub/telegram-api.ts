import { env } from "@shared/environment";

/** Sends a plain text message from the shared bot. Failures are logged. */
export async function sendTelegramText(chatId: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        body: JSON.stringify({ chat_id: chatId, text }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!response.ok) {
      console.warn("[hub] telegram send failed", { status: response.status });
    }
  } catch (error) {
    console.warn("[hub] telegram send failed", { cause: error });
  }
}
