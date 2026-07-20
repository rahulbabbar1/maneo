# Maneo — Failure-Mode Analysis & Task Breakdown
### SA100 + SA102 + SA109, 30-day build

This document does two things: (1) maps where the 30-day plan can fail, grounded in how HMRC's legacy Self Assessment filing rail actually works; (2) breaks the work into tasks, each with a detailed description, dependencies, and objective pass/fail validation criteria.

**Reference tax year for build/test:** 2024-25. **First realistic live-filing year:** 2025-26 (season ends 31 Jan 2027), which uses the FIG regime — see FM-2 and T4.5.

---

## Part A — Failure-mode analysis

Each item: the risk, why it's real, severity, and the task(s) that mitigate it.

### FM-1 — Recognition is an external dependency the build can't absorb (SEVERITY: HIGH)
HMRC does not review source code. Recognition = register with the Software Developer Support Team (SDST) → receive a 4-digit **Vendor ID** and test credentials → pass HMRC-provided test scenarios on the test services → send the resulting XML outputs to SDST → SDST review (target ~10 working days) → product listed on the GOV.UK recognised-suppliers page. None of this is code you control; it has calendar lead time and a review queue. **Consequence if ignored:** you finish a technically-correct build on Day 30 and still cannot file live for weeks. **Mitigation:** Track 0 starts Day 1 (T0.1–T0.3); recognition package produced in Week 4 (T4.4). Treat "30-day build" and "recognised to file live" as two separate milestones.

### FM-2 — Reference-year vs live-year mismatch (SEVERITY: HIGH)
You build/test on 2024-25 because the test services, exclusions list, and MTR-Tester artefacts are stable for it. But by the time Maneo can file live, the open season is 2025-26 (deadline 31 Jan 2027). 2025-26 abolished the remittance basis and introduced the **FIG regime** — the SA109 changes from "Residence, remittance basis etc" to "Residence and FIG regime etc," with new boxes and different relief logic (4-year 100% relief for qualifying new arrivers). **Consequence if ignored:** a return that reconciles perfectly for 2024-25 is wrong for the year customers actually file. **Mitigation:** T4.5 documents the delta explicitly; the FIG port is scoped as a named follow-on, not assumed to be free.

### FM-3 — No HMRC end-to-end test service; two surfaces required (SEVERITY: MEDIUM-HIGH)
HMRC explicitly does not provide an end-to-end test service. You must pass **both**: the Local Test Service (LTS — validates the Body/tax-return against schema + business rules locally) and **ETS/VSIPS** via the Transaction Engine test site (validates the GovTalk header + credentials, then routes to TPVS for Body validation). A return can pass LTS and still fail ETS on header/credential/routing issues. **Consequence if ignored:** Week 3 "green" is only half the rail. **Mitigation:** T3.2 (LTS) and T3.3 (ETS/VSIPS) are separate gates.

### FM-4 — Archetype scenarios that are excluded from online filing (SEVERITY: HIGH)
Even via commercial software, HMRC's annual Individual Exclusions and Special Cases lists bar certain returns from online filing — they must be paper-filed with a reasonable-excuse claim. Residence/split-year (SA109) cases are historically a hotspot. If Maneo submits an excluded return it will be rejected or, worse, accepted-then-queried. **Consequence if ignored:** silent rejections or client-facing failures on exactly the niche you're targeting. **Mitigation:** T0.4 maps every Category 1 & 2 exclusion touching SA100/SA102/SA109; T3.4 builds the refusal-and-route engine as SubmissionGate part 4.

### FM-5 — Reconciliation ground truth for legacy is NOT the MTD Calculation API (SEVERITY: HIGH)
The original plan said "reconcile against the HMRC Calculation API." That API is an MTD Income Tax construct; it is not the reconciliation authority for legacy SA online filing and may not model the SA109 archetype the way the legacy rail computes it. The correct ground truth for 2024-25 legacy is HMRC's **Calculate Tax and NIC methodology** plus the **MTR-Tester** spreadsheets (both already in `hmrc_docs`). **Consequence if ignored:** you reconcile to the wrong authority and pass a gate that doesn't reflect the rail you're filing on. **Mitigation:** T2.1 rebuilds the reconciliation harness against the methodology doc + MTR-Tester, not the MTD API.

### FM-6 — Fraud-prevention headers are MTD law, not a legacy requirement (SEVERITY: MEDIUM, effort-misdirection)
The Gov-Client-* fraud prevention headers are a legal obligation for the VAT (MTD) and ITSA (MTD) **APIs**. The legacy GovTalk/Transaction Engine rail authenticates via credentials + Vendor ID + IRmark, not those headers. Prior fraud-header work is either not required for v1 or is forward-work for MTD v2. **Consequence if ignored:** Week 3 blocked on a requirement that doesn't apply, or false confidence it's "done." **Mitigation:** T3.5 makes an explicit, documented determination and de-scopes from the v1 gate if confirmed.

### FM-7 — Split-year + PA-taper reconciliation surprises (SEVERITY: HIGH, schedule risk)
The archetype's hardest arithmetic is SA109 split-year apportionment feeding SA100 income, interacting with the 60% personal-allowance taper band, marriage allowance, student loan, and HICBC. This is where zero-diff reconciliation typically slips. **Consequence if ignored:** Week 2 overruns into Week 3 and compresses the test-service work. **Mitigation:** T2.2/T2.3 isolate these; keep the vector set narrow; hold the gate rather than widen scope.

### FM-8 — Agent fabrication regressions and the "LLM never computes" invariant (SEVERITY: HIGH)
Two confirmed prior bugs (hardcoded upload stub returning fixed figures; unvalidated Vertex history) show fabrication is silent and destructive. The core product invariant — the LLM never produces a figure, only orchestrates — must be enforced by tests, not convention. **Consequence if ignored:** a plausible-looking return with fabricated numbers reaches an envelope. **Mitigation:** T1.2, T1.3, T1.5 enforce refusal + provenance as automated gates; T4.3 stress-tests under fault injection.

### FM-9 — Legal filer / agent authorisation (SEVERITY: MEDIUM, operational)
Maneo's model is agents filing on behalf of clients. Live filing requires per-client agent authorisation (64-8 / online agent authorisation) and live gateway credentials, separate from product recognition. **Consequence if ignored:** recognised software with no lawful path to file a specific client's return. **Mitigation:** T4.5 lists these as go-live prerequisites (documented, not executed within 30 days).

### Severity summary
- **Existential / schedule-defining:** FM-1, FM-2, FM-4, FM-5, FM-7, FM-8
- **Rail-correctness:** FM-3, FM-6
- **Operational go-live:** FM-9

---

## Part B — Task breakdown

Format per task: **Description** · **Depends on** · **Validation (objective pass/fail)**.

Standing invariants (apply to every task): `allowedDirectories` scoped to `C:\Users\rahul\Documents\SA`; `npm test` green before any task is "done"; no envelope figure without tax-core provenance; ground all constants/logic against `hmrc_docs`.

---

### Track 0 — External dependencies (start Day 1, run in parallel)
These gate Week 3 and live filing. They have lead times independent of the build.

**T0.1 — Register with SDST; obtain Vendor ID + test credentials**
Description: Register as an HMRC software developer for the Self Assessment online filing (XML) channel. Request the 4-digit Vendor ID and test credentials for LTS and ETS/VSIPS. Obtain the current SA technical pack / Message Implementation Guide for 2024-25.
Depends on: none (Day 1).
Validation: Vendor ID received in writing from SDST; test credentials successfully authenticate a trivial submission against ETS/VSIPS; current technical pack in `hmrc_docs`, tax-year confirmed 2024-25.

**T0.2 — Obtain HMRC's official recognition test scenarios**
Description: Request from SDST the official SA test scenarios covering SA100, SA102, and SA109 for 2024-25 (recognition requires passing HMRC-provided scenarios, not self-authored ones).
Depends on: T0.1.
Validation: scenario pack in hand; each scenario maps to a known expected outcome; version/tax-year confirmed.

**T0.3 — Confirm recognition process + turnaround for the legacy channel**
Description: Get written confirmation from SDST that new-vendor recognition for the legacy SA online filing channel is open for the target year, plus the exact submission requirements (product name/version, which XML outputs to send, review turnaround).
Depends on: T0.1.
Validation: written confirmation on file specifying the recognition criteria and the ~10-working-day review expectation.

**T0.4 — Reconcile exclusions/special-cases against the archetype**
Description: Using the 2024-25 Individual Exclusions and Special Cases documents in `hmrc_docs`, identify every Category 1 and Category 2 exclusion that can touch a SA100+SA102+SA109 return (residence, split-year, allowance interactions, multiple-employment edge cases, etc.). Produce a mapping table: exclusion ID → applies?/workaround/refuse-to-paper.
Depends on: none (Day 1; feeds T3.4).
Validation: every exclusion touching SA100/SA102/SA109 is mapped to either an implemented rule or an explicit, justified "not applicable"; no unmapped residence/split-year exclusions remain.

---

### Week 1 — Unblock core & lock computation
Objective: green, non-fabricating build; deterministic computation locked for the archetype.

**T1.1 — Rebuild orchestrator green**
Description: Restore Desktop Commander; rebuild `apps/orchestrator`, fixing all breakage from the uncompiled intelligence rebuild (SRT engine, new record tools, real Gemini extraction, domain system prompt).
Depends on: Desktop Commander restored.
Validation: orchestrator compiles clean; `npm build` and `npm test` green across the workspace (`tax-core`, `tax-config`, `orchestrator`).

**T1.2 — Eliminate the file-upload fabrication stub**
Description: Remove the hardcoded stub upload handler. Wire real Gemini multimodal P60 extraction; classify documents and refuse non-P60 uploads.
Depends on: T1.1.
Validation: fabrication regression test passes — a CV upload returns a refusal (never fabricated employer/salary); a valid P60 returns extracted figures matching the ground-truth fixture within defined tolerance.

**T1.3 — Harden Vertex history sanitisation**
Description: Validate/normalise conversation history into valid Vertex form (alternating roles, no bot-first, no malformed turns) before every model call.
Depends on: T1.1.
Validation: unit tests feeding non-alternating, bot-first, and empty histories all produce a valid request and no crash.

**T1.4 — Author archetype golden vectors**
Description: Create 6–8 deterministic golden vectors in `tax-core` for the archetype: single-employment full-year resident; split-year arriver; higher-rate; additional-rate (PA taper); with/without student loan (per plan type); one HICBC case.
Depends on: T1.1.
Validation: every vector computes a full return object without error; each has an asserted expected liability placeholder (finalised in Week 2).

**T1.5 — Enforce "LLM never computes" as a guard**
Description: Tag every figure in the return model with tax-core provenance; add a test that fails if any envelope-bound figure lacks provenance or originates from the model path.
Depends on: T1.4.
Validation: provenance test is green for all vectors and fails deliberately when a figure is injected without provenance.

**Week 1 milestone gate:** all of the above green; fabrication test refuses a CV; provenance guard active.

---

### Week 2 — Correctness reconciliation
Objective: tax-core reconciles to the correct legacy authority to the penny for the archetype.

**T2.1 — Build reconciliation harness against legacy ground truth**
Description: Build a harness that recomputes each archetype vector from HMRC's Calculate Tax and NIC methodology + MTR-Tester spreadsheets in `hmrc_docs` (NOT the MTD Calculation API — see FM-5), and diffs against tax-core per line (liability, POA, balancing payment).
Depends on: T1.4, T1.5.
Validation: harness runs all vectors and emits per-line diffs; ground-truth source documented as the methodology doc + MTR-Tester.

**T2.2 — Drive tax-core to zero-diff**
Description: Fix every discrepancy: band stacking, 60% PA taper, marriage allowance transfer, student loan thresholds/rates, HICBC.
Depends on: T2.1.
Validation: 0 discrepancies to the penny across all archetype vectors.

**T2.3 — SA109 split-year apportionment chain**
Description: Implement/verify SRT-derived residence status → split-year apportionment → correct income feeding SA100. Cover arriver split-year and full-year-resident paths.
Depends on: T2.2.
Validation: all split-year vectors reconcile to the penny; SRT-derived status matches the expected status in every scenario.

**T2.4 — Wire reconciliation as a permanent gate**
Description: Encode reconciliation as SubmissionGate part 2 — block any return whose tax-core output diverges from the methodology recompute.
Depends on: T2.2, T2.3.
Validation: gate blocks a deliberately mis-computed return and passes all zero-diff vectors.

**Week 2 milestone gate:** zero-diff across all vectors; reconciliation gate enforced.

---

### Week 3 — Envelope, validation, test-service acceptance
Objective: a complete archetype envelope passes LTS and ETS/VSIPS; exclusions gate live.

**T3.1 — Assemble the full envelope**
Description: Build the GovTalk envelope for each vector: SA100 + SA102 + SA109 + SA110 calc + Declaration. Box-mapping verified against the `hmrc_docs` box-mapping XML. Correct IRmark; Vendor ID and product name/version populated per technical pack.
Depends on: T2.4, T0.1.
Validation: envelope well-formed; IRmark verifies against the reference method; Vendor ID and product metadata present and correct.

**T3.2 — Pass the Local Test Service (Body validation)**
Description: Validate each envelope Body against LTS (schema + business rules / RIM artefacts) until clean.
Depends on: T3.1.
Validation: LTS returns pass for the primary archetype and all variants; every rejection cleared and documented.

**T3.3 — Pass ETS/VSIPS (header + credentials + routing)**
Description: Submit through the Transaction Engine test site (ETS/VSIPS) with test credentials; clear GovTalk-header, credential, and routing errors until a clean TPVS pass.
Depends on: T3.2, T0.1.
Validation: ETS/VSIPS returns pass (GovTalk header valid, credentials valid, Body passes schema + business rules) for the primary archetype and variants.

**T3.4 — Exclusions engine (SubmissionGate part 4)**
Description: Implement the exclusions/special-cases engine from the T0.4 mapping; on a match, refuse online submission and route to paper with a reason and guidance.
Depends on: T0.4.
Validation: a known-excluded residence/split-year test case is correctly refused with reason + paper guidance; a non-excluded archetype return passes the gate.

**T3.5 — Fraud-header applicability determination**
Description: Confirm from HMRC guidance whether fraud-prevention headers apply to the legacy channel (see FM-6). If not, de-scope from the v1 gate; retain for MTD v2.
Depends on: none.
Validation: documented determination citing HMRC guidance; v1 gate configuration reflects it; no Week 3 gate blocked on an inapplicable requirement.

**Week 3 milestone gate:** primary archetype envelope passes BOTH LTS and ETS/VSIPS; exclusions gate refuses a known-excluded case. This is the true "it can file" inflection.

---

### Week 4 — End-to-end, hardening, recognition package
Objective: real user journey to accepted test submission; recognition package ready; go-live gap documented.

**T4.1 — Wire the full frontend flow**
Description: `apps/web`: onboarding → P60 upload → agent-guided SA100/SA102/SA109 capture → live calc panel → review → envelope → submit-to-test.
Depends on: T3.3.
Validation: automated E2E test (UI → orchestrator → engine → envelope → ETS) passes for the primary archetype + 2–3 variants.

**T4.2 — Enforce SubmissionGate as the single pre-submit checkpoint**
Description: All four parts (tax-core accuracy, reconciliation, schema/Schematron/IRmark validity, no exclusion match) must pass or submission is blocked.
Depends on: T2.4, T3.2, T3.4.
Validation: a deliberately broken return is blocked; each of the four parts is shown to independently block a return crafted to fail only that part.

**T4.3 — Failure-mode hardening**
Description: Fault-inject partial/ambiguous P60, agent recovery, malformed history, transient Vertex errors; verify graceful handling with no fabrication.
Depends on: T4.1.
Validation: each injected fault yields graceful handling, no crash, and no fabricated figure (provenance guard holds under stress).

**T4.4 — Produce the recognition submission package**
Description: Run HMRC's official test scenarios (T0.2) end-to-end through the pipeline; capture the XML outputs and package them per SDST's stated requirements (T0.3) for review.
Depends on: T0.2, T0.3, T3.3.
Validation: all HMRC-provided scenarios pass LTS + ETS; XML outputs packaged exactly per SDST requirements and ready to send.

**T4.5 — Document go-live prerequisites + the 2025-26 FIG delta**
Description: Write the go-live checklist (agent authorisation / 64-8, live gateway credentials, recognition sign-off) and an explicit 2024-25 → 2025-26 delta list (SA109 FIG-regime boxes and relief logic replacing remittance basis — see FM-2).
Depends on: none.
Validation: go-live checklist complete; FIG delta enumerates every SA109 change required before filing a live 2025-26 return.

**Week 4 milestone gate:** green E2E for the archetype; SubmissionGate blocks bad returns on all four parts; recognition package ready to submit to SDST; FIG port scoped.

---

## What "done" means, honestly

- **End of Day 30:** software that passes LTS + ETS/VSIPS for the SA100+SA102+SA109 archetype (2024-25), with the four-part SubmissionGate enforced, no fabrication, and a recognition package ready for SDST.
- **NOT yet true on Day 30:** live filing. That needs the SDST recognition round-trip (submission + ~10-working-day review, likely iteration) and the FIG port for 2025-26.
- **First realistic live-filing window:** the 2025-26 season (Nov 2026 – Jan 2027), assuming recognition completes in autumn 2026 and the FIG port lands.

## The two soft spots to watch
Week 2 (split-year + taper zero-diff) and Week 3 (clean pass on *both* test surfaces). Both are where HMRC's real rules bite. If the schedule slips, it slips here — hold the gate, keep SA106 and non-archetype cases out, and let Track 0 run in parallel so recognition lead time doesn't stack on top of the build.
