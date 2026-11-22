export const positives = [
  {
    question: "How do I get a NIN for the first time?",
    answerId: "nin",
    sourceIds: ["nimc-nin", "nimc-enrol", "nimc-faq"],
  },
  {
    question: "How do I renew my passport?",
    answerId: "passport-renew",
    sourceIds: ["nis-passports", "nis-knowledge"],
  },
  {
    question: "How do I register a company with the CAC?",
    answerId: "cac-company",
    sourceIds: ["cac-company", "cac-timelines", "cac-faq"],
  },
  {
    question: "How do I register for the JAMB UTME?",
    answerId: "jamb",
    sourceIds: ["jamb-portal", "jamb-efacility", "jamb-home"],
  },
  {
    question: "How do I register for NYSC?",
    answerId: "nysc",
    sourceIds: ["nysc-portal", "nysc-home"],
  },
  {
    question: "How do I apply for a NELFUND student loan?",
    answerId: "nelfund",
    sourceIds: ["nelfund-home", "egov-services"],
  },
  {
    question: "How do I apply for a Nigerian passport?",
    answerId: "passport-new",
    sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  },
  {
    question: "How much be the passport renewal fee?",
    answerId: "passport-fee",
    sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  },
  {
    question: "My Nigerian passport has expired. Wetin I go do?",
    answerId: "passport-renew",
    sourceIds: ["nis-passports", "nis-knowledge"],
  },
  {
    question: "How do I get a national identity number?",
    answerId: "nin",
    sourceIds: ["nimc-nin", "nimc-enrol", "nimc-faq"],
  },
  {
    question: "Abeg, how I fit reprint my NIN slip?",
    answerId: "nin-slip",
    sourceIds: ["nimc-slip", "nimc-faq", "nimc-services"],
  },
  {
    question: "How I fit renew my driving license?",
    answerId: "licence-renew",
    sourceIds: ["frsc-home"],
  },
  {
    question: "How do I get a tax ID?",
    answerId: "tin",
    sourceIds: ["firs-taxpromax", "firs-home"],
  },
  {
    question: "How can I get my bank verification number?",
    answerId: "bvn",
    sourceIds: ["nibss-home", "cbn-home"],
  },
  {
    question: "How do I register for youth service?",
    answerId: "nysc",
    sourceIds: ["nysc-portal", "nysc-home"],
  },
  {
    question: "Not a passport. I want to get my NIN.",
    answerId: "nin",
    sourceIds: ["nimc-nin", "nimc-enrol", "nimc-faq"],
  },
  {
    question: "I don't have a passport. How do I apply for one?",
    answerId: "passport-new",
    sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  },
  {
    question: "Do I need a NIN to renew my passport?",
    answerId: "passport-renew",
    sourceIds: ["nis-passports", "nis-knowledge"],
  },
  {
    question: "Can I renew my passport without a NIN?",
    answerId: "passport-renew",
    sourceIds: ["nis-passports", "nis-knowledge"],
  },
  {
    question: "Can I renew my passport with my NIN?",
    answerId: "passport-renew",
    sourceIds: ["nis-passports", "nis-knowledge"],
  },
  {
    question: "How much does it cost to renew my passport?",
    answerId: "passport-fee",
    sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  },
  {
    question: "How do I register for a T.I.N.?",
    answerId: "tin",
    sourceIds: ["firs-taxpromax", "firs-home"],
  },
  {
    question: "Can I enroll for my N.I.N.?",
    answerId: "nin",
    sourceIds: ["nimc-nin", "nimc-enrol", "nimc-faq"],
  },
  {
    question: "Where can I check my NIN slip online?",
    answerId: "nin-slip",
    sourceIds: ["nimc-slip", "nimc-faq", "nimc-services"],
  },
];

export const followUp = {
  question: "How much is it?",
  context: "What is the passport fee?",
  answerId: "passport-fee",
  sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
};

export const negatives = [
  { question: "How do I renew a library card?", answerId: null },
  { question: "How do I renew a TV subscription?", answerId: null },
  { question: "Can I pay for my gym membership?", answerId: null },
  { question: "What is photosynthesis?", answerId: null },
  { question: "What does casual mean?", answerId: null },
  { question: "How do I renew my application?", answerId: null },
  { question: "Where do I pay the renewal fee?", answerId: null },
  { question: "Where is the enrolment centre for this course?", answerId: null },
  { question: "How do I apply for a visa through NIS?", answerId: null },
  { question: "How do I apply for a government building permit?", answerId: null },
  { question: "How do I renew my TV licence?", answerId: null },
  { question: "How do I renew my passport and my driver's licence?", answerId: null },
  { question: "Can I pay for my student loan and passport together?", answerId: null },
  { question: "How much is it?", answerId: null },
  { question: "I don't want a passport; how do I apply for a visa?", answerId: null },
  { question: "Can I get an e-visa? My Nigerian passport is valid.", answerId: null },
  { question: "Do I need my passport or NIN to apply for a visa?", answerId: null },
  { question: "Can I open a bank account without BVN?", answerId: null },
  { question: "How do I renew my passport? How do I apply for a visa?", answerId: null },
  { question: "Can I apply for a visa with my passport?", answerId: null },
  { question: "How do I renew my passport and apply for a visa?", answerId: null },
  { question: "How do I recycle a tin can?", answerId: null },
  { question: "What is spinning?", answerId: null },
];

export const contextualCases = [
  followUp,
  {
    question: "How much is it?",
    context: "How do I apply for a Nigerian passport?",
    answerId: "passport-fee",
    sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  },
  {
    question: "How much is it?",
    context: ["How do I register for NYSC?", "How do I renew my passport?", "Can I renew it?"],
    answerId: "passport-fee",
    sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  },
  {
    question: "How much is it?",
    context: ["How do I renew my passport?", "How do I apply for a visa?"],
    answerId: null,
  },
  {
    question: "How much is it?",
    context: "I need a passport and a driver's licence.",
    answerId: null,
  },
  {
    question: "How do I renew my TV subscription?",
    context: "How do I renew my passport?",
    answerId: null,
  },
  {
    question: "Where is the nearest passport office?",
    context: "How do I get a NIN?",
    answerId: "passport-new",
    sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  },
  {
    question: "Abeg, how much e go cost?",
    context: "How do I renew my passport?",
    answerId: "passport-fee",
    sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  },
  {
    question: "What's the fee?",
    context: ["How do I renew my passport?", "Thanks!"],
    answerId: "passport-fee",
    sourceIds: ["nis-passports", "nis-knowledge", "nis-contact"],
  },
  {
    question: "How much is it?",
    context: ["How do I renew my passport?", "I don't need a passport."],
    answerId: null,
  },
];

export const centreCases = [
  { question: "Where is the nearest NIMC centre in Ikeja?", context: "", answerId: "nimc-centres" },
  { question: "Where can I do it?", context: "How do I get a NIN in Ikeja?", answerId: "nimc-centres" },
  { question: "Where can I enroll in Ikeja?", context: "How do I get a NIN?", answerId: "nimc-centres" },
];
