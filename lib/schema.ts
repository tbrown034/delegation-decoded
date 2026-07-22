import {
  pgTable,
  char,
  text,
  integer,
  varchar,
  boolean,
  date,
  serial,
  bigint,
  timestamp,
  unique,
  index,
  primaryKey,
  smallint,
  numeric,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// =============================================================================
// States
// =============================================================================

export const states = pgTable("states", {
  code: char("code", { length: 2 }).primaryKey(),
  name: text("name").notNull(),
  fipsCode: char("fips_code", { length: 2 }),
  numDistricts: integer("num_districts").notNull().default(1),
});

export const statesRelations = relations(states, ({ many }) => ({
  members: many(members),
}));

// =============================================================================
// Members
// =============================================================================

export const members = pgTable(
  "members",
  {
    bioguideId: varchar("bioguide_id", { length: 10 }).primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    fullName: text("full_name").notNull(),
    party: varchar("party", { length: 20 }).notNull(),
    stateCode: char("state_code", { length: 2 })
      .notNull()
      .references(() => states.code),
    chamber: varchar("chamber", { length: 10 }).notNull(),
    district: integer("district"),
    inOffice: boolean("in_office").notNull().default(true),
    birthDate: date("birth_date"),
    gender: varchar("gender", { length: 10 }),
    websiteUrl: text("website_url"),
    contactForm: text("contact_form"),
    phone: text("phone"),
    photoUrl: text("photo_url"),
    twitter: text("twitter"),
    facebook: text("facebook"),
    youtube: text("youtube"),
    fecCandidateId: varchar("fec_candidate_id", { length: 20 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_members_state").on(table.stateCode),
    index("idx_members_chamber").on(table.chamber),
    index("idx_members_party").on(table.party),
    index("idx_members_in_office").on(table.inOffice),
  ]
);

export const membersRelations = relations(members, ({ one, many }) => ({
  state: one(states, {
    fields: [members.stateCode],
    references: [states.code],
  }),
  terms: many(terms),
  committeeAssignments: many(committeeAssignments),
  billSponsorships: many(billSponsorships),
  campaignFinance: many(campaignFinance),
  disclosureFilings: many(disclosureFilings),
  stockTransactions: many(stockTransactions),
}));

// =============================================================================
// Terms
// =============================================================================

export const terms = pgTable(
  "terms",
  {
    id: serial("id").primaryKey(),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    chamber: varchar("chamber", { length: 10 }).notNull(),
    stateCode: char("state_code", { length: 2 })
      .notNull()
      .references(() => states.code),
    district: integer("district"),
    party: varchar("party", { length: 20 }).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (table) => [index("idx_terms_member").on(table.bioguideId)]
);

export const termsRelations = relations(terms, ({ one }) => ({
  member: one(members, {
    fields: [terms.bioguideId],
    references: [members.bioguideId],
  }),
}));

// =============================================================================
// Committees
// =============================================================================

export const committees = pgTable("committees", {
  committeeId: varchar("committee_id", { length: 10 }).primaryKey(),
  name: text("name").notNull(),
  chamber: varchar("chamber", { length: 10 }).notNull(),
  parentId: varchar("parent_id", { length: 10 }),
  url: text("url"),
});

export const committeesRelations = relations(committees, ({ many }) => ({
  assignments: many(committeeAssignments),
}));

// =============================================================================
// Committee Assignments
// =============================================================================

export const committeeAssignments = pgTable(
  "committee_assignments",
  {
    id: serial("id").primaryKey(),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    committeeId: varchar("committee_id", { length: 10 })
      .notNull()
      .references(() => committees.committeeId, { onDelete: "cascade" }),
    role: varchar("role", { length: 30 }).default("member"),
    congress: integer("congress").notNull(),
  },
  (table) => [
    unique("uq_assignment").on(
      table.bioguideId,
      table.committeeId,
      table.congress
    ),
    index("idx_assignments_member").on(table.bioguideId),
    index("idx_assignments_committee").on(table.committeeId),
  ]
);

export const committeeAssignmentsRelations = relations(
  committeeAssignments,
  ({ one }) => ({
    member: one(members, {
      fields: [committeeAssignments.bioguideId],
      references: [members.bioguideId],
    }),
    committee: one(committees, {
      fields: [committeeAssignments.committeeId],
      references: [committees.committeeId],
    }),
  })
);

// =============================================================================
// Bills
// =============================================================================

export const bills = pgTable(
  "bills",
  {
    billId: text("bill_id").primaryKey(),
    billType: varchar("bill_type", { length: 10 }).notNull(),
    billNumber: integer("bill_number").notNull(),
    congress: integer("congress").notNull(),
    title: text("title").notNull(),
    shortTitle: text("short_title"),
    introducedDate: date("introduced_date"),
    latestActionDate: date("latest_action_date"),
    latestActionText: text("latest_action_text"),
    policyArea: text("policy_area"),
    billUrl: text("bill_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_bills_congress").on(table.congress),
    index("idx_bills_introduced").on(table.introducedDate),
  ]
);

export const billsRelations = relations(bills, ({ many }) => ({
  sponsorships: many(billSponsorships),
}));

// =============================================================================
// Bill Sponsorships
// =============================================================================

export const billSponsorships = pgTable(
  "bill_sponsorships",
  {
    id: serial("id").primaryKey(),
    billId: text("bill_id")
      .notNull()
      .references(() => bills.billId, { onDelete: "cascade" }),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    role: varchar("role", { length: 15 }).notNull(),
    cosponsoredDate: date("cosponsored_date"),
  },
  (table) => [
    unique("uq_sponsorship").on(table.billId, table.bioguideId, table.role),
    index("idx_sponsorships_member").on(table.bioguideId),
    index("idx_sponsorships_bill").on(table.billId),
  ]
);

export const billSponsorshipsRelations = relations(
  billSponsorships,
  ({ one }) => ({
    bill: one(bills, {
      fields: [billSponsorships.billId],
      references: [bills.billId],
    }),
    member: one(members, {
      fields: [billSponsorships.bioguideId],
      references: [members.bioguideId],
    }),
  })
);

// =============================================================================
// Campaign Finance
// =============================================================================

export const campaignFinance = pgTable(
  "campaign_finance",
  {
    id: serial("id").primaryKey(),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    fecCandidateId: varchar("fec_candidate_id", { length: 20 }).notNull(),
    electionCycle: integer("election_cycle").notNull(),
    totalReceipts: bigint("total_receipts", { mode: "number" }),
    totalDisbursements: bigint("total_disbursements", { mode: "number" }),
    cashOnHand: bigint("cash_on_hand", { mode: "number" }),
    totalIndividual: bigint("total_individual", { mode: "number" }),
    totalPac: bigint("total_pac", { mode: "number" }),
    smallIndividual: bigint("small_individual", { mode: "number" }),
    lastFilingDate: date("last_filing_date"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_finance").on(table.fecCandidateId, table.electionCycle),
    index("idx_finance_member").on(table.bioguideId),
  ]
);

export const campaignFinanceRelations = relations(
  campaignFinance,
  ({ one }) => ({
    member: one(members, {
      fields: [campaignFinance.bioguideId],
      references: [members.bioguideId],
    }),
  })
);

// =============================================================================
// Top Contributors
// =============================================================================

export const topContributors = pgTable(
  "top_contributors",
  {
    id: serial("id").primaryKey(),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    electionCycle: integer("election_cycle").notNull(),
    contributorName: text("contributor_name").notNull(),
    contributorType: varchar("contributor_type", { length: 20 }),
    totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_contributors_member").on(table.bioguideId),
    unique("uq_contributor_member_cycle_name").on(
      table.bioguideId,
      table.electionCycle,
      table.contributorName
    ),
  ]
);

// =============================================================================
// Ingest cursors (resumable backfill positions)
// =============================================================================

export const ingestCursors = pgTable(
  "ingest_cursors",
  {
    source: text("source").notNull(),
    key: text("key").notNull(),
    cursor: text("cursor").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.source, table.key] })]
);

// =============================================================================
// Finance Committees
// =============================================================================

export const financeCommittees = pgTable(
  "finance_committees",
  {
    committeeId: varchar("committee_id", { length: 20 }).primaryKey(),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    fecCandidateId: varchar("fec_candidate_id", { length: 20 }).notNull(),
    name: text("name").notNull(),
    designation: char("designation", { length: 1 }), // P principal, A authorized, D leadership PAC, J joint
    committeeType: char("committee_type", { length: 1 }),
    firstCycle: integer("first_cycle"),
    lastCycle: integer("last_cycle"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_fincom_member").on(table.bioguideId)]
);

export const committeeFinance = pgTable(
  "committee_finance",
  {
    id: serial("id").primaryKey(),
    committeeId: varchar("committee_id", { length: 20 })
      .notNull()
      .references(() => financeCommittees.committeeId, { onDelete: "cascade" }),
    electionCycle: integer("election_cycle").notNull(),
    totalReceipts: bigint("total_receipts", { mode: "number" }),
    totalDisbursements: bigint("total_disbursements", { mode: "number" }),
    cashOnHand: bigint("cash_on_hand", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_committee_finance").on(table.committeeId, table.electionCycle),
  ]
);

// =============================================================================
// Press Releases
// =============================================================================

export const pressReleases = pgTable(
  "press_releases",
  {
    id: serial("id").primaryKey(),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    description: text("description"),
    source: varchar("source", { length: 20 }).default("rss"), // "rss" or "scrape"
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_press_release_url").on(table.url),
    index("idx_press_member").on(table.bioguideId),
    index("idx_press_date").on(table.publishedAt),
  ]
);

export const pressReleasesRelations = relations(pressReleases, ({ one }) => ({
  member: one(members, {
    fields: [pressReleases.bioguideId],
    references: [members.bioguideId],
  }),
}));

// =============================================================================
// Votes
// =============================================================================

export const votes = pgTable(
  "votes",
  {
    voteId: text("vote_id").primaryKey(), // "house-119-2025-10" or "senate-119-2025-1"
    chamber: varchar("chamber", { length: 10 }).notNull(),
    congress: integer("congress").notNull(),
    session: integer("session").notNull(),
    rollNumber: integer("roll_number").notNull(),
    voteDate: date("vote_date").notNull(),
    question: text("question"),
    description: text("description"),
    result: text("result"),
    billId: text("bill_id"), // optional link to our bills table
    yeas: integer("yeas").notNull().default(0),
    nays: integer("nays").notNull().default(0),
    present: integer("present").notNull().default(0),
    notVoting: integer("not_voting").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_votes_chamber").on(table.chamber),
    index("idx_votes_date").on(table.voteDate),
  ]
);

export const votesRelations = relations(votes, ({ many }) => ({
  positions: many(votePositions),
}));

export const votePositions = pgTable(
  "vote_positions",
  {
    id: serial("id").primaryKey(),
    voteId: text("vote_id")
      .notNull()
      .references(() => votes.voteId, { onDelete: "cascade" }),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    position: varchar("position", { length: 15 }).notNull(), // "yea", "nay", "present", "not_voting"
  },
  (table) => [
    unique("uq_vote_position").on(table.voteId, table.bioguideId),
    index("idx_votepos_member").on(table.bioguideId),
    index("idx_votepos_vote").on(table.voteId),
  ]
);

export const votePositionsRelations = relations(votePositions, ({ one }) => ({
  vote: one(votes, {
    fields: [votePositions.voteId],
    references: [votes.voteId],
  }),
  member: one(members, {
    fields: [votePositions.bioguideId],
    references: [members.bioguideId],
  }),
}));

// =============================================================================
// Events (change detection)
// =============================================================================

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    eventType: varchar("event_type", { length: 30 }).notNull(), // "bill_introduced", "vote_cast", "finance_filed"
    bioguideId: varchar("bioguide_id", { length: 10 }).references(
      () => members.bioguideId,
      { onDelete: "cascade" }
    ),
    stateCode: char("state_code", { length: 2 }).references(
      () => states.code
    ),
    title: text("title").notNull(),
    description: text("description"),
    relatedId: text("related_id"), // bill_id, vote_id, etc.
    eventDate: date("event_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_events_state").on(table.stateCode),
    index("idx_events_member").on(table.bioguideId),
    index("idx_events_date").on(table.eventDate),
    index("idx_events_type").on(table.eventType),
  ]
);

// =============================================================================
// Delegation Briefs
// =============================================================================

export const delegationBriefs = pgTable(
  "delegation_briefs",
  {
    id: serial("id").primaryKey(),
    stateCode: char("state_code", { length: 2 })
      .notNull()
      .references(() => states.code),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    summary: text("summary").notNull(),
    stats: text("stats"), // JSON string of key metrics
  },
  (table) => [
    index("idx_briefs_state").on(table.stateCode),
    index("idx_briefs_date").on(table.generatedAt),
  ]
);

// =============================================================================
// Disclosure Filings (STOCK Act PTRs)
// =============================================================================

export const disclosureFilings = pgTable(
  "disclosure_filings",
  {
    id: serial("id").primaryKey(),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    chamber: varchar("chamber", { length: 10 }).notNull(), // "house" | "senate"
    filingType: varchar("filing_type", { length: 20 }).notNull(), // "PTR" | "Annual" | "Amendment"
    docId: text("doc_id").notNull(), // House DocID or Senate report slug
    filedDate: date("filed_date"),
    coveragePeriodStart: date("coverage_period_start"),
    coveragePeriodEnd: date("coverage_period_end"),
    pdfUrl: text("pdf_url").notNull(),
    pdfHash: char("pdf_hash", { length: 64 }), // sha256 — dedup re-downloads
    parseStatus: varchar("parse_status", { length: 20 })
      .notNull()
      .default("pending"), // "pending" | "parsed" | "failed" | "review"
    parseConfidence: integer("parse_confidence"), // 0-100, page-averaged
    pageCount: integer("page_count"),
    pipelineRunId: integer("pipeline_run_id"), // soft FK to sync_log.id
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_filing_doc").on(table.chamber, table.docId),
    index("idx_filings_member").on(table.bioguideId),
    index("idx_filings_filed").on(table.filedDate),
    index("idx_filings_status").on(table.parseStatus),
  ]
);

export const disclosureFilingsRelations = relations(
  disclosureFilings,
  ({ one, many }) => ({
    member: one(members, {
      fields: [disclosureFilings.bioguideId],
      references: [members.bioguideId],
    }),
    transactions: many(stockTransactions),
  })
);

// =============================================================================
// Stock Transactions (one row per PTR line item)
// =============================================================================

export const stockTransactions = pgTable(
  "stock_transactions",
  {
    id: serial("id").primaryKey(),
    filingId: integer("filing_id")
      .notNull()
      .references(() => disclosureFilings.id, { onDelete: "cascade" }),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(), // position in PDF — distinguishes lots
    ownerCode: varchar("owner_code", { length: 10 }), // "SP" | "DC" | "JT" | self
    assetDescription: text("asset_description").notNull(),
    ticker: varchar("ticker", { length: 10 }),
    assetType: varchar("asset_type", { length: 30 }), // "Stock" | "Bond" | "Option" | "Fund"
    txType: varchar("tx_type", { length: 20 }).notNull(), // "P" | "S" | "S (partial)" | "Exchange"
    txDate: date("tx_date"),
    notifiedDate: date("notified_date"),
    amountRange: varchar("amount_range", { length: 40 }).notNull(), // "$1,001 - $15,000"
    amountMin: bigint("amount_min", { mode: "number" }),
    amountMax: bigint("amount_max", { mode: "number" }),
    capGainsOver200: boolean("cap_gains_over_200").default(false),
    filedLate: boolean("filed_late").default(false), // tx_date + 45d < filed_date
    needsReview: boolean("needs_review").default(false),
    confidence: integer("confidence"), // 0-100, parser confidence
    pdfPage: integer("pdf_page"), // page number for source-link deep-link
  },
  (table) => [
    unique("uq_tx").on(table.filingId, table.rowIndex),
    index("idx_tx_member").on(table.bioguideId),
    index("idx_tx_ticker").on(table.ticker),
    index("idx_tx_date").on(table.txDate),
    index("idx_tx_review").on(table.needsReview),
  ]
);

export const stockTransactionsRelations = relations(
  stockTransactions,
  ({ one }) => ({
    filing: one(disclosureFilings, {
      fields: [stockTransactions.filingId],
      references: [disclosureFilings.id],
    }),
    member: one(members, {
      fields: [stockTransactions.bioguideId],
      references: [members.bioguideId],
    }),
  })
);

// =============================================================================
// Sync Log
// =============================================================================

export const syncLog = pgTable(
  "sync_log",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    entityType: text("entity_type").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: varchar("status", { length: 20 }).notNull().default("running"),
    recordsCount: integer("records_count"),
    errorMessage: text("error_message"),
  },
  (table) => [index("idx_sync_source").on(table.source, table.entityType)]
);

// =============================================================================
// Election Candidates (FEC Form 2 statements of candidacy)
// =============================================================================

export const electionCandidates = pgTable(
  "election_candidates",
  {
    candidateId: varchar("candidate_id", { length: 20 }).primaryKey(),
    name: text("name").notNull(),
    party: text("party"),
    office: char("office", { length: 1 }).notNull(),
    stateCode: char("state_code", { length: 2 }).notNull(),
    district: integer("district"),
    electionYear: integer("election_year").notNull(),
    incumbentChallenge: char("incumbent_challenge", { length: 1 }),
    candidateStatus: char("candidate_status", { length: 1 }),
    hasRaisedFunds: boolean("has_raised_funds"),
    totalReceipts: bigint("total_receipts", { mode: "number" }),
    firstFileDate: date("first_file_date"),
    lastFileDate: date("last_file_date"),
    fecLoadDate: date("fec_load_date"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_candidates_race").on(
      table.stateCode,
      table.office,
      table.district,
      table.electionYear
    ),
  ]
);

// =============================================================================
// Verification-first election tracker
// =============================================================================

export const electionSources = pgTable(
  "election_sources",
  {
    sourceId: text("source_id").primaryKey(),
    stateCode: char("state_code", { length: 2 }).references(() => states.code),
    authorityName: text("authority_name").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceUrl: text("source_url").notNull(),
    adapterKey: text("adapter_key"),
    coverageStatus: text("coverage_status").notNull().default("adapter_pending"),
    isAuthoritative: boolean("is_authoritative").notNull().default(false),
    certificationWindowDays: integer("certification_window_days"),
    nextExpectedEvent: date("next_expected_event"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_election_sources_state").on(table.stateCode, table.coverageStatus),
    index("idx_election_sources_due").on(table.nextCheckAt),
  ]
);

export const electionContests = pgTable(
  "election_contests",
  {
    contestId: text("contest_id").primaryKey(),
    electionCycle: integer("election_cycle").notNull(),
    stateCode: char("state_code", { length: 2 }).notNull().references(() => states.code),
    office: char("office", { length: 1 }).notNull(),
    district: integer("district"),
    senateClass: smallint("senate_class"),
    electionType: text("election_type").notNull().default("regular"),
    title: text("title").notNull(),
    currentStage: text("current_stage"),
    coverageStatus: text("coverage_status").notNull().default("fec_only"),
    certifiedThrough: date("certified_through"),
    nextExpectedEvent: date("next_expected_event"),
    primarySourceId: text("primary_source_id").references(() => electionSources.sourceId),
    specialElectionUrl: text("special_election_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_election_contests_state").on(
      table.electionCycle,
      table.stateCode,
      table.office,
      table.district
    ),
    index("idx_election_contests_coverage").on(table.coverageStatus, table.stateCode),
  ]
);

export const electionStages = pgTable(
  "election_stages",
  {
    stageId: text("stage_id").primaryKey(),
    contestId: text("contest_id").notNull().references(() => electionContests.contestId, { onDelete: "cascade" }),
    stageKind: text("stage_kind").notNull(),
    party: text("party"),
    electionDate: date("election_date").notNull(),
    sequenceNumber: integer("sequence_number").notNull(),
    resultStatus: text("result_status").notNull().default("not_started"),
    certifiedAt: timestamp("certified_at", { withTimezone: true }),
    sourceId: text("source_id").references(() => electionSources.sourceId),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_election_stage").on(
      table.contestId,
      table.stageKind,
      table.party,
      table.sequenceNumber
    ),
    index("idx_election_stages_contest").on(table.contestId, table.sequenceNumber),
    index("idx_election_stages_date").on(table.electionDate),
  ]
);

export const candidatePeople = pgTable(
  "candidate_people",
  {
    personId: text("person_id").primaryKey(),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    bioguideId: varchar("bioguide_id", { length: 10 }).references(() => members.bioguideId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_candidate_people_name").on(table.normalizedName)]
);

export const candidateIdentifiers = pgTable(
  "candidate_identifiers",
  {
    personId: text("person_id").notNull().references(() => candidatePeople.personId, { onDelete: "cascade" }),
    identifierType: text("identifier_type").notNull(),
    identifierValue: text("identifier_value").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    sourceId: text("source_id").references(() => electionSources.sourceId),
  },
  (table) => [
    primaryKey({ columns: [table.personId, table.identifierType, table.identifierValue] }),
    unique("uq_candidate_identifier").on(table.identifierType, table.identifierValue),
  ]
);

export const candidacies = pgTable(
  "candidacies",
  {
    candidacyId: text("candidacy_id").primaryKey(),
    contestId: text("contest_id").notNull().references(() => electionContests.contestId, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => candidatePeople.personId),
    party: text("party"),
    currentStatus: text("current_status").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    fecCandidateId: varchar("fec_candidate_id", { length: 20 }),
    verifiedSourceId: text("verified_source_id").references(() => electionSources.sourceId),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_candidacy_person_contest").on(table.contestId, table.personId),
    index("idx_candidacies_contest").on(table.contestId, table.isActive, table.party),
    index("idx_candidacies_fec").on(table.fecCandidateId),
  ]
);

export const candidacyBallotLines = pgTable(
  "candidacy_ballot_lines",
  {
    ballotLineId: text("ballot_line_id").primaryKey(),
    candidacyId: text("candidacy_id").notNull().references(() => candidacies.candidacyId, { onDelete: "cascade" }),
    stageId: text("stage_id").references(() => electionStages.stageId, { onDelete: "cascade" }),
    partyLabel: text("party_label").notNull(),
    ballotOrder: integer("ballot_order"),
    sourceId: text("source_id").references(() => electionSources.sourceId),
  },
  (table) => [
    unique("uq_candidacy_ballot_line").on(table.candidacyId, table.stageId, table.partyLabel),
    index("idx_ballot_lines_candidacy").on(table.candidacyId, table.stageId),
  ]
);

export const electionSourceSnapshots = pgTable(
  "election_source_snapshots",
  {
    snapshotSha256: char("snapshot_sha256", { length: 64 }).primaryKey(),
    sourceId: text("source_id").notNull().references(() => electionSources.sourceId),
    originalUrl: text("original_url").notNull(),
    blobUrl: text("blob_url").notNull(),
    contentType: text("content_type").notNull(),
    contentLength: bigint("content_length", { mode: "number" }).notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_election_snapshots_source").on(table.sourceId, table.fetchedAt)]
);

export const candidateStatusEvents = pgTable(
  "candidate_status_events",
  {
    eventId: text("event_id").primaryKey(),
    candidacyId: text("candidacy_id").notNull().references(() => candidacies.candidacyId, { onDelete: "cascade" }),
    electionStageId: text("election_stage_id").references(() => electionStages.stageId, { onDelete: "cascade" }),
    status: text("status").notNull(),
    effectiveDate: date("effective_date"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    sourceId: text("source_id").notNull().references(() => electionSources.sourceId),
    snapshotSha256: char("snapshot_sha256", { length: 64 }).references(() => electionSourceSnapshots.snapshotSha256),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_candidate_status_timeline").on(table.candidacyId, table.observedAt)]
);

export const electionResults = pgTable(
  "election_results",
  {
    resultId: text("result_id").primaryKey(),
    stageId: text("stage_id").notNull().references(() => electionStages.stageId, { onDelete: "cascade" }),
    candidacyId: text("candidacy_id").notNull().references(() => candidacies.candidacyId, { onDelete: "cascade" }),
    totalVotes: bigint("total_votes", { mode: "number" }),
    voteShare: numeric("vote_share", { precision: 8, scale: 5 }),
    isWinner: boolean("is_winner").notNull().default(false),
    resultStatus: text("result_status").notNull(),
    sourceId: text("source_id").notNull().references(() => electionSources.sourceId),
    snapshotSha256: char("snapshot_sha256", { length: 64 }).references(() => electionSourceSnapshots.snapshotSha256),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_election_result").on(table.stageId, table.candidacyId),
    index("idx_election_results_stage").on(table.stageId, table.isWinner, table.totalVotes),
  ]
);

export const electionResultRounds = pgTable(
  "election_result_rounds",
  {
    resultId: text("result_id").notNull().references(() => electionResults.resultId, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    votes: bigint("votes", { mode: "number" }),
    voteShare: numeric("vote_share", { precision: 8, scale: 5 }),
    isContinuing: boolean("is_continuing"),
    isEliminated: boolean("is_eliminated"),
  },
  (table) => [primaryKey({ columns: [table.resultId, table.roundNumber] })]
);

export const candidateCampaignSites = pgTable("candidate_campaign_sites", {
  candidacyId: text("candidacy_id").primaryKey().references(() => candidacies.candidacyId, { onDelete: "cascade" }),
  siteUrl: text("site_url").notNull(),
  verificationStatus: text("verification_status").notNull().default("pending"),
  verifiedSourceUrl: text("verified_source_url"),
  lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
  contentSha256: char("content_sha256", { length: 64 }),
  crawlError: text("crawl_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const candidateSiteSnapshots = pgTable(
  "candidate_site_snapshots",
  {
    snapshotId: text("snapshot_id").primaryKey(),
    candidacyId: text("candidacy_id").notNull().references(() => candidacies.candidacyId, { onDelete: "cascade" }),
    pageUrl: text("page_url").notNull(),
    finalUrl: text("final_url").notNull(),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    blobUrl: text("blob_url").notNull(),
    contentType: text("content_type").notNull(),
    contentLength: bigint("content_length", { mode: "number" }).notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_candidate_site_snapshot").on(table.candidacyId, table.pageUrl, table.contentSha256),
    index("idx_candidate_site_snapshots_candidacy").on(table.candidacyId, table.fetchedAt),
  ]
);

export const candidateSiteClaims = pgTable(
  "candidate_site_claims",
  {
    claimId: text("claim_id").primaryKey(),
    candidacyId: text("candidacy_id").notNull().references(() => candidacies.candidacyId, { onDelete: "cascade" }),
    claimType: text("claim_type").notNull(),
    claimText: text("claim_text").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceQuote: text("source_quote").notNull(),
    sourceSnapshotId: text("source_snapshot_id").notNull().references(() => candidateSiteSnapshots.snapshotId),
    extractorProvider: text("extractor_provider").notNull(),
    extractorModel: text("extractor_model"),
    confidence: integer("confidence"),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_candidate_claims_candidacy").on(table.candidacyId, table.reviewStatus)]
);

export const candidatePriorService = pgTable(
  "candidate_prior_service",
  {
    serviceId: text("service_id").primaryKey(),
    personId: text("person_id").notNull().references(() => candidatePeople.personId, { onDelete: "cascade" }),
    officeTitle: text("office_title").notNull(),
    jurisdiction: text("jurisdiction"),
    startedOn: date("started_on"),
    endedOn: date("ended_on"),
    sourceUrl: text("source_url").notNull(),
    sourceQuote: text("source_quote").notNull(),
    sourceSnapshotId: text("source_snapshot_id").notNull().references(() => candidateSiteSnapshots.snapshotId),
    extractorProvider: text("extractor_provider").notNull(),
    extractorModel: text("extractor_model").notNull(),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
    verificationStatus: text("verification_status").notNull().default("needs_review"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
  },
  (table) => [index("idx_candidate_service_person").on(table.personId, table.verificationStatus)]
);

export const memberOfficialSites = pgTable("member_official_sites", {
  bioguideId: varchar("bioguide_id", { length: 10 })
    .primaryKey()
    .references(() => members.bioguideId, { onDelete: "cascade" }),
  siteUrl: text("site_url").notNull(),
  biographyUrl: text("biography_url"),
  siteType: text("site_type").notNull().default("official_congressional"),
  cmsFamily: text("cms_family"),
  verificationStatus: text("verification_status").notNull().default("verified"),
  verifiedSourceUrl: text("verified_source_url").notNull(),
  lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
  contentSha256: char("content_sha256", { length: 64 }),
  crawlError: text("crawl_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberSiteSnapshots = pgTable(
  "member_site_snapshots",
  {
    snapshotId: text("snapshot_id").primaryKey(),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    pageUrl: text("page_url").notNull(),
    finalUrl: text("final_url").notNull(),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    blobUrl: text("blob_url").notNull(),
    contentType: text("content_type").notNull(),
    contentLength: bigint("content_length", { mode: "number" }).notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_member_site_snapshot").on(
      table.bioguideId,
      table.pageUrl,
      table.contentSha256
    ),
    index("idx_member_site_snapshots_member").on(
      table.bioguideId,
      table.fetchedAt
    ),
  ]
);

export const memberBiographyClaims = pgTable(
  "member_biography_claims",
  {
    claimId: text("claim_id").primaryKey(),
    bioguideId: varchar("bioguide_id", { length: 10 })
      .notNull()
      .references(() => members.bioguideId, { onDelete: "cascade" }),
    claimText: text("claim_text").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceQuote: text("source_quote").notNull(),
    sourceSnapshotId: text("source_snapshot_id")
      .notNull()
      .references(() => memberSiteSnapshots.snapshotId),
    extractorProvider: text("extractor_provider").notNull(),
    extractorModel: text("extractor_model").notNull(),
    confidence: integer("confidence"),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_member_biography_claims_member").on(
      table.bioguideId,
      table.reviewStatus
    ),
  ]
);
