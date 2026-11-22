const STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo", "Jigawa",
  "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger",
  "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

// Common towns people name instead of their state.
const TOWNS: Record<string, string> = {
  ota: "Ogun", sango: "Ogun", abeokuta: "Ogun", "ijebu ode": "Ogun", sagamu: "Ogun", ifo: "Ogun",
  ikeja: "Lagos", lekki: "Lagos", surulere: "Lagos", ikorodu: "Lagos", yaba: "Lagos", ajah: "Lagos",
  badagry: "Lagos", epe: "Lagos", ibadan: "Oyo", ogbomoso: "Oyo", oyo: "Oyo", osogbo: "Osun",
  ile: "Osun", ilorin: "Kwara", akure: "Ondo", "ado ekiti": "Ekiti", benin: "Edo", warri: "Delta",
  asaba: "Delta", "port harcourt": "Rivers", owerri: "Imo", aba: "Abia", umuahia: "Abia",
  enugu: "Enugu", nsukka: "Enugu", onitsha: "Anambra", awka: "Anambra", nnewi: "Anambra",
  calabar: "Cross River", uyo: "Akwa Ibom", yenagoa: "Bayelsa", makurdi: "Benue", jos: "Plateau",
  lokoja: "Kogi", minna: "Niger", zaria: "Kaduna", maiduguri: "Borno", yola: "Adamawa",
  sokoto: "Sokoto", katsina: "Katsina", kano: "Kano", gombe: "Gombe", lafia: "Nasarawa",
  abuja: "FCT", gwagwalada: "FCT", kubwa: "FCT", garki: "FCT", wuse: "FCT", maitama: "FCT",
};

export type Place = { town: string | null; state: string };

export function findPlace(text: string): Place | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ")} `;

  for (const [town, state] of Object.entries(TOWNS)) {
    if (lower.includes(` ${town} `)) {
      return { town: town.replace(/\b\w/g, (c) => c.toUpperCase()), state };
    }
  }
  if (/ (fct|federal capital territory) /.test(lower)) return { town: null, state: "FCT" };
  for (const state of STATES) {
    if (lower.includes(` ${state.toLowerCase()} `)) return { town: null, state };
  }
  return null;
}

export const NIMC_CENTRES_URL = "https://nimc.gov.ng/enrolment-centres";

/** NIMC's own finder, pre-filtered to a state where we know it. */
export function nimcCentresLink(place: Place | null) {
  if (!place) return { label: "Find NIN enrolment centres", url: NIMC_CENTRES_URL };
  const state = place.state === "FCT" ? "fct abuja" : `${place.state.toLowerCase()} state`;
  return {
    label: `Find NIN centres in ${place.state === "FCT" ? "Abuja (FCT)" : `${place.state} State`}`,
    url: `${NIMC_CENTRES_URL}?country=nigeria&&state=${encodeURIComponent(state)}`,
  };
}

const CENTRE_WORDS = /\b(cent(er|re)s?|offices?|locations?|branch(?:es)?)\b/i;
const LOCATION_REQUEST = /\b(where|which|find|near me|nearest|closest)\b/i;
const NIMC_LOCATION = /\b(?:nimc|nin|enrolment) (?:cent(?:er|re)s?|offices?|branch(?:es)?)\b/i;
const ENROLMENT_LOCATION = /\bwhere (?:can i|do i|should i|to) (?:enrol|register|do it|get (?:it done|(?:a |my |the )?nin))\b/i;

export function isCentreQuestion(text: string) {
  return NIMC_LOCATION.test(text) || ENROLMENT_LOCATION.test(text) ||
    (CENTRE_WORDS.test(text) && LOCATION_REQUEST.test(text));
}
