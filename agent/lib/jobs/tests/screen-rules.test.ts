import { describe, expect, it } from "vitest";
import {
  classifyLocation,
  classifyRoleFamily,
  classifySeniority,
  extractMinYears,
  needsModelScreen,
  screenWithRules,
} from "../screen/rules";

describe("classifyLocation", () => {
  it.each([
    ["Remote - Worldwide", null, "anywhere"],
    ["Anywhere", "remote", "anywhere"],
    ["Remote, India", null, "india"],
    ["Bengaluru", "remote", "india"],
    ["Bengaluru, Karnataka", "OnSite", "onsite"],
    ["Hybrid - Mumbai", null, "onsite"],
    ["Remote (APAC)", null, "apac"],
    ["Remote - US", null, "other_region"],
    ["Remote, Europe; Remote, Canada", null, "other_region"],
    ["Remote", null, "unclear"],
    ["San Francisco, CA", null, "onsite"],
    ["Not stated", null, "unclear"],
  ])("reads %s (%s) as %s", (location, workplaceType, expected) => {
    expect(classifyLocation(location, workplaceType).remote).toBe(expected);
  });

  it("prefers India over a region named alongside it", () => {
    expect(classifyLocation("Remote - US or India", null).remote).toBe("india");
  });
});

describe("classifySeniority", () => {
  it.each([
    ["Software Engineer Intern", "intern"],
    ["Junior Frontend Developer", "junior"],
    ["Software Engineer I", "junior"],
    ["Software Engineer", "unknown"],
    ["Senior Backend Engineer", "senior"],
    ["Tech Lead, Platform", "senior"],
    ["Staff Engineer", "staff_plus"],
    ["Principal AI Engineer", "staff_plus"],
  ])("reads %s as %s", (title, expected) => {
    expect(classifySeniority(title)).toBe(expected);
  });
});

describe("classifyRoleFamily", () => {
  it.each([
    ["Founding Full-Stack Engineer", "product"],
    ["Software Engineer II", "product"],
    ["AI Engineer, Agents", "ai"],
    ["Senior Data Engineer", "data_ml"],
    ["Site Reliability Engineer", "infrastructure"],
    ["iOS Developer", "mobile"],
    ["QA Automation Engineer", "qa"],
    ["People Systems Engineer", "support"],
    ["IT Engineer Generalist", "support"],
    ["Security Engineer", "security"],
  ])("reads %s as %s", (title, expected) => {
    expect(classifyRoleFamily(title)).toBe(expected);
  });
});

describe("extractMinYears", () => {
  it("takes the largest years-of-experience ask", () => {
    expect(
      extractMinYears(
        "You have 2+ years with React and 5+ years of professional software experience."
      )
    ).toBe(5);
  });

  it("reads ranges by their lower bound", () => {
    expect(extractMinYears("3-5 years of experience building APIs")).toBe(3);
  });

  it("ignores years that are not an experience ask", () => {
    expect(extractMinYears("Founded 12 years ago. We ship fast.")).toBeNull();
  });
});

describe("screenWithRules", () => {
  it("collects stack terms and red flags", () => {
    const screen = screenWithRules({
      description:
        "Build AI agents in TypeScript and Next.js. This role is equity-only for now.",
      location: "Remote - Worldwide",
      title: "Founding Engineer",
      workplaceType: null,
    });
    expect(screen.stack).toEqual(
      expect.arrayContaining(["typescript", "next.js", "agents"])
    );
    expect(screen.redFlags).toEqual(["equity-only or unpaid"]);
    expect(needsModelScreen(screen)).toBe(true);
  });

  it("does not spend a model read on roles that can't fit", () => {
    const screen = screenWithRules({
      description: "",
      location: "Remote - US",
      title: "Software Engineer",
      workplaceType: null,
    });
    expect(needsModelScreen(screen)).toBe(false);
    expect(
      needsModelScreen({
        ...screen,
        remote: "anywhere",
        seniority: "staff_plus",
      })
    ).toBe(false);
    expect(
      needsModelScreen({ ...screen, remote: "unclear", seniority: "senior" })
    ).toBe(false);
  });
});
