# Delegation Decoded — Design System & Voice Guide

Extracted from Trevor Brown's existing portfolio of civic tech and data journalism projects: Capitol Releases, Open Cabinet, News Pulse, trevorthewebdeveloper.com, and keithbrowndds.com.

---

## Design DNA: What Trevor's Projects Share

Across all five sites, there is a clear and consistent design sensibility. This is not a generic startup aesthetic. It is **newsroom infrastructure** — functional, precise, and quietly confident.

### Core Principles

1. **Content is the product.** No hero images. No splash pages. No marketing copy above the fold. The data and information ARE the interface. Capitol Releases opens with "100 Senators. One Archive." and immediately shows press releases. Open Cabinet leads with "34 officials. 3,283 transactions. ~$2.7B." The homepage is the product, not an ad for the product.

2. **Radical transparency.** Every project has a methodology section that explains exactly where the data comes from, how it was collected, what the limitations are, and where AI is involved. This is not a nice-to-have — it is load-bearing credibility. Open Cabinet cites specific U.S. Code sections. Capitol Releases discloses scraping rates. This project must do the same.

3. **Restraint over decoration.** No gradients, no shadows heavier than `shadow-sm`, no animated backgrounds. Depth comes from typography scale and spacing, not visual effects. Cards use borders, not shadows. Buttons are solid fills or bordered pills, never gradient CTAs.

4. **Data precision in the typography.** Monospace fonts for numbers (DM Mono). Tabular-nums for alignment. Currency formatted with abbreviations ($2.7B, $14.5K). Dates in consistent formats. This is not optional — sloppy number typography breaks trust in a data product.

5. **Party and entity colors are functional, not decorative.** Blue for Democrat, red for Republican, amber/purple for Independent. These appear as thin border accents, ring indicators around photos, and small dot indicators — never as loud background fills.

---

## Color Palette

### Light Mode (Primary)

| Role | Value | Usage |
|------|-------|-------|
| Background | `white` / `zinc-50` | Page background, card interiors |
| Surface | `white` | Cards, panels |
| Section bg | `stone-50` / `zinc-50` | Alternating sections, footer |
| Text primary | `zinc-900` / `neutral-900` | Headings, body text |
| Text secondary | `zinc-600` / `neutral-500` | Descriptions, labels |
| Text muted | `zinc-400` / `neutral-400` | Timestamps, footnotes |
| Border | `zinc-200` / `neutral-200` | Card borders, dividers |
| Border subtle | `zinc-100` / `neutral-100` | Inner dividers, table rows |
| Democrat | `blue-600` | Party indicators |
| Republican | `red-600` | Party indicators |
| Independent | `purple-500` / `amber-700` | Party indicators |
| Link | `zinc-900` underline | Not blue — underlined dark text |
| Accent | `blue-600` | Rare — used only for primary CTAs |

### Dark Mode (Secondary)

| Role | Value |
|------|-------|
| Background | `zinc-950` / `black` |
| Surface | `zinc-900` |
| Text primary | `zinc-100` |
| Text secondary | `zinc-400` |
| Border | `zinc-800` |

Dark mode exists and works but is not the default. Light mode is the primary presentation — it reads as more institutional and journalistic.

---

## Typography

### Font Stack

| Role | Font | Tailwind Class | Usage |
|------|------|----------------|-------|
| Headlines | Source Serif 4 or DM Serif | `font-serif` | Page titles, section headers — editorial weight |
| Body | DM Sans or Geist | `font-sans` | All body text, labels, navigation |
| Data / Numbers | DM Mono or Geist Mono | `font-mono` | Dollar amounts, counts, dates, bill numbers |

### Scale

| Element | Size | Weight |
|---------|------|--------|
| Page title | `text-3xl` to `text-4xl` | `font-bold` |
| Section heading | `text-xl` | `font-semibold` |
| Card title | `text-sm` to `text-base` | `font-medium` |
| Body text | `text-sm` | `font-normal` |
| Labels / metadata | `text-xs` | `font-medium uppercase` |
| Monospace data | `text-sm` to `text-2xl` | `font-semibold` with `tabular-nums` |

### Key Rule: Serif for Headlines

Capitol Releases and Open Cabinet both use **serif fonts for major headings**. This creates editorial gravitas — the feeling that this is a publication, not an app. Body text stays in sans-serif for readability. This contrast is a defining characteristic of Trevor's civic tech work.

---

## Component Patterns

### Cards

```
- White background, 1px border (zinc-200), rounded-lg
- No shadows (or shadow-sm at most on hover)
- Padding: p-4
- Hover: slight shadow elevation or border color change
- Party indicator: left border (border-l-4) colored by party
```

### Buttons / CTAs

```
- Primary: bg-zinc-900 text-white rounded-lg px-4 py-2 hover:bg-zinc-800
- Secondary: border border-zinc-200 rounded-full px-3 py-1.5 hover:bg-zinc-50
- Links: underline text-zinc-900 hover:text-zinc-600 (NOT blue links)
- Filter pills: rounded-full border px-3 py-1 with count badge in mono
```

### Navigation

```
- Minimal. Left: brand name (text, not logo). Right: 2-4 text links.
- Height: h-14
- Border-bottom only, no background fill
- Links: text-zinc-600 hover:text-zinc-900
- No dropdown menus for MVP
```

### Data Display

```
- Large numbers: text-2xl font-mono font-semibold (e.g., "$14.5M raised")
- Paired with descriptive label below in text-xs text-zinc-500
- Tables: minimal borders, alternating rows via border-b only
- Bill numbers: font-mono bg-zinc-100 px-1.5 py-0.5 rounded
- Party dots: h-2 w-2 rounded-full inline before names
```

### Photos

```
- Congressional headshots: rounded (not fully circular for cards)
- Ring indicator for party: ring-2 ring-blue-600 (or red/purple)
- Sizes: h-16 w-12 in cards, h-32 w-24 in detail pages
- Fallback: zinc-100 background with "?" text
```

---

## Content Voice

### What It Sounds Like

- **Direct and declarative.** "538 members. 50 state delegations. One accountability platform."
- **Precise.** Numbers are specific: "3,891 committee assignments" not "thousands of assignments."
- **Transparent about limitations.** "Campaign finance data reflects FEC filings as reported — quarterly filing schedules mean data can lag by weeks or months."
- **No hype.** Never "powerful insights" or "AI-powered analysis." Instead: "automated change summaries" or "pattern detection."
- **Source attribution is visible.** Footer and about page credit every data source with links.

### What It Does NOT Sound Like

- No startup marketing language ("Unlock the power of...")
- No vague claims ("Get insights into Congress")
- No chatty tone ("Hey there! Welcome to...")
- No emojis in UI content
- No exclamation points
- No "we" unless in about/methodology context

### Headline Patterns

From Capitol Releases: "100 Senators. One Archive."
From Open Cabinet: "34 officials. 3,283 transactions. ~$2.7B in asset value."
From News Pulse: "News before it's news."

**For Delegation Decoded:**
- "538 Members. 50 Delegations. One Accountability Platform."
- Or simpler: "Congressional accountability, organized by state."

---

## About & Methodology Page Requirements

Based on the patterns in Capitol Releases and Open Cabinet, the about/methodology page should be **robust and structured** — not an afterthought. These are the most important pages for editorial credibility.

### Required Sections

1. **What this is** — One paragraph. What the project does and who it's for. No fluff.

2. **Who built it** — Trevor Brown, background in data journalism and web development. Link to portfolio. Brief, not a bio page.

3. **Data sources** — Each source gets its own block:
   - Source name and link
   - What data it provides
   - How it's accessed (API, bulk download, scraping)
   - Update frequency
   - Known limitations specific to that source

4. **Collection process** — Step-by-step pipeline explanation:
   - How member data is ingested from @unitedstates
   - How bills are fetched from Congress.gov API
   - How campaign finance is pulled from FEC API
   - How data is normalized and stored
   - How updates are scheduled

5. **Data quality metrics** — Live stats from the database:
   - Total members tracked
   - Total bills ingested
   - Total campaign finance records
   - Last sync timestamp per source
   - Coverage completeness (e.g., "X of 538 members have FEC data")

6. **Known limitations** — Honest, specific:
   - FEC data lags filing schedules
   - Congress.gov vote data is limited
   - Press releases and statements not yet included
   - AI analysis layer not yet active
   - Historical coverage depth varies

7. **AI transparency** — When AI is added:
   - Exactly where AI is used
   - What model
   - What AI does NOT do (does not fabricate data)
   - How AI outputs are validated

8. **Technical stack** — Brief:
   - Next.js, TypeScript, Tailwind, Neon Postgres, Vercel
   - Drizzle ORM
   - Data ingestion via TypeScript scripts

9. **Open data commitment** — Whether/how the underlying data can be accessed

10. **Contact** — How to reach Trevor for corrections, partnerships, or licensing

### Tone for About/Methodology

Match Open Cabinet's approach: **authoritative yet accessible, defensive transparency.** Assume the reader is a journalist or researcher evaluating whether to trust this data. Every claim should be verifiable. Every limitation should be disclosed before someone discovers it.

---

## Layout & Spacing

### Page Structure

```
Nav (h-14, border-bottom)
├── Main content (max-w-7xl mx-auto px-4 sm:px-6)
│   ├── Breadcrumb (text-sm, mb-6)
│   ├── Page header (mb-8)
│   │   ├── Title (text-3xl font-bold)
│   │   ├── Subtitle (text-zinc-600, mt-1)
│   │   └── Quick stats (text-sm, mt-3)
│   ├── Content sections (mb-10 each)
│   │   ├── Section heading (text-xl font-semibold, mb-4)
│   │   └── Section content
│   └── ...
Footer (border-top, py-6, text-xs)
```

### Spacing Rules

- Between major sections: `mb-10`
- Between heading and content: `mb-4`
- Between cards in a grid: `gap-3`
- Page padding: `px-4 sm:px-6`
- Page vertical padding: `py-8`
- Max content width: `max-w-7xl` for dashboards, `max-w-4xl` for detail pages, `max-w-3xl` for text-heavy pages (about/methodology)

---

## What to Change in the Current Build

The current Delegation Decoded build is functional but doesn't yet match this design system. Key changes needed:

1. **Add a serif font** for page titles and section headings (Source Serif 4 or DM Serif Display)
2. **Add DM Mono** for all numerical data display
3. **Refine the homepage headline** — make it a statement, not a description
4. **Add party-colored ring indicators** around member photos
5. **Make links underlined dark text**, not default blue
6. **Build a robust about/methodology page** with all sections listed above
7. **Add live data quality metrics** to the about page
8. **Ensure monospace + tabular-nums** on all dollar amounts and counts
9. **Add a "Last updated" timestamp** per data source, not just globally
