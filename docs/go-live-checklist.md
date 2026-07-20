# Maneo Go-Live Prerequisites & 2025-26 FIG Regime Delta Analysis (T4.5)

This document specifies: (1) the operational prerequisites for live agent filing; (2) the technical delta for migrating from 2024-25 reference year to the 2025-26 live filing year under the Foreign Income & Gains (FIG) regime.

---

## Part 1 — Operational Go-Live Prerequisites (FM-9)

Software readiness (passing LTS + ETS test services) is necessary but not sufficient for live client filing. Before Maneo can submit live returns to HMRC on behalf of clients, the following 3 operational requirements must be satisfied:

1. **SDST Software Recognition Sign-Off**:
   - Submit recognition package (T4.4 outputs) to HMRC Software Developer Support Team (SDST).
   - Receive formal confirmation letter listing Maneo as a recognized Self Assessment commercial filing product on GOV.UK.

2. **Agent Live Gateway Credentials & Agent Services Account (ASA)**:
   - The filing agent/practitioner must hold an active HMRC Agent Services Account (ASA) with a valid 10-digit Agent Reference Number (ARN).
   - Live Transaction Engine credentials (User ID and Password) must be configured in Secret Manager.

3. **Client-Agent Authorisation (64-8 / Online Agent Authorisation)**:
   - Each client must have authorised the agent via HMRC Online Agent Authorisation or a paper 64-8 form prior to submission.

---

## Part 2 — 2024-25 → 2025-26 FIG Regime Technical Delta (FM-2)

From 6 April 2025 (2025-26 tax year onwards), the UK government abolished the remittance basis of taxation for UK resident non-domiciled individuals and introduced the **Foreign Income & Gains (FIG) Regime**.

### 1. What Changes on Page SA109 (Residence & Domicile)
- **Remittance Basis Boxes Removed**: Box 28–40 on SA109 relating to claiming the remittance basis, nominated income, and £30k/£60k Remittance Basis Charge are retired.
- **FIG Election Boxes Added**: New SA109 boxes to claim 100% relief on foreign income and gains for qualifying individuals in their first 4 years of UK tax residence.
- **4-Year Eligibility Criteria**: Individuals who were non-UK resident for at least 10 consecutive tax years prior to arrival can claim 100% tax relief on qualifying foreign income and gains for up to 4 tax years.

### 2. What Changes in `tax-core` & Calculation Engine
- **Income Tax Calculation**: Foreign income elected under the FIG regime is completely excluded from UK taxable non-savings, savings, and dividend income bands.
- **Loss of Personal Allowance**: Claiming the FIG regime results in loss of the UK Personal Allowance (£12,570) and Capital Gains Tax Annual Exempt Amount, identical to the old remittance basis loss-of-allowance rule.

### 3. XML Schema & HMRC Spec Target
- **2024-25 Reference Schema**: `SA100/24-25/1` (used for current LTS/ETS testing).
- **2025-26 Live Target Schema**: `SA100/25-26/1` (requires updating XML namespace URLs and incorporating FIG element nodes when published by HMRC SDST).
