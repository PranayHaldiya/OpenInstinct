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

/** Renames a document; false when it doesn't exist or the new label is taken. */
export async function renameJobDocument(
  scope: AccessScope,
  label: string,
  newLabel: string
) {
  if (label === newLabel) return Boolean(await readJobDocument(scope, label));
  if (await readJobDocument(scope, newLabel)) return false;
  const rows = await db
    .update(jobDocuments)
    .set({ label: newLabel })
    .where(and(owner(scope), eq(jobDocuments.label, label)))
    .returning({ id: jobDocuments.id });
  return rows.length > 0;
}

export async function deleteJobDocument(scope: AccessScope, label: string) {
  const rows = await db
    .delete(jobDocuments)
    .where(and(owner(scope), eq(jobDocuments.label, label)))
    .returning({ id: jobDocuments.id });
  return rows.length > 0;
}
