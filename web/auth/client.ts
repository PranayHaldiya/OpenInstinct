import { createAuthClient } from "better-auth/react";
import { phoneNumberClient } from "better-auth/client/plugins";
import { withBasePath } from "@shared/environment/public/env";

export const authClient = createAuthClient({
  // The client only reads a path prefix from an absolute baseURL, so pass
  // the relative auth route straight to its fetch instead.
  fetchOptions: { baseURL: withBasePath("/api/auth") },
  plugins: [phoneNumberClient()],
});
