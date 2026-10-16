import { describe, expect, it } from "vitest";
import { companyKey, jobPreferencesSchema } from "./schema";

describe("companyKey", () => {
  it.each([
    ["Gather AI", "gather"],
    ["gather-ai", "gather"],
    ["Naïve", "naive"],
    ["Acme, Inc.", "acme"],
    ["Retell AI (YC W24)", "retell"],
    ["AI", "ai"],
  ])("keys %s as %s", (name, key) => {
    expect(companyKey(name)).toBe(key);
  });
});

describe("jobPreferencesSchema", () => {
  it("fills defaults for a new user", () => {
    expect(jobPreferencesSchema.parse({})).toMatchObject({
      digestSize: 5,
      maxYears: 3,
      country: null,
      excludeEmployerTypes: ["agency"],
      workplaces: ["remote"],
    });
  });
});
