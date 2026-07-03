# Vendored HMRC Artefacts

This package is a local directory housing all HMRC schemas, GovTalk envelope XML specifications, mapping tables, and test assets to guarantee that the application can be built, validated, and run completely offline (independent of external network fetches).

## Directory Structure

```
/packages/hmrc-artefacts
  /schemas
    /2025-26
      - sa100-v1.xsd        # Legacy SA100 Core Schema
      - sa102-v1.xsd        # Legacy SA102 Employment Supplementary Schema
      - sa106-v1.xsd        # Legacy SA106 Foreign income Schema
      - sa109-v1.xsd        # Legacy SA109 Residence & Domicile Schema
  /govtalk
    - envelope-spec.pdf     # GovTalk Message Envelope specification
    - ir-mark-spec.pdf      # IRmark algorithm description document
  /mappings
    - mtd-sa-mapping.csv    # HMRC MTD API parameter to SA box number mappings
```

## Setup Instructions

1. **Obtain schemas:** Download the official Self Assessment XML technical packs for the relevant tax years from the [HMRC Developer Hub](https://www.gov.uk/government/publications/self-assessment-technical-specifications).
2. **Download mappings:** Fetch the CSV box mappings from the public repository `hmrc/income-tax-mtd-changelog` on GitHub.
3. **Verify locally:** Place them in the respective folders above. The XML compilation steps inside `apps/hmrc-integration` will read from this directory.
