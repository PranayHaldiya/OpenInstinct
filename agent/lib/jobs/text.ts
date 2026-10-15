import type { jobBoardProviders } from "@shared/jobs/schema";
import type { JobBoardRef } from "./sources/boards";

const namedEntities = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

export function decodeEntities(text: string) {
  return text.replaceAll(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return namedEntities.get(code.toLowerCase()) ?? entity;
    }
  );
}

/** Turns posting HTML into plain text with paragraph breaks kept. */
export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replaceAll(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replaceAll(/<(br|\/p|\/div|\/li|\/h\d|p|li)\b[^>]*>/gi, "\n")
      .replaceAll(/<[^>]+>/g, " ")
  )
    .replaceAll(/[ \t ]+/g, " ")
    .replaceAll(/\s*\n\s*/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(text: string, maxLength: number) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

const boardLinkPatterns = [
  { provider: "ashby", pattern: /jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/g },
  {
    provider: "greenhouse",
    pattern:
      /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/g,
  },
  { provider: "lever", pattern: /jobs\.lever\.co\/([A-Za-z0-9._-]+)/g },
] as const satisfies readonly {
  provider: (typeof jobBoardProviders)[number];
  pattern: RegExp;
}[];

const notBoardSlugs = new Set(["embed", "api", "jobs", "v1"]);

/** Finds Ashby, Greenhouse and Lever boards linked from any text. */
export function findBoardLinks(text: string, company: string | null) {
  const boards = new Map<string, JobBoardRef>();
  for (const { provider, pattern } of boardLinkPatterns) {
    for (const match of text.matchAll(pattern)) {
      const slug = match[1]?.replace(/[.]+$/, "").toLowerCase();
      if (!slug || notBoardSlugs.has(slug)) continue;
      boards.set(`${provider}:${slug}`, { company, provider, slug });
    }
  }
  return [...boards.values()];
}

const softwareTitle =
  /\b(engineer(?:ing)?|developer|swe|sde|programmer|full[- ]?stack|front[- ]?end|back[- ]?end|devrel|developer advocate|architect)\b/i;
const otherEngineering =
  /\b(mechanical|electrical|civil|chemical|hardware|manufacturing|process|structural|sales|biomedical|rf|analog|mixed[- ]signal|asic|fpga|optical|hvac)\b/i;

/** Whether a title reads like a software role worth storing and screening. */
export function isSoftwareTitle(title: string) {
  return softwareTitle.test(title) && !otherEngineering.test(title);
}
