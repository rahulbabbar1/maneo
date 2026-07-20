# Fraud-Prevention Headers Applicability Determination (T3.5 / FM-6)

## Executive Summary
This document records the formal technical and regulatory determination regarding HMRC **Gov-Client-\*** fraud-prevention headers for Maneo v1 (Self Assessment Legacy Filing Rail).

---

## Ground Truth Determination

1. **Legacy Transaction Engine (SOAP / GovTalk XML Rail)**:
   - **Applicability**: **NOT APPLICABLE for v1 filing authentication**.
   - **Mechanism**: The legacy Self Assessment online filing rail authenticates submissions using:
     - 4-digit Vendor ID (`Header/MessageDetails/Class`)
     - Sender Credentials (`GovTalkDetails/Keys`)
     - W3C C14N SHA-1 IRmark signature inserted in `<IRmark>` header.
   - **Conclusion**: Submitting or withholding `Gov-Client-*` HTTP headers does not impact acceptance by HMRC's Transaction Engine / TPVS service for legacy XML filings.

2. **Making Tax Digital (MTD) for Income Tax (ITSA REST API Rail - v2 Migration)**:
   - **Applicability**: **MANDATORY by Law (Customs and Excise Management Act & MTD Regulations)**.
   - **Mechanism**: All MTD REST API endpoints (`/income-tax-submission/...`) enforce strict validation of `Gov-Client-Browser-JS-User-Agent`, `Gov-Client-Device-ID`, `Gov-Client-Local-IPs`, `Gov-Client-Multi-Factor`, etc.
   - **Implementation State**: Maneo's `fraud-headers-assembler.ts` is fully implemented and tested. It is retained in `packages/hmrc-integration` as forward-compatible infrastructure ready for the v2 MTD ITSA migration.

---

## Verdict
- **v1 Legacy SA100/SA102/SA109 Filing**: No Week 3 filing gate is blocked on fraud header submission to Transaction Engine.
- **v2 MTD Migration**: Fraud header assembler is fully active and validated.
