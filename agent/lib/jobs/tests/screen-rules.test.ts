import { describe, expect, it } from "vitest";
import {
  classifyEmployer,
  classifyLocation,
  classifyRoleFamily,
  classifySeniority,
  extractMinYears,
  needsModelScreen,
  screenWithRules,
} from "../screen/rules";

describe("classifyLocation", () => {
  it.each([
    ["Remote - Worldwide", null, "remote", ["worldwide"]],
    ["Anywhere", "remote", "remote", ["worldwide"]],
    ["Remote, India", null, "remote", ["IN"]],
    ["Bengaluru", "remote", "remote", ["IN"]],
    ["Bengaluru, Karnataka", "OnSite", "onsite", ["IN"]],
    ["Hybrid - Mumbai", null, "hybrid", ["IN"]],
    ["Remote (APAC)", null, "remote", ["apac"]],
    ["Remote - US", null, "remote", ["US"]],
    ["Remote, Europe; Remote, Canada", null, "remote", ["europe", "CA"]],
    ["Remote - Anywhere in the US", null, "remote", ["US"]],
    ["Remote", null, "remote", []],
    ["San Francisco, CA", null, "onsite", ["US"]],
    ["Not stated", null, "unclear", []],
  ])(
    "reads %s (%s) as %s in %j",
    (location, workplaceType, workplace, regions) => {
      const read = classifyLocation(location, workplaceType);
      expect(read.workplace).toBe(workplace);
      expect(read.regions).toEqual(regions);
    }
  );

  it("keeps every country a posting names", () => {
    expect(classifyLocation("Remote - US or India", null).regions).toEqual([
      "IN",
      "US",
    ]);
  });
});

describe("classifyEmployer", () => {
  it.each([
    ["Acme", "We build payroll software.", "unclear"],
    ["Acme", "We are hiring on behalf of our client, a fintech.", "agency"],
    ["Bright Staffing Group", "A great role.", "agency"],
    [
      "VENZA",
      "Our company is managing the recruitment process internally and is not engaging with staffing agencies.",
      "unclear",
    ],
  ])("reads %s as %s", (company, description, expected) => {
    expect(classifyEmployer(company, description)).toBe(expected);
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
    ["Software Engineer, Customer Accounts", "product"],
    ["Computer Vision Engineer - Body Sensor Networks", "data_ml"],
    ["Rust Systems Engineer", "infrastructure"],
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
      company: "Acme",
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
    expect(needsModelScreen(screen, ["IN"])).toBe(true);
  });

  it("spends model reads only on remote roles the hub's countries could take", () => {
    const screen = screenWithRules({
      company: "Acme",
      description: "",
      location: "Remote - US",
      title: "Software Engineer",
      workplaceType: null,
    });
    expect(needsModelScreen(screen, ["IN"])).toBe(false);
    expect(needsModelScreen(screen, ["IN", "US"])).toBe(true);
    expect(needsModelScreen({ ...screen, regions: ["asia"] }, ["IN"])).toBe(
      true
    );
    expect(needsModelScreen({ ...screen, regions: [] }, ["IN"])).toBe(true);
    expect(
      needsModelScreen({ ...screen, workplace: "onsite", regions: ["IN"] }, [
        "IN",
      ])
    ).toBe(false);
    expect(
      needsModelScreen(
        { ...screen, regions: ["worldwide"], seniority: "staff_plus" },
        ["IN"]
      )
    ).toBe(false);
  });
});
