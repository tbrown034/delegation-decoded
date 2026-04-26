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
  (table) => [index("idx_contributors_member").on(table.bioguideId)]
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
