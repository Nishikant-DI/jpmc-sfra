# PCI Compliance Notes — JPMC Payment Cartridge

> **Version:** 1.0  
> **Last Updated:** 2026-03-17  
> **Audience:** Developers, PCI QSAs, Security Reviewers

---

## 1. Cardholder Data Handling

### 1.1 Raw CVV (Security Code) — Session-Memory Only

The CVV is **never** written to any persistent store (database, custom object, log, or file).

| Stage | Location | Lifetime |
|---|---|---|
| `Handle()` — new card | `session.privacy.jpmcEncryptedCardData` (PIE-encrypted blob, contains encrypted CVV) | Cleared in `authorize()` `finally` block |
| `Handle()` — stored card | `session.privacy.jpmcCardCVV` (raw CVV digits) | Cleared in `authorize()` `finally` block |
| `authorize()` | Passed to `JPMCPaymentHelper.createPayment()` via `session.privacy` | Cleared immediately in `finally` block regardless of success/failure |

**Key code path:**
- `jpmc_payment.js` → `Handle()` stores CVV in `session.privacy` (memory-only)
- `jpmcTransactionHelpers.js` → `authorize()` reads from `session.privacy`, sends to JPMC API, then clears in `finally` block via `clearSensitivePaymentData()`
- `clearSensitivePaymentData()` nulls out: `jpmcEncryptedCardData`, `jpmcEncryptedNumber`, `jpmcCardCVV`

**Why session.privacy?**  
SFCC `session.privacy` is an in-memory-only namespace. It is:
- Never serialized to the database
- Never included in replication
- Automatically destroyed when the session expires
- Not accessible from other sessions

### 1.2 PIE (Page Integrity & Encryption)

For new card entries, the raw PAN and CVV are **never sent to the server in cleartext**. They are encrypted client-side by JPMC's PIE JavaScript library before form submission. The server only receives the PIE-encrypted blob, which is:
1. Stored in `session.privacy.jpmcEncryptedCardData` (memory-only)
2. Forwarded to the JPMC API in the authorization request
3. Cleared from session in the `finally` block

### 1.3 Stored/Tokenized Cards

For returning customers using a saved card:
- The card is represented by a SAFETECH token (stored in `creditCardToken` on the wallet `PaymentInstrument`)
- Only the CVV is collected at checkout (required for re-authentication)
- The raw CVV is held in `session.privacy.jpmcCardCVV` for the duration of the authorization flow only
- It is cleared in the `finally` block of `authorize()`

---

## 2. Google Pay Token Handling

The Google Pay encrypted payment token is **never persisted to the database**.

| Stage | Location | Lifetime |
|---|---|---|
| `processForm()` | `session.privacy.jpmcGooglePayToken` | Until `authorizeGooglePay()` `finally` block |
| `authorizeGooglePay()` | Read from `session.privacy`, parsed, sent to JPMC | Cleared in `finally` block |

**Before audit fix (GP-1):** The token was written to `paymentInstrument.custom.jpmcGooglePayToken` (database-persisted). This was remediated to use `session.privacy` only.

---

## 3. Apple Pay Token Handling

The Apple Pay encrypted payment bundle is:
1. Received in the `authorizeOrderPayment` hook event
2. Mapped to the JPMC `encryptedPaymentBundle` format in-memory
3. Sent to the JPMC API in the same request
4. **Never stored** on any persistent object

The raw `paymentData` from Apple's token is **never logged**. Only safe metadata (order number) is logged.

---

## 4. Logging Policy

The cartridge follows a strict **no-sensitive-data-in-logs** policy:

- ❌ Raw PAN, CVV, encrypted card data — never logged
- ❌ Google Pay / Apple Pay tokens — never logged
- ✅ Order numbers, transaction IDs, response statuses — logged at `info` level
- ✅ Error messages (without card data) — logged at `error` level
- ✅ Fraud fail-open events — logged at `error` level with `FRAUD_FAIL_OPEN` prefix for SOC/SIEM alerting

---

## 5. Fraud Detection — Fail-Open Policy

When the fraud detection service is unreachable or returns an error, the cartridge **fails open** (allows the transaction to proceed). This is a deliberate business decision to avoid blocking legitimate transactions during service outages.

**Mitigation:**

- These should be routed to SOC/SIEM dashboards for real-time monitoring
- Orders that pass through fail-open should be flagged for manual review

---

## 6. Data Flow Summary

```
Customer Browser
  │
  ├── New Card: PIE.js encrypts PAN+CVV client-side
  ├── Stored Card: Only CVV entered
  ├── Google Pay: Token from Google Pay API
  └── Apple Pay: Token from Apple Pay JS
  │
  ▼
SFCC Server (session.privacy — memory only)
  │
  ├── session.privacy.jpmcEncryptedCardData (PIE blob)
  ├── session.privacy.jpmcCardCVV (stored card CVV)
  ├── session.privacy.jpmcGooglePayToken (GP token)
  └── Apple Pay token (function-scoped variable, never stored)
  │
  ▼
JPMC Payment API (HTTPS)
  │
  ▼
session.privacy fields cleared in finally{} block
```

---
