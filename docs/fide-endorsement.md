# FIDE Swiss Software Endorsement

## Overview

FIDE endorses pairing software through its **Systems of Pairings and Programs Commission
(SPPC)**, now part of the **Technical Commission (TEC)**. Endorsed status allows the
software to be used in FIDE-rated Swiss tournaments.

- Endorsement procedure: <https://spp.fide.com/c-04-a-appendix-endorsement-of-a-software-program/>
- Currently endorsed programs: <https://tec.fide.com/endorsement/>

---

## How to Apply

Submit an **FE-1 form** to the SPPC secretariat:

- **FE-1 application form:** <https://www.fide.com/FIDE/handbook/C04Annex1_FE1.pdf>

The application must be submitted **at least 4 months before** the FIDE Congress at which
it will be reviewed.

### Next FIDE Congress

The **2025 Congress** took place online on **14 December 2025** (commissions met
24–28 November 2025).

The **2026 Congress** date has not been announced yet — the official page shows TBA:
<https://congress.fide.com/general-assembly-2026/>

Monitor that page for the announcement. Once the date is set, count back 4 months to
determine your FE-1 submission deadline.

---

## Requirements

The software must satisfy all of the following before an endorsement can be granted:

1. **Pairing system** — must implement the FIDE Dutch System (C.04.3) or another
   FIDE-approved system (Dubov, Burstein, Lim).
2. **English interface** — a FIDE mode with a full English language UI.
3. **TRF16 support** — import and export of files in the FIDE Data Exchange Format
   (TRF16, or TRF06 for legacy compatibility).
   - TRF16 spec: <https://www.fide.com/FIDE/handbook/C04Annex2_TRF16.pdf>
4. **Free Pairings Checker (FPC)** — a CLI tool bundled with the program that reads a
   `.trf` file and verifies, round by round, whether the stored pairings match those
   produced by the embedded pairing engine. Example invocation:
   ```
   yourprogram -check tournament.trf
   ```
5. **Free Random Tournament Generator (RTG)** — a CLI tool that generates simulated
   tournaments and outputs full TRF16 files (may be exempted by the SPPC).
6. **Controlled-environment testing** — the program must be testable in a controlled
   setting by the SPPC subcommittee.
7. **Verification Check List (VCL)** — full compliance with all items listed in:
   <http://spp.fide.com/wp-content/uploads/2020/04/C04Annex4_VCL19.pdf>

> Complying with all requirements above is necessary but **not sufficient** to receive
> endorsement — the SPPC subcommittee makes the final determination.

---

## Verification Process

When other programs are already endorsed for the same pairing system, the SPPC runs an
automated verification:

1. An existing endorsed RTG generates **5 000 random tournaments** (TRF16 files).
2. Each file is fed into the candidate **FPC**.
3. Every discrepancy (up to 10) is collected and categorised:
   - **RTG error** — redirected to the RTG provider.
   - **Candidate error** — must be corrected before the Congress presentation.
   - **Rule ambiguity** — referred to the SPPC for a formal clarification.
4. If the candidate supplies its own RTG, 5 000 additional tournaments are generated and
   checked against one or more existing FPCs.

---

## Endorsement Cycle

Endorsements follow a **four-year cycle** tied to leap years (e.g. 2020–2024,
2024–2028):

| Period | Description |
|--------|-------------|
| Years 1–3 of cycle | Endorsements granted; valid until end of cycle. |
| Year 4 of cycle | No new endorsements issued (applications accepted for the next cycle). |
| Transition Period | Jan 1 – Congress of Year 1; SPPC runs renewal/new endorsement procedures. |
| Interim Certificate | Issued during Transition Period; allows immediate use pending Congress ratification. |

An endorsed program is removed from the list if it fails the renewal procedure and the
Congress acknowledges the failure.

---

## Error Correction

If a bug is reported in an endorsed program:

| Severity | Fix deadline |
|----------|-------------|
| Major | 2 weeks from SPPC notification |
| Minor | 2 months from SPPC notification |

Failure to fix within the deadline results in automatic suspension of the endorsement.

---

## Key Documents

| Document | Link |
|----------|------|
| FE-1 Application Form | <https://www.fide.com/FIDE/handbook/C04Annex1_FE1.pdf> |
| TRF16 Format Spec | <https://www.fide.com/FIDE/handbook/C04Annex2_TRF16.pdf> |
| TRF06 Format Spec | <https://ratings.fide.com/download/fidexchg.txt> |
| Verification Check List (VCL19) | <http://spp.fide.com/wp-content/uploads/2020/04/C04Annex4_VCL19.pdf> |
| List of Endorsed Programs | <https://handbook.fide.com/files/handbook/C04Annex3_FEP22.pdf> |
| Full Endorsement Procedure (C.04.A) | <https://spp.fide.com/c-04-a-appendix-endorsement-of-a-software-program/> |
| FIDE Dutch System Rules (C.04.3) | <https://spp.fide.com/c-04-3-fide-dutch-system/> |
| SPPC / TEC Contact | <https://tec.fide.com/contact/> |
