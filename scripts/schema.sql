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

-- terms shipped without a natural key, so every members.ts run appended another
-- full copy of every term (26 copies by the time it was caught). Collapse the
-- duplicates before claiming the key; rows sharing a key are identical on
-- party/end_date/is_current, so keeping the lowest id loses nothing.
DELETE FROM terms t
  USING terms keep
 WHERE t.bioguide_id = keep.bioguide_id
   AND t.chamber     = keep.chamber
   AND t.state_code  = keep.state_code
   AND t.start_date  = keep.start_date
   AND t.district IS NOT DISTINCT FROM keep.district
   AND t.id > keep.id;

-- Senate terms carry a NULL district, so the key needs NULLS NOT DISTINCT for
-- the ON CONFLICT in members.ts to match them (Postgres 15+).
CREATE UNIQUE INDEX IF NOT EXISTS uq_term
  ON terms(bioguide_id, chamber, state_code, district, start_date)
  NULLS NOT DISTINCT;

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
-- Upsert target for the FEC by-employer ingest.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contributor_member_cycle_name
  ON top_contributors(bioguide_id, election_cycle, contributor_name);

-- =============================================================================
-- Finance committees
-- =============================================================================

-- FEC committees linked to a sitting member's candidacy: the principal
-- campaign committee, other authorized committees, leadership PACs, and
-- joint fundraising committees.
CREATE TABLE IF NOT EXISTS finance_committees (
  committee_id     VARCHAR(20) PRIMARY KEY,
  bioguide_id      VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  fec_candidate_id VARCHAR(20) NOT NULL,
  name             TEXT NOT NULL,
  designation      CHAR(1),   -- P principal, A authorized, D leadership PAC, J joint
  committee_type   CHAR(1),
  first_cycle      INTEGER,
  last_cycle       INTEGER,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fincom_member ON finance_committees(bioguide_id);

-- Per-cycle totals for each linked committee.
CREATE TABLE IF NOT EXISTS committee_finance (
  id                  SERIAL PRIMARY KEY,
  committee_id        VARCHAR(20) NOT NULL REFERENCES finance_committees(committee_id) ON DELETE CASCADE,
  election_cycle      INTEGER NOT NULL,
  total_receipts      BIGINT,
  total_disbursements BIGINT,
  cash_on_hand        BIGINT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(committee_id, election_cycle)
);

-- =============================================================================
-- Ingest cursors
-- =============================================================================

-- Resumable positions for long-running backfills (e.g. the 118th-Congress
-- bills scan), so a re-run continues where the last one stopped instead of
-- re-scanning from offset 0.
CREATE TABLE IF NOT EXISTS ingest_cursors (
  source     TEXT NOT NULL,
  key        TEXT NOT NULL,
  cursor     TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, key)
);

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

-- =============================================================================
-- Disclosure filings (STOCK Act PTRs from House Clerk + Senate eFD)
-- =============================================================================

CREATE TABLE IF NOT EXISTS disclosure_filings (
  id                      SERIAL PRIMARY KEY,
  bioguide_id             VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  chamber                 VARCHAR(10) NOT NULL CHECK (chamber IN ('senate', 'house')),
  filing_type             VARCHAR(20) NOT NULL CHECK (filing_type IN ('PTR', 'Annual', 'Amendment')),
  doc_id                  TEXT NOT NULL,
  filed_date              DATE,
  coverage_period_start   DATE,
  coverage_period_end     DATE,
  pdf_url                 TEXT NOT NULL,
  pdf_hash                CHAR(64),
  parse_status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (parse_status IN ('pending', 'parsed', 'failed', 'review')),
  parse_confidence        INTEGER,
  page_count              INTEGER,
  pipeline_run_id         INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_filing_doc UNIQUE (chamber, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_filings_member ON disclosure_filings(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_filings_filed ON disclosure_filings(filed_date);
CREATE INDEX IF NOT EXISTS idx_filings_status ON disclosure_filings(parse_status);

-- =============================================================================
-- Stock transactions (one row per PTR line item)
-- =============================================================================

CREATE TABLE IF NOT EXISTS stock_transactions (
  id                  SERIAL PRIMARY KEY,
  filing_id           INTEGER NOT NULL REFERENCES disclosure_filings(id) ON DELETE CASCADE,
  bioguide_id         VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  row_index           INTEGER NOT NULL,
  owner_code          VARCHAR(10),
  asset_description   TEXT NOT NULL,
  ticker              VARCHAR(10),
  asset_type          VARCHAR(30),
  tx_type             VARCHAR(20) NOT NULL,
  tx_date             DATE,
  notified_date       DATE,
  amount_range        VARCHAR(40) NOT NULL,
  amount_min          BIGINT,
  amount_max          BIGINT,
  cap_gains_over_200  BOOLEAN DEFAULT false,
  filed_late          BOOLEAN DEFAULT false,
  needs_review        BOOLEAN DEFAULT false,
  confidence          INTEGER,
  pdf_page            INTEGER,
  CONSTRAINT uq_tx UNIQUE (filing_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_tx_member ON stock_transactions(bioguide_id);
CREATE INDEX IF NOT EXISTS idx_tx_ticker ON stock_transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_tx_date ON stock_transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_tx_review ON stock_transactions(needs_review) WHERE needs_review = true;

-- =============================================================================
-- Events dedupe guard
-- generate-events.ts relies on ON CONFLICT DO NOTHING, but the table shipped
-- without a natural-key constraint, so every run re-inserted the same rows.
-- The DELETE clears historic duplicates (keeps the oldest row) and must run
-- before the unique index can build; both are idempotent.
-- =============================================================================

DELETE FROM events e USING events d
  WHERE e.id > d.id
    AND e.event_type = d.event_type
    AND COALESCE(e.related_id, '') = COALESCE(d.related_id, '')
    AND COALESCE(e.state_code, '') = COALESCE(d.state_code, '')
    AND COALESCE(e.bioguide_id, '') = COALESCE(d.bioguide_id, '');

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_identity
  ON events (event_type, COALESCE(related_id, ''), COALESCE(state_code, ''), COALESCE(bioguide_id, ''));

-- =============================================================================
-- Election candidates (FEC statements of candidacy, Form 2)
-- Statutory candidates only: candidate_status = 'C' and has_raised_funds,
-- the standard newsroom cut that drops paper filers. Not a ballot list —
-- ballot access is a state function; disclose that wherever this surfaces.
-- =============================================================================
CREATE TABLE IF NOT EXISTS election_candidates (
  candidate_id         VARCHAR(20) PRIMARY KEY,
  name                 TEXT NOT NULL,
  party                TEXT,
  office               CHAR(1) NOT NULL,            -- 'H' or 'S'
  state_code           CHAR(2) NOT NULL,
  district             INTEGER,                     -- NULL for Senate, 0 for at-large
  election_year        INTEGER NOT NULL,
  incumbent_challenge  CHAR(1),                     -- 'I' incumbent, 'C' challenger, 'O' open seat
  candidate_status     CHAR(1),
  has_raised_funds     BOOLEAN,
  total_receipts       BIGINT,
  first_file_date      DATE,
  last_file_date       DATE,
  fec_load_date        DATE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidates_race
  ON election_candidates(state_code, office, district, election_year);

-- =============================================================================
-- Verification-first election tracker
--
-- election_candidates remains the FEC staging table. The tables below hold
-- state-authority ballot and result records, with append-only status history.
-- Public race pages dual-read these tables and fall back to FEC filings only
-- when a state adapter has not reached verified coverage.
-- =============================================================================

CREATE TABLE IF NOT EXISTS election_sources (
  source_id                    TEXT PRIMARY KEY,
  state_code                   CHAR(2) REFERENCES states(code),
  authority_name               TEXT NOT NULL,
  source_kind                  TEXT NOT NULL,
  source_url                   TEXT NOT NULL,
  adapter_key                  TEXT,
  coverage_status              TEXT NOT NULL DEFAULT 'adapter_pending',
  is_authoritative             BOOLEAN NOT NULL DEFAULT false,
  certification_window_days    INTEGER,
  next_expected_event          DATE,
  next_check_at                TIMESTAMPTZ,
  last_checked_at              TIMESTAMPTZ,
  last_success_at              TIMESTAMPTZ,
  notes                        TEXT,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (coverage_status IN ('verified_ballot', 'verification_pending', 'adapter_pending', 'fec_only'))
);

CREATE INDEX IF NOT EXISTS idx_election_sources_state
  ON election_sources(state_code, coverage_status);
CREATE INDEX IF NOT EXISTS idx_election_sources_due
  ON election_sources(next_check_at) WHERE next_check_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS election_contests (
  contest_id              TEXT PRIMARY KEY,
  election_cycle          INTEGER NOT NULL,
  state_code              CHAR(2) NOT NULL REFERENCES states(code),
  office                  CHAR(1) NOT NULL,
  district                INTEGER,
  senate_class            SMALLINT,
  election_type           TEXT NOT NULL DEFAULT 'regular',
  title                   TEXT NOT NULL,
  current_stage           TEXT,
  coverage_status         TEXT NOT NULL DEFAULT 'fec_only',
  certified_through       DATE,
  next_expected_event     DATE,
  primary_source_id       TEXT REFERENCES election_sources(source_id),
  special_election_url    TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (office IN ('H', 'S')),
  CHECK (election_type IN ('regular', 'special')),
  CHECK (coverage_status IN ('verified_ballot', 'verification_pending', 'fec_only')),
  CHECK ((office = 'H' AND senate_class IS NULL) OR (office = 'S' AND senate_class BETWEEN 1 AND 3)),
  CHECK ((office = 'S' AND district IS NULL) OR office = 'H'),
  CHECK (election_type = 'regular' OR special_election_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_election_contests_state
  ON election_contests(election_cycle, state_code, office, district);
CREATE INDEX IF NOT EXISTS idx_election_contests_coverage
  ON election_contests(coverage_status, state_code);

CREATE TABLE IF NOT EXISTS election_stages (
  stage_id            TEXT PRIMARY KEY,
  contest_id          TEXT NOT NULL REFERENCES election_contests(contest_id) ON DELETE CASCADE,
  stage_kind          TEXT NOT NULL,
  party               TEXT,
  election_date       DATE NOT NULL,
  sequence_number     INTEGER NOT NULL,
  result_status       TEXT NOT NULL DEFAULT 'not_started',
  certified_at        TIMESTAMPTZ,
  source_id           TEXT REFERENCES election_sources(source_id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contest_id, stage_kind, party, sequence_number),
  CHECK (result_status IN ('not_started', 'unofficial', 'certified', 'complete_no_certification'))
);

CREATE INDEX IF NOT EXISTS idx_election_stages_contest
  ON election_stages(contest_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_election_stages_date
  ON election_stages(election_date);

CREATE TABLE IF NOT EXISTS candidate_people (
  person_id             TEXT PRIMARY KEY,
  display_name          TEXT NOT NULL,
  normalized_name       TEXT NOT NULL,
  first_name            TEXT,
  last_name             TEXT,
  bioguide_id           VARCHAR(10) REFERENCES members(bioguide_id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_people_name
  ON candidate_people(normalized_name);

CREATE TABLE IF NOT EXISTS candidate_identifiers (
  person_id          TEXT NOT NULL REFERENCES candidate_people(person_id) ON DELETE CASCADE,
  identifier_type    TEXT NOT NULL,
  identifier_value   TEXT NOT NULL,
  valid_from          DATE,
  valid_to            DATE,
  source_id           TEXT REFERENCES election_sources(source_id),
  PRIMARY KEY (person_id, identifier_type, identifier_value),
  UNIQUE (identifier_type, identifier_value)
);

CREATE TABLE IF NOT EXISTS candidacies (
  candidacy_id          TEXT PRIMARY KEY,
  contest_id            TEXT NOT NULL REFERENCES election_contests(contest_id) ON DELETE CASCADE,
  person_id             TEXT NOT NULL REFERENCES candidate_people(person_id),
  party                 TEXT,
  current_status        TEXT NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  fec_candidate_id      VARCHAR(20),
  verified_source_id    TEXT REFERENCES election_sources(source_id),
  verified_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contest_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_candidacies_contest
  ON candidacies(contest_id, is_active, party);
CREATE INDEX IF NOT EXISTS idx_candidacies_fec
  ON candidacies(fec_candidate_id) WHERE fec_candidate_id IS NOT NULL;

-- Ballot line is repeating because fusion states can list one candidacy on
-- multiple party lines. stage_id is nullable for a line that applies to the
-- current contest generally rather than one election stage.
CREATE TABLE IF NOT EXISTS candidacy_ballot_lines (
  ballot_line_id     TEXT PRIMARY KEY,
  candidacy_id       TEXT NOT NULL REFERENCES candidacies(candidacy_id) ON DELETE CASCADE,
  stage_id           TEXT REFERENCES election_stages(stage_id) ON DELETE CASCADE,
  party_label        TEXT NOT NULL,
  ballot_order       INTEGER,
  source_id          TEXT REFERENCES election_sources(source_id),
  UNIQUE (candidacy_id, stage_id, party_label)
);

CREATE INDEX IF NOT EXISTS idx_ballot_lines_candidacy
  ON candidacy_ballot_lines(candidacy_id, stage_id);

CREATE TABLE IF NOT EXISTS election_source_snapshots (
  snapshot_sha256    CHAR(64) PRIMARY KEY,
  source_id          TEXT NOT NULL REFERENCES election_sources(source_id),
  original_url       TEXT NOT NULL,
  blob_url           TEXT NOT NULL,
  content_type       TEXT NOT NULL,
  content_length     BIGINT NOT NULL,
  etag               TEXT,
  last_modified      TEXT,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_election_snapshots_source
  ON election_source_snapshots(source_id, fetched_at DESC);

-- Append-only history. election_stage_id is deliberately nullable because
-- events such as fec_filed describe a contest-level candidacy, not a stage.
CREATE TABLE IF NOT EXISTS candidate_status_events (
  event_id              TEXT PRIMARY KEY,
  candidacy_id          TEXT NOT NULL REFERENCES candidacies(candidacy_id) ON DELETE CASCADE,
  election_stage_id     TEXT REFERENCES election_stages(stage_id) ON DELETE CASCADE,
  status                TEXT NOT NULL,
  effective_date        DATE,
  observed_at           TIMESTAMPTZ NOT NULL,
  source_id             TEXT NOT NULL REFERENCES election_sources(source_id),
  snapshot_sha256       CHAR(64) REFERENCES election_source_snapshots(snapshot_sha256),
  details               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_status_timeline
  ON candidate_status_events(candidacy_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS election_results (
  result_id            TEXT PRIMARY KEY,
  stage_id             TEXT NOT NULL REFERENCES election_stages(stage_id) ON DELETE CASCADE,
  candidacy_id         TEXT NOT NULL REFERENCES candidacies(candidacy_id) ON DELETE CASCADE,
  total_votes          BIGINT,
  vote_share           NUMERIC(8,5),
  is_winner            BOOLEAN NOT NULL DEFAULT false,
  result_status        TEXT NOT NULL,
  source_id            TEXT NOT NULL REFERENCES election_sources(source_id),
  snapshot_sha256      CHAR(64) REFERENCES election_source_snapshots(snapshot_sha256),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stage_id, candidacy_id),
  CHECK (result_status IN ('unofficial', 'certified', 'complete_no_certification'))
);

CREATE INDEX IF NOT EXISTS idx_election_results_stage
  ON election_results(stage_id, is_winner, total_votes DESC);

-- Ranked-choice and other multi-round tabulations live here. A first-round
-- aggregate can coexist with the final certified round without overwriting it.
CREATE TABLE IF NOT EXISTS election_result_rounds (
  result_id          TEXT NOT NULL REFERENCES election_results(result_id) ON DELETE CASCADE,
  round_number       INTEGER NOT NULL,
  votes              BIGINT,
  vote_share         NUMERIC(8,5),
  is_continuing      BOOLEAN,
  is_eliminated      BOOLEAN,
  PRIMARY KEY (result_id, round_number)
);

CREATE TABLE IF NOT EXISTS candidate_campaign_sites (
  candidacy_id         TEXT PRIMARY KEY REFERENCES candidacies(candidacy_id) ON DELETE CASCADE,
  site_url             TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verified_source_url TEXT,
  last_crawled_at      TIMESTAMPTZ,
  content_sha256       CHAR(64),
  crawl_error          TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (verification_status IN ('pending', 'verified', 'rejected', 'blocked'))
);

-- A current FEC filing can be authoritative evidence that no campaign website
-- is on file. Keep a blocked discovery row without inventing a site URL.
ALTER TABLE candidate_campaign_sites
  ALTER COLUMN site_url DROP NOT NULL;

-- Campaign pages are untrusted input. Every fetched page is preserved as an
-- immutable private blob before extraction so a published claim can be traced
-- to the exact bytes the extractor saw.
CREATE TABLE IF NOT EXISTS candidate_site_snapshots (
  snapshot_id          TEXT PRIMARY KEY,
  candidacy_id         TEXT NOT NULL REFERENCES candidacies(candidacy_id) ON DELETE CASCADE,
  page_url             TEXT NOT NULL,
  final_url            TEXT NOT NULL,
  content_sha256       CHAR(64) NOT NULL,
  blob_url             TEXT NOT NULL,
  content_type         TEXT NOT NULL,
  content_length       BIGINT NOT NULL,
  etag                 TEXT,
  last_modified        TEXT,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidacy_id, page_url, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_candidate_site_snapshots_candidacy
  ON candidate_site_snapshots(candidacy_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS candidate_site_claims (
  claim_id             TEXT PRIMARY KEY,
  candidacy_id         TEXT NOT NULL REFERENCES candidacies(candidacy_id) ON DELETE CASCADE,
  claim_type           TEXT NOT NULL,
  claim_text           TEXT NOT NULL,
  source_url           TEXT NOT NULL,
  source_quote         TEXT NOT NULL,
  source_snapshot_id   TEXT NOT NULL REFERENCES candidate_site_snapshots(snapshot_id),
  extractor_provider   TEXT NOT NULL,
  extractor_model      TEXT,
  confidence           INTEGER,
  review_status        TEXT NOT NULL DEFAULT 'needs_review',
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          TEXT,
  extracted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  CHECK (review_status IN ('needs_review', 'verified', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_candidate_claims_candidacy
  ON candidate_site_claims(candidacy_id, review_status);

ALTER TABLE candidate_site_claims
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE candidate_site_claims
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

CREATE TABLE IF NOT EXISTS candidate_prior_service (
  service_id          TEXT PRIMARY KEY,
  person_id           TEXT NOT NULL REFERENCES candidate_people(person_id) ON DELETE CASCADE,
  office_title        TEXT NOT NULL,
  jurisdiction        TEXT,
  started_on          TEXT,
  ended_on            TEXT,
  source_url          TEXT NOT NULL,
  source_quote        TEXT NOT NULL,
  source_snapshot_id  TEXT NOT NULL REFERENCES candidate_site_snapshots(snapshot_id),
  extractor_provider  TEXT NOT NULL,
  extractor_model     TEXT NOT NULL,
  extracted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         TEXT,
  CHECK (verification_status IN ('needs_review', 'verified', 'rejected'))
);

-- Campaign pages often state only a year or year-month. Preserve that source
-- precision instead of inventing a calendar day to satisfy PostgreSQL DATE.
ALTER TABLE candidate_prior_service
  ALTER COLUMN started_on TYPE TEXT USING started_on::text;
ALTER TABLE candidate_prior_service
  ALTER COLUMN ended_on TYPE TEXT USING ended_on::text;

CREATE INDEX IF NOT EXISTS idx_candidate_service_person
  ON candidate_prior_service(person_id, verification_status);

ALTER TABLE candidate_prior_service
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE candidate_prior_service
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- Official House/Senate biography research. The member website itself comes
-- from the @unitedstates current-legislator record and must remain on a
-- house.gov or senate.gov host. Extracted facts are never public until review.
CREATE TABLE IF NOT EXISTS member_official_sites (
  bioguide_id          VARCHAR(10) PRIMARY KEY REFERENCES members(bioguide_id) ON DELETE CASCADE,
  site_url             TEXT NOT NULL,
  biography_url        TEXT,
  site_type            TEXT NOT NULL DEFAULT 'official_congressional',
  cms_family           TEXT,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  verified_source_url TEXT NOT NULL,
  last_crawled_at      TIMESTAMPTZ,
  content_sha256       CHAR(64),
  crawl_error          TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (site_type = 'official_congressional'),
  CHECK (verification_status IN ('verified', 'rejected', 'blocked'))
);

CREATE TABLE IF NOT EXISTS member_site_snapshots (
  snapshot_id          TEXT PRIMARY KEY,
  bioguide_id          VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  page_url             TEXT NOT NULL,
  final_url            TEXT NOT NULL,
  content_sha256       CHAR(64) NOT NULL,
  blob_url             TEXT NOT NULL,
  content_type         TEXT NOT NULL,
  content_length       BIGINT NOT NULL,
  etag                 TEXT,
  last_modified        TEXT,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bioguide_id, page_url, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_member_site_snapshots_member
  ON member_site_snapshots(bioguide_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS member_biography_claims (
  claim_id             TEXT PRIMARY KEY,
  bioguide_id          VARCHAR(10) NOT NULL REFERENCES members(bioguide_id) ON DELETE CASCADE,
  claim_text           TEXT NOT NULL,
  source_url           TEXT NOT NULL,
  source_quote         TEXT NOT NULL,
  source_snapshot_id   TEXT NOT NULL REFERENCES member_site_snapshots(snapshot_id),
  extractor_provider   TEXT NOT NULL,
  extractor_model      TEXT NOT NULL,
  confidence           INTEGER,
  review_status        TEXT NOT NULL DEFAULT 'needs_review',
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          TEXT,
  extracted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  CHECK (review_status IN ('needs_review', 'verified', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_member_biography_claims_member
  ON member_biography_claims(bioguide_id, review_status);

ALTER TABLE member_biography_claims
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE member_biography_claims
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- Biography facts arrive as one undifferentiated list, which reads as a wall
-- of quotes on a profile and gives the assistant no way to answer "where did
-- they go to school" without scanning everything. fact_type groups them.
-- Nullable because it is assigned by a separate classification pass, and a
-- fact whose category is genuinely unclear stays uncategorized rather than
-- being forced into a bucket.
ALTER TABLE member_biography_claims
  ADD COLUMN IF NOT EXISTS fact_type TEXT;
ALTER TABLE member_biography_claims
  ADD COLUMN IF NOT EXISTS fact_type_source TEXT;

CREATE INDEX IF NOT EXISTS idx_member_biography_claims_type
  ON member_biography_claims(bioguide_id, fact_type);

-- =============================================================================
-- /ask assistant: rate-limit counters + answer cache
-- =============================================================================

CREATE TABLE IF NOT EXISTS ask_rate_limits (
  bucket        TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS ask_cache (
  question_norm  TEXT NOT NULL,
  state_code     CHAR(2) NOT NULL,
  district       INTEGER NOT NULL DEFAULT -1,
  answer         TEXT NOT NULL,
  trace          JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_norm, state_code, district)
);

CREATE INDEX IF NOT EXISTS idx_ask_cache_created ON ask_cache(created_at);

-- Per-question audit log for /ask. One row per request that reached the
-- engine (including cache hits, rate-limit rejections, and failures), so any
-- answer the assistant ever served can be reproduced: what was asked, in what
-- scope, which records the tool loop checked, which provider/model answered,
-- what it cost, and how the request ended. ip_hash is a keyed HMAC — the raw
-- address is never stored. Rows expire after 90 days via the same
-- opportunistic cleanup that prunes ask_rate_limits and ask_cache.
CREATE TABLE IF NOT EXISTS ask_log (
  id                        BIGSERIAL PRIMARY KEY,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash                   TEXT,
  question                  TEXT NOT NULL,
  scope_type                TEXT NOT NULL,           -- national | state | member
  state_code                CHAR(2),
  district                  INTEGER,
  bioguide_id               TEXT,
  history_turns             INTEGER NOT NULL DEFAULT 0,
  -- Terminal grounded status from the model (answered | not_found |
  -- out_of_scope | declined), or 'error' when no grounded answer was served.
  outcome                   TEXT NOT NULL,
  error_class               TEXT,                    -- rate_limited | provider_unavailable | timeout | ...
  http_status               INTEGER,
  cache_hit                 BOOLEAN NOT NULL DEFAULT false,
  provider                  TEXT,
  model                     TEXT,
  fallback_used             BOOLEAN NOT NULL DEFAULT false,
  refusal_category          TEXT,                    -- Anthropic stop_details.category on classifier refusals
  latency_ms                INTEGER,
  input_tokens              INTEGER,
  cached_input_tokens       INTEGER,
  cache_write_input_tokens  INTEGER,
  output_tokens             INTEGER,
  tool_calls                INTEGER,
  trace                     JSONB,
  citation_count            INTEGER,
  -- Share of answer sentences carrying a server-validated citation marker.
  citation_coverage         REAL,
  answer                    TEXT,
  prompt_version            TEXT
);

CREATE INDEX IF NOT EXISTS idx_ask_log_created ON ask_log(created_at);
CREATE INDEX IF NOT EXISTS idx_ask_log_outcome ON ask_log(outcome, created_at);
