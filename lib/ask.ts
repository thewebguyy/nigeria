import { ANSWERS, SERVICE_IDENTIFIERS, type CuratedAnswer } from "./answers";
import type { Evidence } from "./grounding";
import { getSources, SOURCES } from "./sources";
import { findPlace, isCentreQuestion, nimcCentresLink } from "./places";
import type { AskResult } from "./types";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is", "are", "am",
  "i", "me", "my", "we", "our", "you", "your", "it", "its", "this", "that", "these",
  "how", "what", "where", "when", "who", "why", "do", "does", "did", "can", "could",
  "should", "would", "will", "be", "been", "have", "has", "had", "get", "got", "need",
  "want", "please", "tell", "about", "with", "from", "at", "by", "as", "if", "so",
  "there", "here", "much", "many", "long", "make", "made", "go", "going", "any",
  "some", "just", "now", "then", "than", "also", "help", "know", "like",
]);

/** Generic words have less weight when ranking answers within a qualified service. */
const WEAK_WORDS = new Set([
  "register", "registration", "apply", "application", "get", "new", "card", "number",
  "service", "services", "online", "official", "site", "website", "office", "need",
  "document", "requirement", "start", "business",
]);

const WORD_VARIANTS = new Map([
  ["application", "apply"], ["applying", "apply"],
  ["charges", "fee"], ["fees", "fee"], ["price", "fee"],
  ["costs", "cost"], ["documents", "document"], ["requirements", "requirement"],
  ["drivers", "driver"], ["driving", "driver"], ["licenses", "licence"],
  ["license", "licence"], ["licences", "licence"], ["passports", "passport"],
  ["enroll", "enrol"], ["enrollment", "enrolment"],
  ["payment", "pay"], ["registering", "register"], ["registration", "register"],
  ["renewal", "renew"], ["renewing", "renew"],
]);

function normalise(text: string) {
  // The uppercase tax acronym is distinct from the ordinary word "tin".
  return text.replace(/\bTIN\b/g, "tax identification number").toLowerCase()
    .replace(/\b(what|where|how|it|that|there)['’]s\b/g, "$1 is")
    .replace(/\bdon['’]t\b/g, "do not")
    .replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/^(?:abeg|please) /, "")
    .split(" ").map((word) => WORD_VARIANTS.get(word) ?? word).join(" ");
}

function containsPhrase(text: string, phrase: string) {
  return ` ${text} `.includes(` ${phrase} `);
}

type ConversationContext = string | readonly string[];

function subjectWords(text: string) {
  return text.replace(/\b(?:a|an|the|my|our|your)\b/g, "").replace(/ +/g, " ").trim();
}

const identifiers = [...new Set(ANSWERS.map(({ service }) => service))].map((service) => ({
  service,
  phrases: SERVICE_IDENTIFIERS[service].map((phrase) => subjectWords(normalise(phrase))),
}));

function matchingServices(question: string) {
  const subject = subjectWords(question);
  return identifiers.filter(({ phrases }) => phrases.some((phrase) => containsPhrase(subject, phrase)))
    .map(({ service }) => service);
}

function isServiceName(text: string) {
  const name = subjectWords(text);
  return identifiers.some(({ phrases }) => phrases.includes(name));
}

// A subject-free follow-up can inherit a service. An unrecognised subject starts a new topic.
const FOLLOW_UP = [
  /^(?:and )?how much(?: (?:is (?:it|that|this|the fee)|(?:does|will) (?:it|that|this) cost|e go cost))?$/,
  /^(?:and )?how long(?: (?:does|will) (?:it|that|this) take)?$/,
  /^(?:and )?what (?:is the (?:fee|cost)|about the (?:fee|cost|document|requirement)|(?:document|requirement) do i need)$/,
  /^(?:and )?(?:(?:where|how) )?(?:do|can|should) i (?:apply|pay|renew|enrol|get it done|(?:do|get|apply for|renew|pay for) (?:it|that|this|one))$/,
  /^(?:renew|apply for|register for) (?:it|that|this)$/,
  /^wetin i go do$/,
];

function isFollowUp(question: string) {
  const location = / in (.+)$/.exec(question);
  if (location) {
    const place = findPlace(location[1]);
    if (place && (normalise(place.town ?? "") === location[1] ||
      normalise(place.state) === location[1].replace(/ state$/, ""))) {
      question = question.slice(0, location.index);
    }
  }
  return FOLLOW_UP.some((pattern) => pattern.test(question));
}

const REJECTED_TOPIC = /^(?:(?:i|we) do not (?:want|need|mean)|(?:i am )?not (?:a|the|my|asking|looking))\b/;
const EXPLICIT_REQUEST = /^(?:how|where|what|can|could|should|do|is|are|wetin|apply|renew|register|open|enrol|(?:i|we) (?:need|want))\b/;
const PREREQUISITE_REQUEST = /^(?:(?:do|would) i need|(?:can|should) i use) .+? to (.+)$/;
const CREDENTIAL_MODIFIER = /^(.*\b(?:apply for|renew|register for|open|get) .+) (?:with|using) (.+)$/;

function requestSubject(clause: string) {
  const target = PREREQUISITE_REQUEST.exec(clause)?.[1] ?? clause;
  const without = target.replace(/ without (.+)$/, (suffix, name: string) => isServiceName(name) ? "" : suffix);
  const credential = CREDENTIAL_MODIFIER.exec(without);
  return credential && isServiceName(credential[2]) ? credential[1] : without;
}

/** Prefer the explicit request over supporting statements and named prerequisites. */
function focusedQuestion(question: string) {
  const clauses = question.replace(/\b(?:[a-z]\.){2,}[a-z]\b\.?/gi, (initials) => initials.replaceAll(".", ""))
    .split(/(?<=[!?;])|\.(?=\s|$)|[\r\n]+|\bbut\b|\band\s+(?=(?:apply|renew|register|open|enrol)\b)/i)
    .map(normalise).filter(Boolean);
  const active = clauses.filter((clause) => !REJECTED_TOPIC.test(clause) &&
    !(clause.startsWith("not ") && isServiceName(clause.slice(4))));
  const requests = active.filter((clause) => EXPLICIT_REQUEST.test(clause) && !isFollowUp(clause));
  const subjects = (requests.length ? requests : active).map(requestSubject);
  // Keep a multi-part request together only when every explicit part has a supported subject.
  if (requests.length > 1 && subjects.some((subject) => matchingServices(subject).length === 0)) return "";
  const focus = subjects.join(" | ");
  // A rejected topic followed only by a pronoun or elliptical request must not borrow an older topic.
  return active.length !== clauses.length && isFollowUp(focus) ? "" : focus;
}

function resolveService(question: string, context: ConversationContext) {
  const direct = matchingServices(question);
  if (direct.length === 1) return { service: direct[0], previous: "" };
  if (direct.length > 1 || !isFollowUp(question)) return null;

  const turns = typeof context === "string" ? [context] : [...context].reverse();
  for (const turn of turns) {
    if (isSmallTalk(turn)) continue;
    const previous = focusedQuestion(turn);
    const services = matchingServices(previous);
    if (services.length === 1) return { service: services[0], previous };
    if (services.length > 1 || !isFollowUp(previous)) return null;
  }
  return null;
}

function rankingTerms(question: string) {
  const terms = new Set(question.split(" ").filter((word) => word && !STOP_WORDS.has(word)));
  if (containsPhrase(question, "how much")) terms.add("fee");
  return terms;
}

function scoreAnswer(entry: CuratedAnswer, question: string, terms: ReadonlySet<string>) {
  const phrases = [...new Set(entry.keywords.map(normalise))];
  const words = new Set(phrases.flatMap((phrase) => phrase.split(" ")));
  let score = 0;
  for (const term of terms) {
    if (words.has(term)) score += WEAK_WORDS.has(term) ? 1 : 3;
  }
  for (const phrase of phrases) {
    const length = phrase.split(" ").length;
    if (length > 1 && containsPhrase(question, phrase)) score += 2 + 2 * length;
  }
  return score;
}

export function retrieve(question: string, limit = 3, context: ConversationContext = "") {
  const asked = focusedQuestion(question);
  const intent = resolveService(asked, context);
  if (!intent) return [];

  const terms = rankingTerms(asked);
  const previousTerms = rankingTerms(intent.previous);
  const asksForFee = /^(?:and )?(?:how much|what (?:is|are) (?:the )?(?:fee|cost))\b/.test(asked);
  return ANSWERS.filter(({ service }) => service === intent.service)
    .map((entry) => ({
      entry,
      feeMatch: Number(asksForFee && entry.aboutFees === true),
      score: scoreAnswer(entry, asked, terms),
      previousScore: scoreAnswer(entry, intent.previous, previousTerms),
    }))
    .sort((a, b) => b.feeMatch - a.feeMatch || b.score - a.score || b.previousScore - a.previousScore)
    .slice(0, limit);
}

const UNKNOWN_AGENCY = {
  name: "Nigeria Government Services Portal",
  url: "https://services.gov.ng/",
};

const SMALL_TALK =
  /^(hi|hey|hello|hallo|good (morning|afternoon|evening)|sannu|bawo( ni)?|kedu|thanks?|thank you|ok(ay)?)\b[\s,.!?]*(there|nigeria)?[\s.!?]*$/i;

export function isSmallTalk(question: string) {
  return SMALL_TALK.test(question.trim());
}

/** Centre questions about NIN, answered with NIMC's own finder for the user's state. */
export function centreAnswer(question: string, context: ConversationContext = ""): AskResult | null {
  const asked = focusedQuestion(question);
  if (!isCentreQuestion(asked)) return null;
  const intent = resolveService(asked, context);
  if (intent?.service !== "nin") return null;

  const place = findPlace(asked) ?? findPlace(intent.previous);
  const link = nimcCentresLink(place);
  const where = place
    ? place.town
      ? `${place.town} (${place.state === "FCT" ? "FCT" : `${place.state} State`})`
      : place.state === "FCT"
        ? "Abuja (FCT)"
        : `${place.state} State`
    : null;

  return {
    answer: where
      ? `NIMC keeps the official list of enrolment centres, and I've opened it filtered for ${where}. I don't hold individual addresses, and centres open, move or close, so check the list for one near you and call ahead before you go.\n\nTake your original ID, birth certificate or age declaration, and proof of address. First-time enrolment is free.`
      : "NIMC keeps the official list of enrolment centres, searchable by state. Tell me your town or state and I'll narrow it down for you.\n\nTake your original ID, birth certificate or age declaration, and proof of address. First-time enrolment is free.",
    sources: getSources(["nimc-centres", "nimc-enrol"]),
    mode: "curated",
    confident: true,
    agency: { name: "NIMC", url: link.url },
    followUps: [],
    action: link,
  };
}

export function curatedAnswer(question: string, context: ConversationContext = ""): AskResult {
  if (isSmallTalk(question)) {
    const thanks = /^(thanks?|thank you)/i.test(question.trim());
    return {
      answer: thanks
        ? "You're welcome. Ask me anytime."
        : "Hello. What government service can I help you with today?",
      sources: [],
      mode: "curated",
      confident: true,
      agency: null,
      followUps: [],
    };
  }

  const centre = centreAnswer(question, context);
  if (centre) return centre;

  const best = retrieve(question, 1, context)[0];

  if (!best) return unverifiedAnswer();

  return {
    answer: best.entry.answer,
    sources: getSources(best.entry.sourceIds),
    mode: "curated",
    confident: true,
    agency: best.entry.agency,
    followUps: best.entry.followUps,
  };
}

export function unverifiedAnswer(): AskResult {
  return {
    answer:
      "I don't have a reliable answer for that one, and I would rather say so than guess. The federal services portal at services.gov.ng lists agencies by service, and each agency's own site is the one to trust for fees, forms and documents. If you tell me the service you are after, I can point you to the right agency.",
    sources: getSources(["egov-home", "egov-services", "nigeria-gov"]),
    mode: "curated",
    confident: false,
    agency: UNKNOWN_AGENCY,
    followUps: [
      "How do I get a NIN?",
      "How do I register a business?",
      "How do I apply for a student loan?",
    ],
  };
}

export function buildContext(question: string, context: ConversationContext = ""): Evidence[] {
  return retrieve(question, 1, context).map(({ entry }) => ({
    title: entry.title,
    text: entry.answer,
    sources: getSources(entry.sourceIds),
  }));
}

export function isKnownSource(id: string) {
  return SOURCES.some((source) => source.id === id);
}

export function sourceById(id: string) {
  return SOURCES.find((source) => source.id === id);
}
