import { ANSWERS, SERVICE_IDENTIFIERS, type CuratedAnswer } from "./answers";
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
  return text.toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").map((word) => WORD_VARIANTS.get(word) ?? word).join(" ");
}

function containsPhrase(text: string, phrase: string) {
  return ` ${text} `.includes(` ${phrase} `);
}

type CuratedService = CuratedAnswer["service"];
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

// A subject-free follow-up can inherit a service. An unrecognised subject starts a new topic.
const FOLLOW_UP = [
  /^(?:and )?how much(?: (?:is (?:it|that|this|the fee)|(?:does|will) (?:it|that|this) cost))?$/,
  /^(?:and )?how long(?: (?:does|will) (?:it|that|this) take)?$/,
  /^(?:and )?what (?:is the (?:fee|cost)|about the (?:fee|cost|document|requirement)|(?:document|requirement) do i need)$/,
  /^(?:and )?(?:(?:where|how) )?(?:do|can|should) i (?:apply|pay|renew|enrol|get it done|do (?:it|that|this)|(?:apply for|renew|pay for) (?:it|that|this))$/,
];

function isFollowUp(question: string) {
  return FOLLOW_UP.some((pattern) => pattern.test(question));
}

function resolveService(question: string, context: ConversationContext) {
  const direct = matchingServices(question);
  if (direct.length === 1) return { service: direct[0], previous: "" };
  if (direct.length > 1 || !isFollowUp(question)) return null;

  const turns = typeof context === "string" ? [context] : [...context].reverse();
  for (const turn of turns) {
    const previous = normalise(turn);
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
  const asked = normalise(question);
  const intent = resolveService(asked, context);
  if (!intent) return [];

  const terms = rankingTerms(asked);
  const previousTerms = rankingTerms(intent.previous);
  return ANSWERS.filter(({ service }) => service === intent.service)
    .map((entry) => ({
      entry,
      score: scoreAnswer(entry, asked, terms),
      previousScore: scoreAnswer(entry, intent.previous, previousTerms),
    }))
    .sort((a, b) => b.score - a.score || b.previousScore - a.previousScore)
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
  if (!isCentreQuestion(question)) return null;
  const intent = resolveService(normalise(question), context);
  if (intent?.service !== "nin") return null;

  const place = findPlace(question) ?? findPlace(intent.previous);
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

  if (!best) {
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

  return {
    answer: best.entry.answer,
    sources: getSources(best.entry.sourceIds),
    mode: "curated",
    confident: true,
    agency: best.entry.agency,
    followUps: best.entry.followUps,
  };
}

export function buildContext(question: string, context: ConversationContext = "") {
  return retrieve(question, 4, context)
    .map(({ entry }) => {
      const refs = getSources(entry.sourceIds)
        .map((source) => `${source.id} (${source.agency}, ${source.url})`)
        .join("; ");
      return `### ${entry.title}\n${entry.answer}\nSources: ${refs}`;
    })
    .join("\n\n");
}

export function sourceCatalogue() {
  return SOURCES.map(
    (source) =>
      `${source.id} | ${source.agency} | ${source.title} | ${source.url} | ${source.topics.join(", ")}`,
  ).join("\n");
}

export function isKnownSource(id: string) {
  return SOURCES.some((source) => source.id === id);
}

export function sourceById(id: string) {
  return SOURCES.find((source) => source.id === id);
}
