# AI-Assisted UK Self Assessment Filing App — Full Build Specification

**Version:** 1.0
**Status:** Build-ready spec. Hand this back to the builder as-is; it is intended to be sufficient to develop the app without further research.
**Scope of v1:** Self Assessment for UK-based salaried foreign nationals (the SA109 residence / SA106 foreign-income niche), filed by an authorised agent, via the legacy Self Assessment online rail, with a migration path to Making Tax Digital (MTD) for Income Tax.

---

## 0. How to use this document

This spec is written so a developer (or an AI coding agent) can build the product end to end. It states the regulatory ground truth, the architecture, the calculation engine and MCP contracts, the data model, the LLM orchestration rules, the HMRC integration, the security posture, and a thorough testing and HMRC-compliance plan.

Two hard requirements shaped every decision:

1. **The numbers must be exactly right.** LLMs cannot be trusted with arithmetic or with applying tax rules. All computation is done by deterministic calculation tools exposed over MCP. The LLM never does maths and never invents a rule. Correctness is guaranteed by a golden-vector test suite plus reconciliation against HMRC's own calculation.
2. **The build must be self-contained.** Phase 0 vendors every HMRC artefact (XSD schemas, calculation methodology, box-number mappings, fraud-prevention header spec) into the repo. After Phase 0, no internet fetch is required to build or run. Appendix A lists exactly what to vendor and from where.

Anything marked **[VERIFY-AT-BUILD]** is a value that changes yearly or is version-sensitive and must be confirmed against the vendored HMRC artefacts before coding the relevant module. It is not a gap in the design; it is a rates/threshold input.

---

## 1. Product overview

### 1.1 The concept

A web app that feels like a chat. On the **right** pane the user (an agent, or in a later self-serve mode a taxpayer) has a conversation that walks through a full Self Assessment return. On the **left** pane a live tax computation updates after every answer, showing every line of the calculation and a badge confirming the figures reconcile with HMRC's own calculation. When the return is complete and reviewed, the app files it directly to HMRC and returns the submission receipt.

### 1.2 Design principles

- **Deterministic maths, conversational everything-else.** The LLM elicits, maps answers to the return schema, explains, and orchestrates. Calculation tools compute. These roles never blur.
- **Reconcile, do not trust.** Where HMRC exposes a calculation API (MTD), the app computes locally *and* asks HMRC to compute, then blocks submission on any mismatch. Where it does not (legacy SA), the golden-vector suite and tax-year config are the guarantee.
- **Fail closed.** On uncertainty, missing data, validation error, or calc mismatch, the app refuses to file and surfaces the issue. It never guesses to get a return submitted.
- **Privacy by construction.** Personal data is minimised and pseudonymised before it reaches the model. The model runs on Vertex AI under no-training, zero-retention terms in a UK/EU region.
- **Auditable.** Every submission, every calc version, every model decision that affects a figure is logged in an append-only trail.

### 1.3 Users and roles

- **Agent (primary v1 user):** an authorised HMRC agent filing for clients. All filings go through agent authorisation.
- **Client (taxpayer):** the individual whose return is filed. In v1 the client supplies documents and confirms; they do not self-file.
- **Reviewer (optional):** a second agent who signs off before submission (four-eyes control).
- **Admin:** manages credentials, tax-year config, and audit access.

### 1.4 Explicitly out of scope for v1

Corporation Tax (CT600), VAT, partnership/trust/estate returns, in-year MTD quarterly updates, and bookkeeping. The architecture leaves room for these; the build does not include them.

---

## 2. Regulatory and filing model (ground truth)

Everything in this section is the reason the architecture is shaped as it is. Do not deviate without re-checking against the vendored HMRC artefacts.

### 2.1 Two filing rails

HMRC runs two independent submission mechanisms:

| Rail | Format | Who computes the tax | Used in v1 |
|---|---|---|---|
| **Legacy Self Assessment (SA) online** | XML (GovTalk envelope, IRmark) submitted to the transaction engine | **The software** computes the tax (the SA110 calculation). HMRC validates the XML and the figures. | **Yes — primary for now.** |
| **MTD for Income Tax (ITSA)** | REST/JSON over OAuth2, per-source APIs plus a Calculation API | **HMRC** computes the tax via the Calculation API; software submits income data and retrieves the calculation. | Migration target (see 2.3). |

The SA109 residence/remittance-basis population, which is this product's niche, files on the **legacy SA rail** today. That rail requires the software to produce the full return including the tax calculation, so the calculation engine is not optional convenience — it is the submission.

### 2.2 Why legacy first

Taxpayers who complete SA109 pages are exempt from MTD until at least the 2027/28 tax year. MTD for ITSA mandates by income level on this timeline: over £50,000 from April 2026, over £30,000 from April 2027, over £20,000 from April 2028. The niche client base (residence/foreign-income cases) therefore stays on legacy SA for the near term, which is why v1 targets the legacy XML rail.

### 2.3 MTD migration path

Design the HMRC integration behind an interface (`FilingProvider`) with two implementations: `LegacySaXmlProvider` (v1) and `MtdItsaProvider` (v2). The calculation engine is shared. When SA109 cases enter MTD, the provider switches; the engine additionally cross-checks against HMRC's Calculation API (which becomes available for those taxpayers) before final declaration.

### 2.4 HMRC recognition and production access

- Register the application on the **HMRC Developer Hub** to obtain sandbox `client_id` / `client_secret`.
- To reach **production** the software must meet HMRC's minimum functionality standards and pass HMRC's required test scenarios. Production credentials are granted after HMRC review; historically this review is slow and iterative, so start it early (Phase 0) and treat it as a critical-path dependency.
- Successful recognition places the product on HMRC's list of recognised commercial software suppliers.

### 2.5 Agent authorisation model

- Filing for clients requires the agent to be authorised for each client. The **Agent Authorisation API** replaces the paper 64-8: create an authorisation request, check status, cancel, or query. The client accepts the request.
- Under multiple-agent support there are two agent types. A **main agent** has full access, can make final declarations and Self Assessment filings, and can view calculations. A **supporting agent** can submit in-year updates but cannot make final declarations, do SA filings, or view calculations. **v1 must operate as the main agent.**
- The agent's ASA and agent code (from the earlier practice setup) underpin this. The app authenticates the agent via OAuth2 and acts on the client's behalf under the granted authorisation.

### 2.6 Fraud-prevention headers (legally mandatory)

- HMRC requires a specific set of `Gov-Client-*` and `Gov-Vendor-*` HTTP headers on API requests. Submitting these is a legal requirement for the ITSA (MTD) and VAT (MTD) APIs, and HMRC is extending the requirement across APIs. **Persistently sending missing or incorrect headers can result in fines and being blocked from HMRC APIs.**
- The exact header set depends on the **connection method**. This app is **"web application via server"** (browser front end, server-side backend calling HMRC). The full header list for that method is in **Appendix D**.
- Some header values must be collected **in the browser immediately before each request** (timezone, screens, window size, browser plugins, do-not-track, local IPs plus a collection timestamp, JS user agent, a generated device ID). Others are collected server-side (public IP and port, forwarding chain, vendor identifiers, multi-factor status, user identifiers).
- HMRC provides a **Test Fraud Prevention Headers API** (the header validator). The build must pass it with **zero errors** and must clear all advisories/warnings. This is an acceptance gate.

### 2.7 IRmark (legacy rail only)

Legacy SA XML submissions are wrapped in a GovTalk message envelope and carry an **IRmark** — a digest computed over the message body to a defined algorithm. The submission is rejected if the IRmark is wrong. Implement IRmark generation exactly per the HMRC/GovTalk specification vendored in Phase 0 (Appendix A). Do not hand-roll the algorithm from memory.

### 2.8 Sandbox and test scenarios

- HMRC provides a **sandbox** with synthetic data. Specific behaviours are triggered by the `Gov-Test-Scenario` request header (success, named validation errors, server errors).
- Some sandbox APIs are **stateful**: submitted test data can be retrieved from other endpoints. Sandbox retains submitted test data for **7 days**.
- All integration and reconciliation testing runs against sandbox before any live call.

---

## 3. System architecture

### 3.1 Components

```
                         ┌─────────────────────────────────────────────┐
                         │  Browser (React SPA)                         │
                         │  • Left pane: live computation view          │
                         │  • Right pane: chat + doc upload             │
                         │  • Fraud-header browser data collector       │
                         └───────────────┬─────────────────────────────┘
                                         │ HTTPS (TLS 1.2+)
                                         ▼
                         ┌─────────────────────────────────────────────┐
                         │  BFF / Orchestrator service (server)         │
                         │  • Session + conversation state machine      │
                         │  • PII minimisation / pseudonymisation layer │
                         │  • Gemini function-calling loop              │
                         │  • MCP client (bridges tools to Gemini)      │
                         └───┬───────────────┬───────────────┬──────────┘
                             │               │               │
              MCP (stdio/HTTP)               │ Vertex SDK    │ internal API
                             ▼               ▼               ▼
        ┌────────────────────────────┐ ┌───────────────┐ ┌───────────────────────────┐
        │ Calculation MCP servers     │ │ Vertex AI      │ │ HMRC integration service   │
        │ (pure, deterministic)       │ │ Gemini         │ │ • OAuth2 + token store      │
        │ • uk-income-tax             │ │ (no-train,     │ │ • Agent authorisation       │
        │ • uk-nic                    │ │  ZDR, UK/EU    │ │ • Fraud-header assembly      │
        │ • uk-cgt                    │ │  region)       │ │ • Legacy SA XML + IRmark     │
        │ • uk-residence (SRT/FIG)    │ └───────────────┘ │ • MTD provider (v2)          │
        │ • uk-foreign (FTCR/DTA)     │                   │ • Sandbox/prod switch        │
        │ • uk-reliefs-charges        │                   └──────────────┬──────────────┘
        │ • uk-payments-on-account    │                                  │ HTTPS
        │ • uk-assembler (top-level)  │                                  ▼
        └────────────────────────────┘                         ┌───────────────┐
                             ▲                                  │ HMRC APIs      │
                             │ shares                           │ (sandbox/prod) │
        ┌────────────────────────────┐                         └───────────────┘
        │ tax-core (pure TS package)  │
        │ deterministic engine + rules│
        └────────────────────────────┘

   Persistence: PostgreSQL (Cloud SQL, UK/EU) • GCS (CMEK) for docs •
   Secret Manager • append-only audit log • Redis (session cache, optional)
```

### 3.2 Data flow for a filing session

1. Agent authenticates (OAuth2 to HMRC for the HMRC scope; app login with MFA for the app itself). Selects or creates a client; confirms agent authorisation exists (Agent Authorisation API) or initiates it.
2. Optional pre-population: pull HMRC-held data (employment history, benefits, income) via the pre-population APIs to seed the return.
3. Conversation begins. The state machine drives phases (Section 6.4). The LLM asks questions, the user answers or uploads documents (P60/P45/P11D), extracted values are mapped into the **return object** (Section 5).
4. After every change to the return object, the orchestrator calls `uk-assembler.compute_full_return`. The result populates the left pane. No figure on screen is ever produced by the LLM.
5. At review, the app runs all validations (Section 8.6). For MTD, it triggers HMRC's calculation and reconciles. For legacy, it re-runs the golden-vector self-check on the engine version and confirms the tax-year config hash.
6. On agent (and reviewer) sign-off, the HMRC integration service assembles fraud headers, builds the submission (legacy XML + IRmark, or MTD calls), submits, polls for the result, and stores the receipt. The audit trail records everything.

### 3.3 Tech stack (recommended, cohesive)

- **Language:** TypeScript across frontend, orchestrator, MCP servers, and the tax-core package. One language reduces schema drift.
- **Frontend:** React + Vite, TypeScript, Tailwind, TanStack Query (server state), Zustand (UI state), shadcn/ui components, react-hook-form + zod for any structured inputs.
- **Orchestrator/BFF:** Node.js + NestJS (or Fastify) in TypeScript.
- **MCP:** `@modelcontextprotocol/sdk` (TypeScript) for the calculation servers; orchestrator is the MCP client.
- **LLM:** Vertex AI Gemini via `@google-cloud/vertexai`. Function calling bridged to MCP tools.
- **Money maths:** integer minor units (pence) internally, or `decimal.js` / `big.js` with explicit rounding modes. **Never IEEE floats for money.**
- **HMRC XML:** a maintained XML builder plus a dedicated IRmark implementation per the vendored GovTalk spec.
- **Datastore:** PostgreSQL on GCP Cloud SQL, UK (`europe-west2`) or EU region, encryption at rest, column-level encryption for the most sensitive fields.
- **Object storage:** GCS with customer-managed encryption keys (CMEK) for uploaded documents; lifecycle rules for retention.
- **Secrets:** GCP Secret Manager (HMRC client secret, OAuth tokens, DB creds).
- **Hosting:** GCP Cloud Run in the same UK/EU region as Vertex and the database, to keep data residency consistent.
- **App auth:** GCP Identity Platform (or Auth0), MFA mandatory (also feeds the `Gov-Client-Multi-Factor` header).
- **Observability:** Cloud Logging/Monitoring; structured logs with PII scrubbing.

---

## 4. Calculation engine and MCP design (the heart of the product)

### 4.1 Why MCP tools, not the LLM

The LLM's strength is language, not arithmetic or rule application, and it can be confidently wrong. So the entire computation lives in a pure, deterministic package (`tax-core`) wrapped by MCP servers. Gemini calls these tools via function calling. The model chooses *which* tool and *with what inputs*; the tool decides the numbers. This gives HMRC-grade determinism and makes the maths independently testable and auditable.

### 4.2 Determinism requirements (apply to every tool)

- **Pure functions.** No network, no clock (tax year is an explicit input), no randomness, no hidden state. Same inputs → identical outputs, always.
- **Money as minor units.** Represent every monetary value as integer pence (or `Decimal`). Convert at the edges only.
- **HMRC rounding, exactly.** Implement HMRC's rounding conventions from the vendored calculation methodology (for example, income figures and specific reliefs have defined rounding directions). Rounding is a per-step, specified operation, not a display concern. **[VERIFY-AT-BUILD]** against the methodology.
- **Tax-year scoped.** Every rate, threshold, band, and allowance is loaded from a versioned `TaxYearConfig` (Section 4.7). No literal rate is hard-coded in logic.
- **Explainable output.** Every tool returns not just a total but the itemised working (bands, amounts, rates applied), so the left pane can show the full computation and so results are auditable line by line.
- **Versioned.** Every result carries `{ taxYear, methodologyVersion, engineVersion, configHash }`.

### 4.3 MCP server inventory and responsibilities

Group tools into domain servers for testability. They may be deployed as one MCP server exposing all tools or several; the domain boundary is what matters.

| MCP server | Responsibility |
|---|---|
| `uk-income-tax` | Personal allowance and taper, non-savings/savings/dividend banding, starting rate for savings, personal savings allowance, dividend allowance, Scottish/Welsh rate variants, gift aid and pension band extension, marriage/blind-person allowances. |
| `uk-nic` | Class 2 / Class 4 NIC in the SA context (relevant if a client has self-employment; employees' Class 1 is via PAYE and is informational). |
| `uk-cgt` | Capital gains: pooling inputs already netted, annual exempt amount, rates by remaining basic-rate band, residential vs other rates, losses (in-year and brought-forward), Business Asset Disposal Relief. |
| `uk-residence` | Statutory Residence Test evaluation, split-year case determination (the eight cases), FIG-regime eligibility (four-year regime for qualifying new arrivers). Produces status flags consumed by other tools and the SA109 mapping. |
| `uk-foreign` | Foreign Tax Credit Relief (lower of foreign tax paid, treaty-capped amount, and UK tax on that income), double-taxation-agreement rate caps and tie-breakers (parameterised by treaty; UK–India first). |
| `uk-reliefs-charges` | High Income Child Benefit Charge, Student Loan repayment by plan type, pension annual-allowance charge, and other SA100 additional charges. |
| `uk-payments-on-account` | Payments on account for the following year and balancing payment. |
| `uk-assembler` | The top-level orchestrator. Takes the full return object, runs all sub-calculations **in HMRC's prescribed order**, and returns the complete computation (the SA110-equivalent), every line, plus the version block. This is the single source the left pane renders and the object reconciled against HMRC. |

### 4.4 Calculation order (the assembler)

The assembler must follow HMRC's computation sequence, because tax is path-dependent (allowances, band usage, and reliefs interact). The canonical order, to be confirmed against the vendored methodology **[VERIFY-AT-BUILD]**:

1. Determine residence/domicile/FIG status (`uk-residence`) → drives which income is in scope and SA109 outputs.
2. Total income by category (non-savings, savings, dividends), applying FIG/remittance treatment where relevant.
3. Deduct reliefs and the personal allowance (with £100,000+ taper), extend bands for gift aid and relievable pension contributions.
4. Compute income tax by band and category in the correct precedence (non-savings, then savings with starting-rate and PSA, then dividends with the dividend allowance).
5. Compute Capital Gains Tax (`uk-cgt`) using any remaining basic-rate band.
6. Apply Foreign Tax Credit Relief (`uk-foreign`).
7. Apply charges: HICBC, student loan, pension annual-allowance charge (`uk-reliefs-charges`).
8. Compute NIC if applicable (`uk-nic`).
9. Reconcile tax already paid (PAYE, CIS, tax deducted) to reach the balance.
10. Compute payments on account and the balancing payment (`uk-payments-on-account`).

### 4.5 Tool contract pattern

Every tool takes a typed input object and returns a typed result with itemised working. Example (illustrative; full schemas are generated from `tax-core` types and exposed as MCP JSON Schemas):

```jsonc
// tool: uk-income-tax.compute_income_tax
// input
{
  "taxYear": "2025-26",
  "region": "UK",                 // UK | SCOTLAND | WALES
  "nonSavingsIncome": 8500000,    // pence
  "savingsIncome": 120000,
  "dividendIncome": 250000,
  "giftAidGrossedUp": 0,
  "relievablePensionContributions": 0,
  "marriageAllowance": "NONE",    // NONE | TRANSFEROR | RECIPIENT
  "blindPersonsAllowance": false,
  "figAdjustedIncomeExclusions": 0 // income removed under FIG treatment
}
// output
{
  "personalAllowance": 1257000,        // after taper
  "bands": [
    { "name": "basic", "category": "nonSavings", "amount": 3770000, "rate": 0.20, "tax": 754000 }
    // ...savings and dividend bands...
  ],
  "incomeTaxTotal": 2012345,
  "working": [ /* human-readable steps for the left pane */ ],
  "version": { "taxYear": "2025-26", "methodologyVersion": "…", "engineVersion": "…", "configHash": "…" }
}
```

### 4.6 Reconciliation strategy (how "100% match HMRC" is achieved)

Three layers, in order of strength:

1. **Golden-vector suite (always on, CI gate).** A large, versioned set of input→expected-output cases per tax year, covering every band boundary, taper edge, allowance interaction, CGT scenario, FTCR case, and SA109/FIG situation. Expected values are established from HMRC worked examples (helpsheets), HMRC's online calculation, and (for MTD-representable cases) HMRC's Calculation API. The engine must reproduce every vector exactly. A single mismatch fails the build.
2. **HMRC Calculation API reconciliation (MTD-representable cases).** For any return whose income sources are representable in MTD, submit the synthetic case to HMRC's **Individual Calculations API** in sandbox, retrieve HMRC's calculation, and assert the engine matches it line by line. Run this as a CI job over a broad matrix. This directly validates the engine against HMRC's own logic.
3. **Live reconciliation at filing (MTD provider, v2).** For MTD taxpayers, before final declaration, trigger HMRC's calculation and compare to the engine. **Block submission on any mismatch.** For the legacy provider there is no live HMRC calculation, so layers 1 and 2 plus the tax-year config hash are the guarantee, and the left pane badge reads "computed per HMRC methodology vX" rather than "reconciled with HMRC ✓".

### 4.7 Tax-year configuration

`TaxYearConfig` is a versioned data file (checked into the repo, one per year) holding every rate, threshold, band width, allowance, and CGT/dividend/savings figure, plus the region variants (Scotland, Wales). Logic reads only from config. Each config has a hash; the assembler embeds it in every result. Adding a new tax year is a data change plus a new golden-vector set, not a logic rewrite. **[VERIFY-AT-BUILD]** every figure against the vendored methodology for that year.

---

## 5. Data model

### 5.1 Return object

A single strongly-typed `Return` object is the source of truth for a filing. It mirrors the SA100 core plus the supplementary pages in scope:

- `SA100` core (income summary, reliefs, allowances, tax already paid).
- `SA102` employment (one per employment/directorship): pay, tax deducted, benefits, expenses.
- `SA106` foreign: foreign income by type, foreign tax paid, FTCR claims, remittance-basis elements.
- `SA108` capital gains: disposals, proceeds, costs, gains/losses, reliefs.
- `SA109` residence: SRT result, split-year case, domicile, FIG/remittance elections, OWR.
- `SA101` additional information as needed (share schemes, other charges).
- Derived: the computed `Computation` (the assembler output), never user-editable.

Each field maps to a specific SA return box and, for MTD, to the corresponding MTD API parameter.

### 5.2 Box-number mapping

HMRC publishes a mapping between MTD API parameters and SA return box numbers as CSV files. **Vendor these CSVs in Phase 0** (Appendix A) and generate a typed mapping table from them, so the return object, the legacy XML boxes, and the MTD parameters stay in lockstep. Never transcribe box numbers by hand.

### 5.3 Core entities (persistence)

- `Agent` (ASA reference, agent code reference, OAuth token handle in Secret Manager).
- `Client` (taxpayer identity, NINO, UTR, authorisation status).
- `Return` (per client per tax year; the object above; status: draft → review → ready → submitting → submitted → accepted/rejected).
- `Computation` (immutable snapshots, versioned; the figures shown and filed).
- `Submission` (rail used, request/response metadata, IRmark or MTD calc ID, receipt, timestamps).
- `Document` (uploaded P60/P45/P11D; GCS reference; extracted values; retained per policy).
- `AuditEvent` (append-only; who/what/when, calc version, model tool calls affecting figures).

Retention: keep client records and submissions for **at least six years** (tax record-keeping and AML). Encrypt sensitive columns; documents in CMEK-encrypted GCS with lifecycle rules.

---

## 6. LLM orchestration layer

### 6.1 The model's job, and its hard limits

**The model may:** decide the next question, interpret free-text and documents into structured field values, choose and call calculation tools with correct arguments, explain figures and rules in plain language, flag missing or contradictory information.

**The model must never:** perform arithmetic, apply a tax rule from its own knowledge, assert a figure not returned by a calc tool, decide residence status or relief eligibility itself (it calls `uk-residence`/`uk-foreign`), or authorise a submission. Any number in the UI or the filing must trace to a calc-tool result.

### 6.2 Tool bridging (Gemini ↔ MCP)

- Expose each MCP tool as a Gemini `functionDeclaration` (auto-generate declarations from MCP JSON Schemas).
- On a Gemini function call, the orchestrator invokes the MCP tool, returns the structured result to the model, and loops.
- The model receives tool results as authoritative and must reflect them verbatim (no re-derivation). Enforce with a post-check: if a model message contains a monetary figure that does not match the latest tool output, discard and regenerate.

### 6.3 Structured extraction and validation

- For document uploads (P60/P45/P11D), run OCR/structured extraction (Document AI or an equivalent), then have the model map extracted values into typed fields. Every mapped value is shown to the user for confirmation before it enters the return.
- Validate every field with zod schemas at the boundary. Reject/re-ask on type or range violations. The model never writes directly to the return; it proposes typed values that pass validation.

### 6.4 Conversation state machine

Drive the session through explicit phases; the model operates within the current phase and cannot skip ahead to submission:

1. **Onboard** — identify client, confirm/initiate agent authorisation, pull pre-population data.
2. **Residence determination** — gather SRT inputs; call `uk-residence`; fix status, split-year case, FIG/remittance treatment (SA109).
3. **Income capture** — employment (SA102), foreign (SA106), gains (SA108), other; documents and confirmations.
4. **Reliefs and charges** — FTCR, pension, gift aid, HICBC, student loan, etc.
5. **Review** — full computation shown; run all validations; MTD reconciliation or legacy self-check; list anything blocking.
6. **Declare** — capture the taxpayer/agent declaration; require explicit confirmation; enforce four-eyes if configured.
7. **Submit** — hand to the HMRC integration service; show progress; store receipt.

Persist state so a session can pause and resume. Every phase transition is an audit event.

### 6.5 Privacy in the model path

- **Minimise then send.** Before any Vertex call, strip or pseudonymise direct identifiers (name, NINO, UTR, DoB, addresses) that the model does not need to reason. The model reasons over amounts, categories, and residence facts; it does not need the NINO to ask the next question. Re-associate identifiers server-side only when building the actual HMRC submission.
- **No raw documents to the model unless required.** Prefer sending extracted, confirmed fields over raw document images.
- Vertex configuration (Section 9.3) ensures no training and no retention beyond what is contractually minimised.

### 6.6 System-prompt design (principles, not verbatim text)

The system prompt must: state the hard limits (6.1); instruct the model to always call a calc tool rather than compute; instruct it to ask one clear question at a time; require it to surface uncertainty and never fabricate; forbid it from confirming a submission; and give it the current phase and the current return/computation snapshot as context each turn. Keep the tone plain and practitioner-appropriate.

---

## 7. Frontend specification

### 7.1 Layout

- Two-pane desktop layout: **left = live computation**, **right = chat**. Split roughly 45/55, resizable.
- **Responsive:** below a breakpoint, panes stack with a tab/toggle between "Chat" and "Calculation"; the computation remains one tap away at all times.

### 7.2 Left pane (computation)

- Renders the assembler output as the full return computation: income by category, allowances, tax by band, CGT, FTCR, charges, tax already paid, balance, payments on account.
- **Drill-down:** each line expands to the tool's itemised working (bands, rates, amounts).
- **Reconciliation badge:** "Reconciled with HMRC ✓" (MTD, after Calculation API match) or "Computed per HMRC methodology vX" (legacy). Turns to a warning state on any mismatch or stale config.
- **What-if (optional):** a sandboxed recompute for scenarios, clearly separated from the live return.
- Updates reactively after every return change; never shows a figure sourced from the model.

### 7.3 Right pane (chat)

- Conversational thread, quick-reply chips for common answers, inline document upload with extraction preview and confirm/edit, and a phase progress indicator (Section 6.4).
- Clear affordances for "review" and "declare & submit" that are only enabled when validations pass.

### 7.4 Fraud-header browser collector

- A dedicated module collects the browser-side `Gov-Client-*` values **immediately before each HMRC-bound action** and sends them to the backend to assemble the full header set. Consider the pattern in the open-source `user-data-for-fraud-prevention` library as a reference implementation. The exact fields for the "web application via server" method are in Appendix D.
- Collection must be fresh per request (timestamps must reflect actual collection time), and the UI must not block on it.

### 7.5 State management

- Server state (return, computation, session) via TanStack Query against the BFF; UI state via Zustand. The computation is always fetched from the server (the assembler), never computed client-side.

---

## 8. HMRC integration service

### 8.1 OAuth2

- Authorisation-code grant. Register the app on the Developer Hub for `client_id`/`client_secret` (sandbox first).
- Redirect the agent to HMRC to sign in with Government Gateway and grant the required scopes; exchange the code for access and refresh tokens; store tokens in Secret Manager keyed to the agent.
- Refresh proactively; on refresh failure, drive a clear re-authorisation flow. All calls over TLS 1.2+. Select API version via the `Accept` header media type.

### 8.2 Agent authorisation

- Use the **Agent Authorisation API** to create and check client authorisations (the 64-8 replacement). Block filing until authorisation is confirmed. Operate as **main agent**.

### 8.3 Pre-population (optional but recommended)

- Seed the return from HMRC-held data using the pre-population APIs (employment history, benefits/P11D data, income). Always show pre-populated values for confirmation; never file them unreviewed.

### 8.4 Fraud-header assembly

- Merge browser-collected values (7.4) with server-collected values (public IP/port, forwarding chain, vendor identifiers, multi-factor status, user identifiers) into the full header set for the "web application via server" method (Appendix D).
- Validate against the **Test Fraud Prevention Headers API** in CI and staging until **zero errors and zero unresolved advisories**. This is a release gate.

### 8.5 Submission — legacy SA rail (v1)

1. Build the SA100 + supplementary-page XML from the return object using the vendored **SA XSD schemas**; validate locally against the XSDs before sending.
2. Wrap in the **GovTalk** envelope and compute the **IRmark** per the vendored spec.
3. Submit to the transaction engine with fraud headers; handle the asynchronous poll/response pattern; capture the receipt.
4. Map HMRC business-validation errors back to specific return fields for correction, then resubmit. Store request/response metadata (scrubbed) in the audit trail.

### 8.6 Submission — MTD rail (v2)

- Submit income data via the per-source APIs; **trigger the Individual Calculations API**; retrieve and reconcile the calculation against the engine; on match, make the **final declaration** (crystallisation). Use the Obligations API to track periods and the final-declaration obligation. Block final declaration on any reconciliation mismatch.

### 8.7 Validation gates before any submission

- All required fields present and schema-valid.
- Engine self-check passes for the current tax-year config (golden-vector smoke set) and config hash matches the expected release.
- Residence/FIG determination is complete and internally consistent (SA109 present when required).
- Fraud headers validate clean.
- Agent authorisation confirmed; agent is main agent.
- Declaration captured; four-eyes satisfied if configured.

### 8.8 Environments

- `sandbox` and `production` configurations, switched by env, never mixed. Sandbox exercises the `Gov-Test-Scenario` matrix (Section 10.4). Production only after recognition.

---

## 9. Security, privacy, and compliance

### 9.1 Data protection

- UK GDPR applies; the practice is the controller, the app processes on its behalf. Maintain a DPA with the agent business, an ICO registration (already in the practice setup), and records of processing.
- Encrypt in transit (TLS 1.2+) and at rest; column-level encryption for NINO/UTR/DoB; CMEK for documents.
- Data minimisation and pseudonymisation before the model path (6.5). Access control by role; least privilege; all access audited.
- Retention: six years minimum for tax/AML records; documented deletion procedures on client request where lawful.

### 9.2 Secrets and access

- All secrets in Secret Manager; no secrets in code or logs. Rotate the HMRC client secret and DB credentials. Log scrubbing removes PII and tokens.

### 9.3 Vertex AI configuration (the data-privacy requirement)

Use **Vertex AI**, not the free Google AI Studio tier (the free tier may use submitted content for product/model improvement). Configure:

- **No training on customer data.** Vertex AI is covered by Google's training restriction: customer prompts and responses are not used to train or fine-tune models. Confirm via the Cloud DPA / Service Specific Terms at contract time.
- **Zero Data Retention (ZDR).** For eligible enterprise projects, request ZDR-equivalent terms via a DPA amendment with the Google Cloud account team.
- **Disable abuse-monitoring logging** where ZDR is required, by requesting the abuse-monitoring exception (prompt logging for abuse detection is otherwise on by default).
- **Region pinning** at project creation for UK/EU data residency; keep Vertex, Cloud Run, Cloud SQL, and GCS in the same region.
- **Do not enable Live API session resumption** (its caching stores prompt/response data for up to 24 hours).
- Sign the **Cloud Data Processing Addendum**. Note UK/EEA/Swiss customers receive the paid-tier data policy by default, but rely on Vertex + DPA for auditable guarantees rather than that default.
- Choose model tier by task: a Flash-class model for routine turns, a Pro-class model for complex reasoning (residence edge cases, explanations). **[VERIFY-AT-BUILD]** current model names/pricing.

### 9.4 AML/KYC

- Client onboarding must capture the AML client due-diligence performed by the practice and link it to the client record before filing. This is a business gate, not just storage.

### 9.5 Penetration testing and dependency hygiene

- Pre-launch pen test; dependency and container scanning in CI; SBOM; regular patching.

---

## 10. Testing and HMRC-compliance plan (thorough)

This is the part that makes the product HMRC-compliant and trustworthy. Treat every gate below as blocking.

### 10.1 Test pyramid overview

L1 unit (calc) → L2 contract (MCP + model-tool) → L3 HMRC sandbox integration → L4 reconciliation vs HMRC calculation → L5 end-to-end → L6 UAT → L7 non-functional. Plus the HMRC recognition scenarios.

### 10.2 L1 — Calculation unit tests (the reliability core)

- **Golden vectors** per tax year for every tool and for the assembler: band boundaries (basic/higher/additional), PA taper at £100,000 and full withdrawal at £125,140, starting rate for savings, PSA by band, dividend allowance, CGT annual exempt amount and rate steps, FTCR limit cases, HICBC threshold, student-loan plan thresholds, SA109 split-year cases, FIG in-scope/out-of-scope. **[VERIFY-AT-BUILD]** every threshold.
- **Property-based tests** for invariants: tax is monotonic non-decreasing in income within a band; totals equal the sum of parts; rounding never produces negative tax; adding £1 of income never reduces net tax except at defined cliff-edges (which are asserted explicitly).
- **Rounding tests** against the methodology's specified directions per step.
- A single failure fails CI.

### 10.3 L2 — Contract tests

- Validate every MCP tool's JSON Schema and that inputs/outputs conform.
- **Model-tool integration:** recorded-transcript tests asserting the model calls the correct tool with correct arguments for representative user inputs, and never emits a figure absent from tool output (enforced by the post-check in 6.2).

### 10.4 L3 — HMRC sandbox integration tests

- OAuth flow (auth, refresh, revocation/re-auth).
- Agent authorisation create/check/cancel.
- **Fraud-header validation:** run submissions through the Test Fraud Prevention Headers API; assert **zero errors and zero unresolved advisories**. Release gate.
- **Submission matrix** using the `Gov-Test-Scenario` header: success, each named validation error, server errors, and throttling. For legacy, validate XML against XSDs and verify IRmark acceptance. Use sandbox statefulness where available; remember the 7-day sandbox data retention.

### 10.5 L4 — Reconciliation vs HMRC calculation

- For all MTD-representable synthetic returns, submit to HMRC's **Individual Calculations API** in sandbox, retrieve HMRC's calculation, and assert the engine matches **line by line**. Broad matrix; CI job. This is the strongest external check on calc correctness and must stay green.

### 10.6 L5 — End-to-end tests

- Playwright/Cypress journeys: full conversation → confirmed return → computation shown → validations pass → sandbox submission → receipt stored. Cover employee-only, employee+foreign+FTCR, split-year arriver with FIG, and gains-with-RSUs journeys.

### 10.7 L6 — User acceptance testing

- Prepare a set of realistic **dummy** SA109/SA106 returns. Compute each in the app and compare the full computation to (a) HMRC's online calculation and (b) a recognised commercial product. Every line must agree. Agent sign-off checklist required before go-live.

### 10.8 L7 — Non-functional

- **Security:** pen test clean; dependency/container scans clean; secrets never logged.
- **Privacy:** automated tests proving PII is minimised/pseudonymised before any Vertex call; verification that the Vertex project has no-training + ZDR + correct region + abuse-logging exception + session-resumption disabled.
- **Accessibility:** WCAG 2.2 AA.
- **Resilience/load:** throttling and retry behaviour under HMRC rate limits; backup/restore and DR drills.

### 10.9 HMRC recognition scenarios

- Execute HMRC's **required test scenarios** for the relevant APIs and demonstrate the full end-to-end journey to HMRC as part of obtaining production credentials. Track this as a milestone with its own acceptance evidence.

### 10.10 Definition of "HMRC compliant" (acceptance criteria)

All must hold before production filing:

1. Fraud-prevention headers pass the validator with zero errors and zero unresolved advisories.
2. Submissions accepted across the full sandbox `Gov-Test-Scenario` matrix.
3. Engine reconciles 100% with HMRC's Calculation API across the reconciliation matrix (MTD-representable cases).
4. Legacy XML validates against the vendored XSDs and IRmark is accepted.
5. HMRC production credentials granted; product on the recognised suppliers list.
6. Data handling meets UK GDPR and the Vertex no-training/ZDR configuration is verified.
7. Golden-vector suite green for the target tax year; config hash pinned to the release.

---

## 11. Delivery plan and milestones

Phases can overlap; HMRC recognition is long-lead and starts in Phase 0.

- **Phase 0 — Foundations and credentials (2–3 weeks).** Register on the Developer Hub (sandbox creds). Start the production-recognition conversation. **Vendor all HMRC artefacts (Appendix A) into the repo.** Stand up the monorepo, CI, GCP project (UK/EU region), Vertex with no-training/ZDR/region, Secret Manager, Cloud SQL, GCS CMEK. Deliverable: green skeleton, vendored schemas, environments wired.
- **Phase 1 — Calculation engine + MCP + golden vectors (4–6 weeks).** `tax-core` for the target tax year; all MCP servers; the assembler with correct ordering and rounding; golden-vector suite; L4 reconciliation job against sandbox. Deliverable: engine that reconciles with HMRC on the matrix.
- **Phase 2 — Orchestration + frontend (4–6 weeks).** State machine, Gemini↔MCP bridge with the post-check guardrail, PII-minimisation layer, two-pane UI, document extraction with confirm, fraud-header browser collector. Deliverable: usable chat that builds a return and shows a live, correct computation (no live filing yet).
- **Phase 3 — HMRC integration in sandbox (3–5 weeks).** OAuth, agent authorisation, fraud-header assembly + validator green, legacy XML + IRmark submission, error mapping, full sandbox scenario matrix. Deliverable: end-to-end sandbox filing with receipts.
- **Phase 4 — Recognition, hardening, pilot (timeline HMRC-gated).** Pass recognition scenarios, obtain production credentials, pen test, UAT sign-off, controlled pilot on real returns. Deliverable: live filing for a small set of clients.

Rough engineering effort to first sandbox end-to-end (Phases 0–3): on the order of **13–20 focused weeks** for one strong full-stack engineer, less with two. Phase 4's calendar length is dominated by HMRC recognition, not code.

---

## 12. Repository structure (monorepo)

```
/apps
  /web                # React SPA (two-pane UI, fraud-header collector)
  /orchestrator       # BFF: state machine, Gemini loop, MCP client, PII layer
  /hmrc-integration   # OAuth, agent auth, fraud headers, filing providers
/packages
  /tax-core           # pure deterministic engine + rules (no I/O)
  /tax-config         # TaxYearConfig data files (one per year) + hashes
  /mcp-servers        # uk-income-tax, uk-nic, uk-cgt, uk-residence,
                      # uk-foreign, uk-reliefs-charges, uk-payments-on-account,
                      # uk-assembler (wrap tax-core)
  /return-model       # Return object types, zod schemas, box mappings
  /hmrc-artefacts     # VENDORED: XSD schemas, GovTalk/IRmark spec, box-map CSVs,
                      # fraud-header spec snapshot, calc methodology (see App. A)
/test
  /golden-vectors     # per tax year
  /reconciliation     # HMRC Calculation API matrix
  /e2e                # Playwright journeys
/infra                # IaC for GCP (region-pinned), CI config
```

---

## 13. Open decisions and risks

- **Legacy XML + IRmark is finicky and under-documented publicly.** Budget time; vendor the exact GovTalk/IRmark spec and validate against sandbox early.
- **HMRC recognition is slow and iterative.** It gates go-live. Start in Phase 0, keep evidence, expect back-and-forth.
- **SA109/FIG calculation is complex and recently overhauled (FIG regime from April 2025).** The methodology must be implemented exactly and re-verified each tax year. This is the area most likely to hide subtle calc bugs; over-invest in golden vectors here.
- **Overseas-agent fraud-header collection from a server-rendered flow** needs care so browser values are fresh and complete; validator-green is non-negotiable.
- **Model guardrail enforcement** (no fabricated figures) must be tested adversarially, not assumed.
- **Tax-year rollover** is a recurring maintenance task: new config + new golden vectors + methodology re-verification before each filing season.

---

## Appendix A — Artefacts to vendor in Phase 0 (so no later internet fetch is needed)

Capture these into `/packages/hmrc-artefacts` and treat them as the build's source of truth. (Exact current locations are on the HMRC Developer Hub and HMRC GitHub; snapshot them once.)

1. **Self Assessment XSD schemas** for the legacy SA100 and supplementary pages (individual return), for each supported tax year.
2. **GovTalk message envelope specification and the IRmark algorithm** specification.
3. **MTD API parameter ↔ SA box-number mapping CSVs** (from HMRC's `income-tax-mtd-changelog/mapping` on GitHub).
4. **Tax calculation methodology / service guide** for each supported tax year (the "scope and methodology for the calculation of taxes" document), including rounding rules.
5. **Fraud-prevention headers specification** snapshot for the "web application via server" connection method, including field formats and examples.
6. **HMRC API reference details** for the APIs in Appendix E (endpoints, scopes, error catalogues, `Gov-Test-Scenario` values).
7. **HMRC recognition / minimum functionality standards** documentation and the required test-scenario definitions.
8. **Sample/synthetic test-user data** for sandbox.

Also record: which artefacts are per-tax-year (schemas, methodology, config) versus stable (fraud headers, GovTalk/IRmark), so rollover updates the right ones.

## Appendix B — Calculation MCP tool list (summary)

- `uk-income-tax`: `compute_personal_allowance`, `compute_income_tax`.
- `uk-nic`: `compute_class2_class4_nic`.
- `uk-cgt`: `compute_cgt`.
- `uk-residence`: `evaluate_srt`, `evaluate_split_year`, `evaluate_fig_eligibility`.
- `uk-foreign`: `compute_foreign_tax_credit_relief`, `apply_dta`.
- `uk-reliefs-charges`: `compute_hicbc`, `compute_student_loan`, `compute_pension_annual_allowance_charge`.
- `uk-payments-on-account`: `compute_payments_on_account`.
- `uk-assembler`: `compute_full_return` (runs all of the above in HMRC order; returns the full computation + version block).

Every tool: pure, tax-year-scoped, money in pence, itemised working in the output, version block attached.

## Appendix C — Return model ↔ SA form ↔ MTD parameter

Generate a single mapping table from the vendored box-map CSVs binding: `Return` field → SA form + box number (legacy XML) → MTD API parameter (v2). All three layers derive from this one table; do not maintain box numbers by hand.

## Appendix D — Fraud-prevention headers ("web application via server")

Send on every HMRC-bound request. Browser-collected values must be gathered fresh immediately before the request; server-collected values are added at the backend.

**Browser-collected (via the frontend collector):**
- `Gov-Client-Browser-JS-User-Agent`
- `Gov-Client-Device-ID` (a generated UUID persisted per device)
- `Gov-Client-Timezone` (UTC±hh:mm)
- `Gov-Client-Local-IPs` and `Gov-Client-Local-IPs-Timestamp`
- `Gov-Client-Screens` (width, height, scaling-factor, colour-depth per screen)
- `Gov-Client-Window-Size` (width, height)
- `Gov-Client-Browser-Plugins`
- `Gov-Client-Browser-Do-Not-Track`
- `Gov-Client-User-IDs` (the identifier the user logs in with; plus internal id)

**Server-collected:**
- `Gov-Client-Public-IP` and `Gov-Client-Public-IP-Timestamp`
- `Gov-Client-Public-Port`
- `Gov-Client-Multi-Factor` (MFA status of the app user; percent-encoded key-values)
- `Gov-Vendor-Version` (your software name → version)
- `Gov-Vendor-Product-Name`
- `Gov-Vendor-License-IDs` (hashed, consistent hashing)
- `Gov-Vendor-Forwarded` (the by/for chain across your intermediary servers/WAF)
- `Gov-Vendor-Public-IP` (where applicable)

Notes: percent-encode values as specified but not the separators; IPv6 values percent-encoded; timestamps in `yyyy-MM-ddThh:mm:ss.sssZ`. **Validate the complete set against the Test Fraud Prevention Headers API until zero errors and zero unresolved advisories.** Confirm the exact required list for the current spec version against the vendored snapshot (Appendix A).

## Appendix E — HMRC API inventory

- **Self Assessment API (legacy, XML):** submits the SA100 and supplementary pages (individual). Primary filing path in v1.
- **Individual Calculations API (MTD):** trigger/list/retrieve/submit a Self Assessment tax calculation. Used for reconciliation (all phases) and final declaration (v2).
- **Agent Authorisation API:** create/check/cancel client authorisation requests (64-8 replacement).
- **Test Fraud Prevention Headers API:** validate the fraud headers. Release gate.
- **Pre-population APIs:** Individual Employments, Individual Benefits, Individual Income (and related) to seed the return from HMRC-held data.
- **National Insurance API:** NIC liability within SA (if self-employment present).
- **Obligations API (MTD):** income/expenditure and final-declaration obligations (v2).
- **Self Assessment Individual Details API (MTD):** a customer's MTD status for a tax year.
- **View Self Assessment Account API:** liability breakdown (overdue/payable/pending) for post-filing views.
- **Individual Losses, Property Business, BSAS APIs:** for future scope (property/self-employment); not in v1.

Common to all: OAuth2 with per-endpoint scopes, TLS 1.2+, version via `Accept` header, sandbox before production, fraud headers where required, `Gov-Test-Scenario` for sandbox behaviours.

## Appendix F — Vertex AI configuration checklist

- Use Vertex AI (paid), never the free AI Studio tier.
- Cloud DPA signed; training restriction confirmed (no training on customer prompts/responses).
- ZDR-equivalent terms requested and applied via DPA amendment.
- Abuse-monitoring prompt logging exception requested (for ZDR).
- Region pinned to UK/EU at project creation; Vertex, Cloud Run, Cloud SQL, GCS all co-located.
- Live API session resumption left disabled.
- PII minimisation/pseudonymisation enforced before any model call.
- Model tiers selected by task (Flash-class routine, Pro-class complex). **[VERIFY-AT-BUILD]** current names/pricing.

## Appendix G — Glossary

- **SA100/SA102/SA106/SA108/SA109/SA110:** the main return and its supplementary pages (employment, foreign, capital gains, residence, tax calculation).
- **FIG regime:** the foreign income and gains regime for qualifying new UK arrivers, replacing the old non-dom/remittance basis from April 2025.
- **SRT:** Statutory Residence Test. **OWR:** Overseas Workday Relief. **FTCR:** Foreign Tax Credit Relief. **DTA:** Double Taxation Agreement.
- **MTD ITSA:** Making Tax Digital for Income Tax Self Assessment. **ASA:** Agent Services Account.
- **IRmark:** the message digest carried in a GovTalk submission envelope.
- **MCP:** Model Context Protocol — the mechanism by which the deterministic calculation tools are exposed to the model.
- **Golden vectors:** input→expected-output test cases that pin the engine's correctness per tax year.
