-- Delegation Decoded — Database Schema
-- Target: Neon Postgres (serverless)
-- Run: psql $DATABASE_URL < scripts/schema.sql

-- =============================================================================
-- Reference data
-- =============================================================================

CREATE TABLE IF NOT EXISTS states (
  code          CHAR(2) PRIMARY KEY,
  name          TEXT NOT NULL,
  fips_code     CHAR(2),
  num_districts INTEGER NOT NULL DEFAULT 1
);

-- =============================================================================
-- Members of Congress
-- =============================================================================

CREATE TABLE IF NOT EXISTS members (
  bioguide_id     VARCHAR(10) PRIMARY KEY,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  party           VARCHAR(20) NOT NULL,
  state_code      CHAR(2) NOT NULL REFERENCES states(code),
  chamber         VARCHAR(10) NOT NULL CHECK (chamber IN ('senate', 'house')),
  district        INTEGER,
  in_office       BOOLEAN NOT NULL DEFAULT true,
  birth_date      DATE,
  gender          VARCHAR(10),
  website_url     TEXT,
  contact_form    TEXT,
  phone           TEXT,
  photo_url       TEXT,
  twitter         TEXT,
  facebook        TEXT,
  youtube         TEXT,
  fec_candidate_id VARCHAR(20),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_members_state ON members(state_code);
CREATE INDEX IF NOT EXISTS idx_members_chamber ON members(chamber);
CREATE INDEX IF NOT EXISTS idx_members_party ON members(party);
CREATE INDEX IF NOT EXISTS idx_members_in_office ON members(in_office);

-- =============================================================================
-- Terms of service
-- =============================================================================

CREATE TABLE IF NOT EXISTS terms (
  id            SERIAL PRIMARY KEY,
  bioguide_id   VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  chamber       VARCHAR(10) NOT NULL CHECK (chamber IN ('senate', 'house')),
  state_code    CHAR(2) NOT NULL REFERENCES states(code),
  district      INTEGER,
  party         VARCHAR(20) NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE,
  is_current    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_terms_member ON terms(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_terms_current ON terms(is_current) WHERE is_current = true;

-- =============================================================================
-- Committees
-- =============================================================================

CREATE TABLE IF NOT EXISTS committees (
  committee_id  VARCHAR(10) PRIMARY KEY,
  name          TEXT NOT NULL,
  chamber       VARCHAR(10) NOT NULL CHECK (chamber IN ('senate', 'house', 'joint')),
  parent_id     VARCHAR(10) REFERENCES committees(committee_id),
  url           TEXT
);

-- =============================================================================
-- Committee assignments
-- =============================================================================

CREATE TABLE IF NOT EXISTS committee_assignments (
  id            SERIAL PRIMARY KEY,
  bioguide_id   VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  committee_id  VARCHAR(10) NOT NULL REFERENCES committees(committee_id) ON DELETE CASCADE,
  role          VARCHAR(30) DEFAULT 'member',
  congress      INTEGER NOT NULL,
  UNIQUE(bioguide_id, committee_id, congress)
);

CREATE INDEX IF NOT EXISTS idx_assignments_member ON committee_assignments(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_assignments_committee ON committee_assignments(committee_id);
CREATE INDEX IF NOT EXISTS idx_assignments_congress ON committee_assignments(congress);

-- =============================================================================
-- Bills
-- =============================================================================

CREATE TABLE IF NOT EXISTS bills (
  bill_id             TEXT PRIMARY KEY,
  bill_type           VARCHAR(10) NOT NULL,
  bill_number         INTEGER NOT NULL,
  congress            INTEGER NOT NULL,
  title               TEXT NOT NULL,
  short_title         TEXT,
  introduced_date     DATE,
  latest_action_date  DATE,
  latest_action_text  TEXT,
  policy_area         TEXT,
  bill_url            TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bills_congress ON bills(congress);
CREATE INDEX IF NOT EXISTS idx_bills_introduced ON bills(introduced_date DESC);
CREATE INDEX IF NOT EXISTS idx_bills_type ON bills(bill_type);

-- =============================================================================
-- Bill sponsorships
-- =============================================================================

CREATE TABLE IF NOT EXISTS bill_sponsorships (
  id              SERIAL PRIMARY KEY,
  bill_id         TEXT NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
  bioguide_id     VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  role            VARCHAR(15) NOT NULL CHECK (role IN ('sponsor', 'cosponsor')),
  cosponsored_date DATE,
  UNIQUE(bill_id, bioguide_id, role)
);

CREATE INDEX IF NOT EXISTS idx_sponsorships_member ON bill_sponsorships(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_sponsorships_bill ON bill_sponsorships(bill_id);
CREATE INDEX IF NOT EXISTS idx_sponsorships_role ON bill_sponsorships(role);

-- =============================================================================
-- Campaign finance
-- =============================================================================

CREATE TABLE IF NOT EXISTS campaign_finance (
  id                    SERIAL PRIMARY KEY,
  bioguide_id           VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  fec_candidate_id      VARCHAR(20) NOT NULL,
  election_cycle        INTEGER NOT NULL,
  total_receipts        BIGINT,
  total_disbursements   BIGINT,
  cash_on_hand          BIGINT,
  total_individual      BIGINT,
  total_pac             BIGINT,
  small_individual      BIGINT,
  last_filing_date      DATE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(fec_candidate_id, election_cycle)
);

CREATE INDEX IF NOT EXISTS idx_finance_member ON campaign_finance(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_finance_cycle ON campaign_finance(election_cycle);

-- =============================================================================
-- Top contributors
-- =============================================================================

CREATE TABLE IF NOT EXISTS top_contributors (
  id                SERIAL PRIMARY KEY,
  bioguide_id       VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  election_cycle    INTEGER NOT NULL,
  contributor_name  TEXT NOT NULL,
  contributor_type  VARCHAR(20),
  total_amount      BIGINT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contributors_member ON top_contributors(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_contributors_cycle ON top_contributors(election_cycle);

-- =============================================================================
-- Sync tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS sync_log (
  id              SERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  records_count   INTEGER,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_source ON sync_log(source, entity_type);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_log(status);
CREATE INDEX IF NOT EXISTS idx_sync_started ON sync_log(started_at DESC);
