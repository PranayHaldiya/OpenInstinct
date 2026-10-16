import { locationCodeSchema, type regionNames } from "@shared/jobs/schema";

type RegionName = (typeof regionNames)[number];

const northAmerica = ["US", "CA"];
const latam = [
  "MX",
  "BR",
  "AR",
  "CO",
  "CL",
  "PE",
  "UY",
  "CR",
  "EC",
  "GT",
  "PA",
  "DO",
  "BO",
  "PY",
  "VE",
  "SV",
  "HN",
  "NI",
  "PR",
];
const europe = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "GB",
  "CH",
  "NO",
  "IS",
  "UA",
  "RS",
  "BA",
  "AL",
  "MK",
  "ME",
  "MD",
];
const middleEast = [
  "AE",
  "SA",
  "IL",
  "TR",
  "QA",
  "KW",
  "BH",
  "OM",
  "JO",
  "LB",
  "EG",
];
const africa = [
  "NG",
  "KE",
  "ZA",
  "EG",
  "MA",
  "GH",
  "TN",
  "ET",
  "UG",
  "RW",
  "TZ",
  "SN",
  "CI",
];
const asia = [
  "IN",
  "PK",
  "BD",
  "LK",
  "NP",
  "CN",
  "JP",
  "KR",
  "SG",
  "MY",
  "TH",
  "VN",
  "PH",
  "ID",
  "HK",
  "TW",
  "KH",
  "MM",
];
const oceania = ["AU", "NZ"];

const regionMembers: Record<RegionName, ReadonlySet<string>> = {
  africa: new Set(africa),
  americas: new Set([...northAmerica, ...latam]),
  apac: new Set([...asia, ...oceania]),
  asia: new Set(asia),
  emea: new Set([...europe, ...middleEast, ...africa]),
  europe: new Set(europe),
  latam: new Set(latam),
  middle_east: new Set(middleEast),
  north_america: new Set(northAmerica),
  oceania: new Set(oceania),
};

/**
 * Every code a posting may list that lets someone in `country` work it:
 * worldwide, the country itself and the regions that contain it.
 */
export function locationCodesFor(country: string | null) {
  if (!country) return ["worldwide"];
  return [
    "worldwide",
    country,
    ...Object.entries(regionMembers)
      .filter(([, members]) => members.has(country))
      .map(([region]) => region),
  ];
}

const codeAliases = new Map([
  ["anywhere", "worldwide"],
  ["asia_pacific", "apac"],
  ["eea", "europe"],
  ["eu", "europe"],
  ["global", "worldwide"],
  ["latin_america", "latam"],
  ["na", "north_america"],
  ["south_america", "latam"],
  ["uk", "GB"],
  ["usa", "US"],
]);

/**
 * Cleans location codes a model wrote: country codes upper-cased, region
 * names snake-cased, aliases resolved and anything unknown dropped. A
 * specific limit wins over `worldwide` named beside it.
 */
export function normalizeLocationCodes(raw: readonly string[]) {
  const codes = new Set<string>();
  for (const value of raw) {
    const key = value
      .trim()
      .toLowerCase()
      .replaceAll(/[\s-]+/g, "_");
    const aliased = codeAliases.get(key) ?? key;
    const code = /^[a-z]{2}$/.test(aliased) ? aliased.toUpperCase() : aliased;
    if (locationCodeSchema.safeParse(code).success) codes.add(code);
  }
  if (codes.size > 1) codes.delete("worldwide");
  return [...codes].slice(0, 30);
}
