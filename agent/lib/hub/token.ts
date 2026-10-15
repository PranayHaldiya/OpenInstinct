import { createHmac, timingSafeEqual } from "node:crypto";

/** The credential a user's VM presents to the hub's API. */
export function hubTokenFor(secret: string, telegramUserId: string) {
  return createHmac("sha256", secret)
    .update(`oi-hub:${telegramUserId}`)
    .digest("base64url");
}

export function verifyHubToken(
  secret: string,
  telegramUserId: string,
  token: string
) {
  const expected = Buffer.from(hubTokenFor(secret, telegramUserId));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
