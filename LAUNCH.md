# LAUNCH.md — Maneo Self Assessment Filing: Path to First Live Filing

> **Purpose.** Single source of truth for what stands between the current codebase and a
> supervised live-filing pilot for the **2025-26 tax season (filing window closes 31 Jan 2027)**.
> Written for Antigravity agents working `C:\Users\rahul\Documents\SA`.
>
> **Status date:** 2026-08-15
> **Target pilot:** Dec 2026 – Jan 2027 (supervised, accountant-reviewed, low volume)
> **Target public launch:** 2026-27 season (from Apr 2027)
>
> **Do not treat this as a wishlist.** Items in Track A and Track B are *blockers*. Items in
> §7 are explicitly *deferred* — do not build them now.

---

## 0. How to use this document

- Every task has an **ID**, **owner-type**, **estimate**, **dependencies**, and **acceptance criteria (AC)**.
- 🔴 = on the critical path. Slipping it slips the pilot.
- ⚪ = required for pilot but parallelisable.
- 🔵 = required for public launch, not for the supervised pilot.
- Owner-type: `ENG` (code), `EXT` (HMRC/regulator-paced, cannot be compressed by working harder), `LEGAL`, `OPS`.
- **Definition of "correct" (the SubmissionGate contract)** — a return is correct **only if all four hold**:
  1. `tax-core` produces the figure deterministically (LLM never does arithmetic).
  2. Figure reconciles to **MTR-Tester + Calculate Tax and NIC methodology** (NOT the MTD Calculation API).
  3. XML is schema-valid **and** Schematron-valid against vendored HMRC XSDs.
  4. No exclusions/specials match.
  A gate that cannot prove all four **must fail closed.**
- **Reconciliation authority for legacy SA:** MTR-Tester spreadsheets + Calculate Tax and NIC methodology. Never grade against tax-core itself. Never use the MTD Calculation API for legacy SA.
- **Rail:** legacy SA XML over GovTalk (v1). Fraud-prevention headers are an MTD concept and **do not apply** here — do not add them to the GovTalk rail.

---

## 1. Critical path (the one-line sequence)

```
Fix correctness blockers  →  Real GovTalk submission + poll  →  Pass LTS  →  Pass ETS/VSIPS
        (Track A)                     (Track A)                  (EXT)         (EXT)
                                          ‖
        Kick off NOW, runs in parallel:  HMRC agent creds + AML supervision (Track B, EXT)
                                          ‖
                              CONVERGE → supervised pilot (Dec 2026 – Jan 2027)
```

**The code is ~3–4 focused months from "able to file." The pilot date is gated by the two EXT long-poles (production credentials + AML), which is why Track B starts this week regardless of code state.**

---

## 2. Already done — DO NOT redo

These are complete per prior reviews. An agent should verify they still hold (regression risk) but not rebuild.

- [x] IRmark rebuilt with correct **W3C C14N canonicalisation**.
- [x] HMRC XSD schemas vendored; schema-conformant XML assembler for **SA100, SA102, SA106, SA109, SA110, Declaration**.
- [x] LLM agent layer migrated from rigid FSM → **tool-driven augmented loop**.
- [x] Deterministic eval harness exists (but see A1 — it is self-referential).
- [x] Frontend bundle code-split.
- [x] PII scrubber hardened.
- [x] Five wrong constants in `CONFIG_2024_25` corrected against MTR-Tester.
- [x] Security/engine fixes: Firestore rules; CORS; Vertex AI region-pinned to Europe; fabrication guardrail wired in; HICBC divisor corrected; income-tax band stacking rewritten; CGT loss ordering fixed; payments-on-account logic corrected.

> ⚠️ **Regression guard:** before touching `packages/tax-core`, snapshot current eval output so the A-series fixes can be shown to *change* only the intended cases.

---

## 3. TRACK A — Technical blockers ("one correct return, submitted in test")

### A1 🔴 Anchor the reconciliation harness to MTR-Tester
**Owner:** ENG · **Est:** 4–6 days · **Deps:** none · **Blocks:** every other correctness claim.

**Defect:** harness grades `tax-core` against `tax-core` — self-referential, proves nothing.

- [x] Ingest MTR-Tester spreadsheet scenarios from `hmrc_docs` as fixed golden vectors (input → expected figure).
- [x] **Expected values must be transcribed directly from MTR-Tester spreadsheet cells, never hand-derived by whoever wrote tax-core.** Hand-derivation reintroduces correlated error: if the author misread a rule, the engine and the "golden" value carry the same mistake and the test passes vacuously. (Current `mtr-golden-vectors.ts` V14/V16 are self-admittedly approximate — re-source them from cells.)
- [x] Build an adapter that maps each MTR-Tester scenario onto `tax-core` inputs.
- [x] Harness asserts `tax-core` output == MTR-Tester expected, to the penny, per box.
- [x] Cross-check against the **Calculate Tax and NIC methodology** for any box MTR-Tester doesn't cover.
- [x] **Add a second, independent oracle (differential testing).** Run the same scenarios through a separately-built computation (a thin independent reimplementation of the contested boxes, or a second reference source) and require agreement to the penny with tax-core. Where they disagree, triage each difference to a primary-source citation rather than silently trusting either. Rationale: a single oracle only catches errors it doesn't share; two independent computations catch bugs neither finds alone. *(Pattern transformed from opentax-engine's 572-scenario differential harness vs PolicyEngine — idea only, no code; it is US-only and AGPL.)*
- [x] Wire both the MTR anchor and the differential harness into CI; red build on any mismatch.
- **AC:** ≥1 golden vector per supported box across SA100/102/106/108/109/110, every expected value cell-sourced (not hand-derived); the differential harness agrees to the penny or every gap is citation-triaged; zero self-referential asserts remain; a deliberately corrupted constant makes the harness fail.

> **Also fix the live gate wiring (found in code review):** the SubmissionGate's Part 2 calls `reconcileReturnAgainstMethodology`, which does only structural validation (finite / non-negative / band-sum) — it does **not** reconcile against MTR at all, so a finite-but-wrong return passes it. Wire the *real* MTR harness (or a per-return MTR lookup) into the gate's Part 2, or the whole A1 effort only protects CI and not filing.

### A2 🔴 SubmissionGate must fail closed
**Owner:** ENG · **Est:** 2–3 days · **Deps:** A1 · **Blocks:** any submission.

**Defect:** gate **fails open** when XSD is missing; provenance check is a stub; IRmark checked by presence only.

- [x] Missing/unloadable XSD → gate returns FAIL, never PASS.
- [x] Implement real **provenance as a proof tree**, not the current configHash+finiteness stub. Every emitted figure must carry a derivation node: `{ value, rule_id, authority_ref (MTR/methodology/statute), inputs[], assumptions[] }`, and every leaf must resolve to either a client-supplied source value or a dated tax-core rule. Any figure whose tree does not fully resolve to sourced leaves → FAIL. The tree is the artefact the SubmissionGate checks *and* the artefact the accountant reviews (see B6) — so it must be human-readable, not just machine-valid. *(Pattern transformed from opentax-engine's proof tree + assumptions list — idea only; do not import AGPL code. Ours cites MTR/methodology, not US statute.)*
- [x] Every "Assumed" leaf (a conservative default applied because data was missing — see the intake model in §9) must be explicitly flagged in the tree so the reviewer sees exactly which figures rest on assumptions.
- [x] Validate **IRmark by correctness** (recompute + compare), not by presence of the field.
- [x] Gate enforces all four "correct" conditions from §0; log which condition failed.
- **AC:** unit tests prove each of the four conditions independently blocks submission when violated; missing-XSD test fails closed; wrong-IRmark test fails closed; every figure in a passing return has a fully-resolved proof tree and every assumed leaf is flagged.

### A3 🔴 SA109 FIG eligibility bug
**Owner:** ENG · **Est:** 3–5 days · **Deps:** A1 · **Blocks:** SA109 filings.

**Defect:** non-residents incorrectly marked **eligible** for FIG.

- [x] Correct eligibility predicate (FIG applies to qualifying new-arrival residents, not non-residents — verify exact rule against current HMRC SA109 guidance in `hmrc_docs`).
- [x] Enforce the **simultaneous withdrawal rule**: claiming FIG withdraws Personal Allowance **and** CGT Annual Exempt Amount together. Agent must **refuse to grant both** FIG and either allowance.
- [x] Add trap case to eval harness: non-resident attempting FIG → refused.
- [x] Add trap case: FIG claimant retaining PA or CGT AEA → refused.
- **AC:** all four combinations (resident/non-resident × FIG/no-FIG) produce correct eligibility + allowance treatment in the harness.

### A4 🔴 Split-year: replace boolean with statutory 8-case framework
**Owner:** ENG · **Est:** 6–10 days · **Deps:** A1, A7 (day-count) · **Blocks:** correct SA109 residence.

**Defect:** split-year modelled as a boolean; statute has **eight cases**.

- [x] Implement all 8 split-year cases with their distinct qualifying conditions and split dates.
- [x] Case selection must be deterministic and driven by A7 day-counts, not LLM judgement.
- [x] Emit the chosen case + split date into the return model and the audit log.
- [x] Eval vectors for at least one scenario per case, plus a "no case applies" scenario.
- **AC:** each case selectable via a golden vector; wrong-case selection detectable by harness.

### A5 🔴 Real GovTalk submission + async poll protocol
**Owner:** ENG · **Est:** 3–6 weeks (code) + EXT wait on test surfaces · **Deps:** A2 · **Blocks:** ALL filing.

**Defect:** filing rail is **entirely simulated** — no real GovTalk SOAP submission exists.

- [x] Implement GovTalk envelope assembly (verify against envelope schemas in `hmrc_docs`).
- [x] Implement **SOAP submission** to the SA XML endpoint.
- [x] Implement the **async poll loop**: `submit` → `poll` (with correlation ID + backoff) → `delete/confirm`; handle `acknowledgement`, `error`, `response` states.
- [x] Persist correlation ID, poll state, and final HMRC response per submission (idempotent, resumable).
- [x] Timeout, retry, and duplicate-submission guards.
- [x] Surface a real submission receipt to the user only after HMRC `response`, never on `acknowledgement`.
- **AC:** a full submit→poll→response cycle completes against LTS with a real correlation ID; simulated code paths removed or feature-flagged off in prod.

### A6 🔴 FX engine
**Owner:** ENG · **Est:** 1.5–3 weeks · **Deps:** A1 · **Blocks:** correct SA106 (foreign income) + foreign CGT.

**Defect:** none exists; SA106 figures can't be right without it. **Clarify the design so it isn't mis-built:** "convert to GBP" splits into two separable things — the **rate** (external data, changes daily, must NOT be hardcoded) and the **methodology** (which rate HMRC accepts, which date, per-transaction vs aggregate, rounding — this is tax law and must be fixed, tested, cited). The agent MAY *fetch* the rate (that's orchestration). The agent must NOT author/run a throwaway conversion script or do the arithmetic — that breaks reproducibility, provenance (A2), and the LLM-never-computes principle, and running networked code over foreign-income PII blows the EU boundary (B3).

- [x] Deterministic conversion **methodology** in tax-core (spot on transaction date and/or monthly/average per HMRC rules — confirm allowed methods in `hmrc_docs`). No LLM-authored math.
- [x] **Rate is fetched, not hardcoded:** pull from an HMRC-acceptable source, EU-hosted, **cached with provenance** (currency, date, rate, source, fetch-time). Google/mid-market rates are not automatically HMRC-acceptable — availability ≠ acceptability.
- [x] Missing/unavailable rate (e.g. non-publication day) → **refuse, don't guess**; apply the HMRC-specified fallback only if one exists and is cited.
- [x] Per-transaction conversion, not aggregate, where the rules require it.
- [x] Rounding rules match HMRC methodology.
- **AC:** golden vectors reconcile foreign-income and foreign-gain figures to MTR-Tester / methodology; every converted figure carries rate + date + source provenance for A2; two runs of the same return produce identical figures (reproducibility); no code path lets the LLM compute or script the conversion.

### A7 🔴 Deterministic SRT day-count engine
**Owner:** ENG · **Est:** 1.5–3 weeks · **Deps:** A1 · **Blocks:** A4, correct residence status.

**Defect:** SRT/day-count not deterministic; required for split-year and residence.

- [x] Implement day-counting for the Statutory Residence Test (days in UK, ties, work days — confirm exact SRT rules in `hmrc_docs`).
- [x] Deterministic, testable, LLM never estimates days.
- [x] Output feeds A4 case selection.
- **AC:** SRT status reproducible to the day across golden vectors; edge cases (transit days, deemed days) covered.

### A8 🔴 Section 104 pooling (CGT)
**Owner:** ENG · **Est:** 1.5–3 weeks · **Deps:** A1 · **Blocks:** correct SA108 for pooled holdings.

**Defect:** none exists; CGT on pooled shares can't be right without it.

- [x] Implement the Section 104 pool with correct acquisition averaging.
- [x] Implement the matching rules in order: **same-day → 30-day (bed-and-breakfast) → Section 104 pool**.
- [x] Interact correctly with the CGT loss ordering already fixed (regression-test that fix).
- **AC:** golden vectors covering same-day, 30-day, and pool disposals reconcile to methodology; a mixed scenario matches expected gain to the penny.

### A9 🔴 Content port 2024-25 → 2025-26 (FIG regime)
**Owner:** ENG · **Est:** 1–2 weeks · **Deps:** A1, A3 · **Blocks:** filing real 2025-26 returns.

- [x] Create `CONFIG_2025_26` with all rates/bands/thresholds for 2025-26, each sourced to MTR-Tester.
- [x] **Adopt rules-as-versioned-cited-data.** A rate is not a bare constant: it is `{ value, valid_from, valid_to, authority_ref }`. When a figure changes, add a *new version* with its own validity window — never edit a rate in place. `getConfig(taxYear)` selects by date window. This makes the 2024-25→(2025-26) port additive rather than a migration, keeps 2024-25 returns reproducible forever, and means an old proof tree (A2) still re-derives against the rule versions it was computed under. *(Pattern transformed from opentax-engine's dated-rule corpus + "currency policy" — idea only.)*
- [x] Encode the **FIG regime** rules for 2025-26 (this is the year FIG applies — verify final legislation).
- [x] Port SA109 content/questions to the 2025-26 residence/remittance/FIG shape.
- [x] Add 2025-26 golden vectors; do not delete 2024-25 (keep multi-year).
- **AC:** a full 2025-26 return computes and reconciles; no 2024-25 constants leak into 2025-26 calculations; each rate carries a validity window + authority_ref and no rate was edited in place.

> **`getConfig` caution (found in code review):** the A1 harness self-test mutates `getConfig('2025-26')` then relies on the mutation persisting into a second `getConfig` call. If `getConfig` returns a fresh object per call, the self-test is silently vacuous. The versioned-rule refactor above should make config access explicit and immutable, and the self-test should assert on a corruption injected through the real lookup path.

### A10 ⚪ Trap-case coverage — **SUPERSEDED by A12**
The trap cases (Marriage Allowance for a no-UK-income spouse, FIG double-benefit, non-resident FIG, fabricate-when-missing) are now **Suite 4** of the A12 eval component. Keep the ID for cross-references; do the work under A12.

### A11 ⚪ Environment separation: LTS **and** ETS/VSIPS
**Owner:** ENG + EXT · **Est:** 2–4 days code + EXT provisioning · **Deps:** A5.

**Note:** these are **two separate surfaces**, not one. LTS confirmed current at **v8.3**.

- [x] Config-switchable endpoints for LTS vs ETS/VSIPS vs prod.
- [x] Test-credential handling per surface.
- [x] Document the promotion path: LTS green → ETS/VSIPS green → prod.
- **AC:** same build passes an end-to-end submit→poll→response on LTS and on ETS/VSIPS.

### A12 🔴 Eval component (supersedes A10; instrument for "what's actually broken")
**Owner:** ENG · **Est:** 2–4 weeks (scaffold + first suites) · **Deps:** A1 · **Blocks:** knowing whether any change helps.

**Why:** the current eval measures only the calculator (tax-core). The *agent* — elicitation, extraction, refusal, advice — is essentially unmeasured, which is why breakage is invisible until a transcript reveals it. Build a lightweight local+CI harness. **Do NOT clone Valkyrie** (cloud microservice agent-benchmark infra = massive over-engineering, and AGPL). Take only its design discipline.

**Infra (transformed from Valkyrie — idea only, AGPL):**
- [x] Separate **dataset ↔ runner ↔ scorer** behind small interfaces (current harness conflates all three).
- [x] One **"thing under test" contract** so the same harness can wrap tax-core alone, the extraction step, the full agent loop, or end-to-end.
- [x] **Stratified reporting**, never blended: report per difficulty tier (simple SA100+102 → medium +SA106/FX → hard +SA109 split-year/FIG → adversarial). A blended 95% that is 40% on SA109 is the score-inflation failure mode.
- [x] **Held-out set** that never tunes a prompt or the engine (measure generalization, not memorization of the golden vectors).
- [x] **Versioned persisted results** tagged with git SHA + config version → score-over-time, per-commit regression detection; support **subset re-scoring** without a full rerun.

**The five suites:**
1. [x] **Engine correctness** — deterministic, exact-cents, **CI-gating**. = A1 (MTR anchor + differential oracle), stratified per box.
2. [x] **Extraction accuracy** — real P60s / foreign statements / brokerage CSVs → known field values; score field precision/recall **and table-structure preservation** (OfficeQA lesson, P6). *Currently unmeasured.*
3. [x] **Elicitation completeness** — each scenario carries the material facts a consultant must surface; run intake; score whether the agent asked. Rubric + LLM-judge. *Currently unmeasured — this is the "is it getting smarter" gauge.*
4. [x] **Refusal / trap suite** — the old A10 set + the claim-consistency traps from A14, binary must-refuse, **CI-gating**.
5. [x] **End-to-end** — document bundle → full pipeline → SubmissionGate verdict + final figures vs expected, **CI-gating**. Catches integration bugs unit suites miss (e.g. the V14 FTCR key-mismatch; the zero-income state bug in A15).

**Scoring discipline (non-negotiable for a legally-binding product):** suites 1, 4, 5 are pass/fail at exact cents and **gate CI — nothing fileable ships red**. Suites 2–3 (and later advisory quality) are rubric/judge-scored, **tracked over time but never gate a filing** (same demotion as P5). The deterministic harness stays the only authority on correctness.

**Seed scenario #1:** encode the 2025-26 "Rahul Babbar / Acme UK Ltd" intake transcript as the first end-to-end scenario. It should currently go **red** on: zero-income recompute (A15), OWR-recorded-but-not-applied (A13), FTCR-with-no-foreign-income accepted (A14), and no PDF output (A15). That single scenario converts "I don't know what's broken" into a checklist.

- **AC:** dataset/runner/scorer split; ≥5 suites runnable; strata reported separately; held-out set exists; results versioned per-commit; suites 1/4/5 gate CI; the seed transcript scenario is red on all four known defects, then tracked to green.

### A13 🔴 Overseas Workday Relief (OWR) engine — recorded-but-not-applied
**Owner:** ENG · **Est:** 1–2 weeks · **Deps:** A1, A3, A7 · **Blocks:** correct SA102/SA106 for new arrivals; **not previously listed**.

**Defect (from transcript):** the agent records an OWR claim but the engine emits *"Overseas Workday Relief is recorded but not yet applied to the computation"* — so taxable pay is not reduced. A captured-but-unimplemented relief filed as if handled is a wrong return.

- [x] Implement OWR under the **2025-26 rules** (verify: from 6 Apr 2025 OWR is tied to the FIG/qualifying-new-resident regime and is **capped** — the pre-2025 remittance-based OWR no longer applies). Confirm exact conditions + cap in `hmrc_docs`.
- [x] Enforce the **eligibility interaction**: OWR availability depends on residence (A7) and FIG/qualifying-new-resident status (A3). The agent must not grant OWR to someone who doesn't qualify, and must surface the FIG↔OWR interaction rather than treating them as independent.
- [x] Apportion relievable employment income by overseas workdays deterministically in tax-core; carry provenance into the A2 proof tree.
- [x] Until implemented, the agent must **refuse to record OWR as applied** and the SubmissionGate must **block** any return carrying an unapplied-but-claimed relief (no silent "recorded, not applied").
- **AC:** OWR golden vectors reconcile; ineligible-claimant refused; a claimed-but-unimplemented relief cannot reach a passing gate.

### A14 🔴 Claim-consistency / contradiction guardrail
**Owner:** ENG · **Est:** 3–5 days · **Deps:** A3 · **Blocks:** trust; **not previously listed**.

**Defect (from transcript):** user said "no foreign income" then "Claim FTCR"; agent did not flag the contradiction. FTCR requires foreign income **and** foreign tax paid. Same class: Gift Aid claimed with no amount; Marriage Allowance with no qualifying spouse (A10); FIG+PA (A3).

- [x] Encode claim pre-conditions as guards: FTCR ⇒ foreign income + foreign tax paid present; Gift Aid ⇒ a gross amount; OWR ⇒ A13 eligibility; etc.
- [x] On a failed pre-condition the agent **refuses and explains**, it does not silently record the claim.
- [x] Each guard becomes a Suite-4 trap in A12.
- **AC:** every claim with unmet pre-conditions is refused with a reason; each is a red-if-regressed CI trap.

### A15 ⚪ Transcript-surfaced defects (state bug + missing output)
**Owner:** ENG · **Est:** 2–4 days · **Deps:** none · **Blocks:** basic usability + correctness.

**Defects (from transcript):**
- [x] **Zero-income recompute/state bug:** the computation repeatedly reported "zero income" and re-asked for figures already recorded — employment figures are not persisting into the compute step (write-after-read or lost state). Fix the record→compute data flow; add a regression test (feeds A12 suite 5).
- [x] **Return PDF not exposed to the agent:** user asked for the final return PDF; agent said it "cannot generate a PDF" despite the `hmrc-artefacts` / pdf tooling existing. Wire the return-document/PDF output to the agent as a real capability (post-gate only — never a PDF of an unverified return).
- [x] **SRT asserted without the engine:** the agent concluded "resident" from a day count without the deterministic A7 SRT engine. Route residence conclusions through A7, never LLM assertion.
- **AC:** figures persist across recompute with a regression test; a post-gate PDF is downloadable in-product; residence status is only ever stated from the A7 engine.

**Track A focused total: ~3–4 months to a return that reconciles and submits in test (≈ Nov–Dec 2026). (A12–A15 added after the 2025-26 intake transcript review; A13/A14 are newly-identified correctness blockers.)**

---

## 4. TRACK B — Regulatory / business (START THIS WEEK — EXT long-poles)

> These have external lead times that **cannot be compressed by engineering effort**. They are the
> real gate on the pilot date. Begin before the code is ready.

### B1 🔴 HMRC agent credentials for production filing
**Owner:** EXT/OPS · **Est:** weeks–months (HMRC-paced) · **Deps:** none — start now.

- [ ] Register as a tax agent with HMRC; obtain **Agent Services Account**.
- [ ] Work through the **recognition process** for the legacy SA XML rail to obtain production submission credentials (verify exact current steps with HMRC SDS Team — process names change).
- [ ] Confirm test-surface credentials for LTS and ETS/VSIPS (feeds A11).
- **AC:** production GovTalk credentials in hand; test credentials for both surfaces in hand.
- **Risk:** #1 schedule risk. If this stalls, pilot slips a season with no loss to Track A.

### B2 🔴 AML supervision
**Owner:** LEGAL/OPS · **Est:** weeks–months · **Deps:** none — start now.

- [ ] Register for **anti-money-laundering supervision** (HMRC or an eligible professional body).
- [ ] Put AML policy, risk assessment, and client due-diligence procedures in place.
- **AC:** active AML supervision confirmed **before** taking a single paying client.
- **Warning:** operating as a paid tax agent without AML supervision is an offence. Non-negotiable, no pilot without it.

### B3 ⚪ Data protection
**Owner:** OPS · **Est:** days · **Deps:** none.

- [ ] ICO registration.
- [ ] Confirm the PII-boundary rule holds end-to-end: **no PII through non-EU embedding/inference services** (relevant when RAG in §7 is eventually built — enforce the boundary in architecture now).
- **AC:** ICO registered; data-flow diagram shows no PII leaving EU region.

### B4 ⚪ Professional indemnity insurance
**Owner:** OPS · **Est:** days–weeks · **Deps:** B2 (insurers ask about supervision).
- [ ] Obtain PI cover sized to the filing liability.
- **AC:** policy active before pilot.

### B5 ⚪ Legal: engagement terms + liability model
**Owner:** LEGAL · **Est:** 2–4 weeks · **Deps:** none.
- [ ] Client engagement letter / T&Cs drafted by a solicitor (social-enterprise + tax-agent experienced).
- [ ] Liability allocation for the accountant-review-in-the-loop model.
- [ ] If pursuing the non-profit structure decision: settle CIC-vs-ordinary-Ltd **before** incorporation (asset lock is one-way; see separate note).
- **AC:** signed-off engagement terms; entity structure decided.

### B6 🔴 Accountant review panel (the trust differentiator)
**Owner:** OPS · **Est:** 2–4 weeks · **Deps:** B2.
- [ ] Recruit qualified accountant(s) to review every pilot return before submission.
- [ ] Define the review workflow + sign-off record (also supports the AML/oversight story).
- [ ] **Reviewer identity on the output.** When a return has been reviewed and signed off, show the reviewing accountant's name + credential + review date on the filing summary the user sees. Anxiety is the dominant user emotion; a named human on the output is the strongest possible trust signal. *(Transformed from openaccountants' reviewer badge.)*
- [ ] **Review-as-diff.** The reviewer should approve a concrete diff of the return (see the git-audit-trail in §9), not re-key figures. They see the proof tree (A2), the Assumed leaves, and exactly what changed — which is what makes review fast, and review-minutes are the dominant unit cost. *(Transformed from openaccountants' public-diff reviews + accountant24's git history.)*
- [ ] Build the **AI→human handoff** path in-product, and route the handoff *with the worksheet/proof-tree attached* so the accountant starts with full context, not a cold ticket. *(Transformed from openaccountants' `request_accountant_review`.)*
- **AC:** named reviewer(s) contracted; reviewer name/credential/date renders on reviewed outputs; reviewer approves a diff (not a re-key); handoff carries the worksheet; flow live in the pilot build.

---

## 5. Convergence & milestones

| Milestone | Gate | Target |
|---|---|---|
| Correctness blockers green (A1–A4, A6–A9) | MTR-Tester reconciliation passes in CI | **~Oct–Nov 2026** |
| Real submission passes LTS (A5, A11) | submit→poll→response on LTS v8.3 | **~Nov 2026** |
| Passes ETS/VSIPS (A11) | second surface green | **~Nov–Dec 2026** |
| Production creds + AML in hand (B1, B2) | EXT confirmations | **EXT-gated — the risk** |
| **Supervised pilot** | few real 2025-26 returns, 100% accountant-reviewed | **Dec 2026 – Jan 2027** |
| Public launch | recognised, supervised, scaled | **2026-27 season (from Apr 2027)** |

---

## 6. Definition of Done — supervised pilot

All must be true to submit one real return:

- [ ] A1–A9 complete; eval harness (A12, incl. the Suite-4 trap set) green in CI.
- [ ] SubmissionGate enforces all four "correct" conditions and fails closed.
- [ ] Real submit→poll→response proven on LTS **and** ETS/VSIPS.
- [ ] Production HMRC credentials active (B1).
- [ ] AML supervision active (B2).
- [ ] ICO (B3), PI (B4), engagement terms (B5) in place.
- [ ] Named accountant reviews and signs off **every** return before submission (B6).
- [ ] AI→human handoff live.
- [ ] Rollback/abort path: any gate failure stops submission and routes to human.

---

## 7. Explicitly DEFERRED — do NOT build for the pilot

Building these now is scope creep against the pilot. They are 🔵 later-value, not blockers.

- **Grounding over `hmrc_docs` — do it as filesystem retrieval, not a vector DB.** Currently unused. When built (post-pilot), strongly prefer giving the agent read-only `list` / `read` / `grep` tools over the structured `hmrc_docs` markdown corpus and letting it retrieve like a researcher (list dir → read index → grep the figure → quote the line, with `path:line` citations). This needs **no embeddings at all**, which *sidesteps the no-PII-through-non-EU-embeddings constraint (B3) entirely* rather than merely managing it, and it wins on exact-match retrieval (box numbers, statute refs, form codes) where vector search is weak. Only fall back to a vector index if filesystem retrieval proves insufficient, and if so it must be hybrid (vector + keyword) and EU-hosted. *(Reframe transformed from finance-agent/StrataLens deleting its vector stack for `ls`/`read_file`/`grep`; reinforced by the Databricks OfficeQA finding that RAG plateaus <45% and that parsing quality beats model choice — idea only, MIT-licensed source.)* Do not wire in for pilot.
- **Multi-year loss carry-forward ledger** — later value; pilot returns can be single-year.
- **Frontend modularisation** — later value; current split is sufficient for pilot.
- **Parallel vision worker pool** — polish; single-path OCR is fine for pilot volume.
- **Optimistic UI on monetary figures** — polish; and risky on a legally-binding product. Keep figures pessimistic/confirmed.

---

## 8. Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | HMRC production creds slow (B1) | Pilot slips a season | Start now; Track A proceeds independently against LTS |
| 2 | AML registration slow (B2) | No paying clients | Start now; blocks pilot absolutely — treat as P0 |
| 3 | Score inflation / architecture graded above deployed reality | False "ready" signal | A1 anchors to MTR-Tester; assess running code, not design |
| 4 | Gate fails open (A2) | Wrong return filed | Fail-closed tests; four-condition enforcement |
| 5 | LLM does arithmetic / fabricates | Legally-binding error | tax-core is sole calculator; fabrication guardrail + A12 trap suite |
| 6 | FIG double-benefit granted (A3) | Incorrect claim | Refuse-both rule + trap cases |
| 7 | Simulated rail mistaken for real (A5) | "Filed" but nothing sent | Remove/flag sim paths; receipt only on HMRC `response` |
| 8 | Relief claimed but not implemented (e.g. OWR) filed as if applied | Wrong return, silent | A13 implements OWR; gate blocks any claimed-but-unapplied relief |
| 9 | Contradictory claim accepted (e.g. FTCR with no foreign income) | Wrong/at-risk claim | A14 pre-condition guards; Suite-4 traps |
| 10 | No eval on the agent layer → breakage invisible until a transcript | "Directionless", silent regressions | A12 suites 2/3/5 measure the agent, versioned per-commit |

---

## 9. Patterns adopted from open-source review (transformed to Maneo, not copied)

> These came from a scan of openaccountants, opentax-engine, finance-agent/StrataLens, accountant24,
> cfo-stack, and the Databricks GenAI book. Each is an **idea** re-shaped for our use case, cross-referenced
> to the blocker it strengthens. **Nothing here is a licence to paste source.** See the licence table below.

### 9.1 Where they're already folded in above
- **Proof tree** → A2 (provenance is now a re-derivable derivation tree, not a configHash stub).
- **Differential testing / second oracle** → A1 (kills correlated-error in hand-derived golden values).
- **Rules-as-versioned-cited-data** → A9 (dated rule versions; old proofs stay reproducible).
- **Reviewer badge + review-as-diff + handoff-with-worksheet** → B6.
- **Filesystem retrieval instead of vector RAG** → §7 (no embeddings → dissolves the B3 PII-residency problem).
- **Eval design discipline (dataset/runner/scorer split, strata, held-out set, versioned run history, subset scoring, uniform contract)** → A12 (lightweight local+CI harness; **not** a Valkyrie clone).

### 9.2 New items to schedule (pilot-relevant, not yet blockers unless noted)

**P1 — Three-outcomes intake + conservative default.** ⚪ pilot-relevant.
Every extracted input resolves to exactly one of: **Classified** (documents carry enough info → applied automatically), **Assumed** (data missing → conservative default applied, flagged for the reviewer), or **Needs-Input** (can't proceed → one targeted question to the user). Default direction when uncertain: **assume the position that yields more tax, never less** — a reviewer can safely relax a conservative position but cannot easily undo an aggressive one that's already filed. Feeds the Assumed-leaf flagging in A2 and shrinks review to just the Assumed + Needs-Input items (directly lowers the dominant unit cost). *(Transformed from openaccountants' three-outcomes + conservative-defaults model.)*

**P2 — Supplier / source pattern library.** ⚪ pilot-relevant.
A lookup table of known income sources so the model doesn't guess classification: known employer PAYE patterns, known foreign brokers/custodians, dividend payers, bank-interest payers, common P60/P45 layouts. When a document line matches, classification is applied deterministically instead of inferred. Reduces both fabrication risk and reviewer time. *(Transformed from openaccountants' per-jurisdiction supplier pattern library.)*

**P3 — Return model as a git-versioned audit trail.** ⚪ pilot-relevant; strengthens A2 + B6 + the liability story.
Persist the return as versioned records where **every mutation — AI or human — is an atomic, message-tagged commit**. Gives "what changed and who changed it" for free, makes the accountant's approval a signed-off diff (P owns review-as-diff in B6), and makes every filed number defensible after the fact ("show the exact basis and history"). *(Transformed from accountant24 + cfo-stack git-as-ledger; note their engines refuse to load if books don't balance — same instinct as our fail-closed gate.)*

**P4 — Structural cross-foot invariants in tax-core.** ⚪ cheap, high-value.
Beyond MTR reconciliation, assert internal consistency invariants that must hold regardless of scenario (e.g. per-page totals sum to the return total; allocated bands sum to taxable income; no figure appears that isn't in the proof tree). Cheap to run, catches whole classes of assembly bugs, and mirrors double-entry's "money never appears from nowhere." Wire into the SubmissionGate. *(Transformed from Beancount/hledger strict-load + double-entry invariants.)*

**P5 — Domain eval-judges as *monitoring*, never as a gate.** 🔵 post-pilot.
Automated scorers over agent transcripts for known failure modes ("did every figure come from tax-core?", "did it refuse FIG+PA together?", "did it avoid Marriage Allowance for a no-UK-income spouse?"), same scorers in dev and prod. Use these to *detect drift and surface regressions* — they are an aid to the daily-reviewer-prompt habit, **not** a correctness gate. The deterministic harness (A1) + SubmissionGate (A2) remain the only things that authorise a filing. *(Transformed from Databricks LLM-judges/scorers — deliberately demoted to monitoring for a legally-binding product.)*

**P6 — Parsing quality beats model tier (document intake).** ⚪ informs A-series extraction work.
OfficeQA finding: layout-aware parsing that preserves table structure (header↔cell links) drives accuracy more than model size. For P60/foreign statements/brokerage CSVs, invest in validated table-structure extraction over a bigger model, and add a check that table structure survived extraction (not just text). Consistent with the earlier cost analysis: spend on parsing, not on model tier. *(From the Databricks OfficeQA section.)*

### 9.3 Licence caution (hard constraint)

| Source | Licence | What we may take |
|---|---|---|
| opentax-engine | **AGPL-3.0 + commercial** | **Ideas/patterns only.** Do NOT vendor code into a proprietary/commercial Maneo without a commercial licence. US-only anyway. |
| openaccountants | **AGPL-3.0 + commercial** | **Ideas/patterns only.** Same viral share-alike caution. (Their UK guides could be a *reference*, not vendored code.) |
| finance-agent / StrataLens | MIT | Code reusable with attribution. |
| accountant24 | MIT | Code reusable with attribution. |
| cfo-stack | MIT | Code reusable with attribution. |
| Databricks GenAI book | Vendor whitepaper | Concepts only; no product lock-in — our stack is Vertex/Gemini + our own engine. |
| vals-ai / Valkyrie | **AGPL-3.0** | **Design discipline only.** Do not vendor code; do not clone the cloud infra. A12 is our own lightweight harness inspired by its structure. |

> **Rule of thumb:** patterns and architecture are free to reuse; *source code* only from the MIT three, with attribution. AGPL is viral — building the commercial product on AGPL code forces the whole product open. Given the for-profit-optionality decision (see structure note), treat opentax-engine and openaccountants as read-only inspiration.

---

*End of LAUNCH.md — keep this file at repo root. Update the checkboxes and milestone dates as work lands.*
