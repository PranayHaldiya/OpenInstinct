import { and, asc, eq } from "drizzle-orm";
import { db, jobDocuments } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { ensureScope } from "../scope";

function owner(scope: AccessScope) {
  return and(
    eq(jobDocuments.workspaceId, scope.workspaceId),
    eq(jobDocuments.userId, scope.userId)
  );
}

/** Saves a document under a label, replacing any document with that label. */
export async function saveJobDocument(
  scope: AccessScope,
  document: {
    readonly content: Buffer;
    readonly filename: string;
    readonly label: string;
    readonly mimeType: string;
  }
) {
  await ensureScope(scope);
  const [row] = await db
    .insert(jobDocuments)
    .values({
      ...document,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      target: [
        jobDocuments.workspaceId,
        jobDocuments.userId,
        jobDocuments.label,
      ],
      set: {
        content: document.content,
        createdAt: new Date(),
        filename: document.filename,
        mimeType: document.mimeType,
      },
    })
    .returning({ id: jobDocuments.id });
  return row;
}

/** Labels and file details of the user's documents, without their content. */
export async function listJobDocuments(scope: AccessScope) {
  return db
    .select({
      createdAt: jobDocuments.createdAt,
      filename: jobDocuments.filename,
      id: jobDocuments.id,
      label: jobDocuments.label,
      mimeType: jobDocuments.mimeType,
    })
    .from(jobDocuments)
    .where(owner(scope))
    .orderBy(asc(jobDocuments.label));
}

export async function readJobDocument(scope: AccessScope, label: string) {
  const [row] = await db
    .select()
    .from(jobDocuments)
    .where(and(owner(scope), eq(jobDocuments.label, label)))
    .limit(1);
  return row;
}
