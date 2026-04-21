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
