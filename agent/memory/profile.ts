import { defineMemory } from "eve/memory";
import { fileMemory } from "eve/memory/file";
import { vercelBlob } from "eve/memory/file/vercel";
import {
  preserveProfileMemoryCancellation,
  resolveProfileMemoryBackend,
  resolveProfileMemoryScope,
} from "../lib/profile-memory";
import { postgresMemoryBackend } from "@db/services/memory-documents";
import { env } from "@shared/environment";

const backend = resolveProfileMemoryBackend(env);
const provider = preserveProfileMemoryCancellation(
  backend.kind === "vercel-blob"
    ? fileMemory({
        backend: vercelBlob(backend.options),
      })
    : backend.kind === "postgres"
      ? fileMemory({ backend: postgresMemoryBackend })
      : fileMemory()
);

export default defineMemory({
  description: "Remember stable facts and preferences about the current user.",
  provider,
  scope: resolveProfileMemoryScope,
});
