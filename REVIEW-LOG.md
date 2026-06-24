# NearMe Review Log

Cross-agent handoff index. **Newest entries at the top.**

Grok (Cursor) reads this file to learn when Claude Code has finished a review and where to find comments.

---

## Pass 1 fixes applied (Grok)

| Field | Value |
|-------|-------|
| **Status** | `fixed` |
| **Review** | `CODE_REVIEW_2026-06-23_pass1_7538685.md` |
| **Fix report** | `FIX_REPORT_pass1_7538685.md` |
| **Version** | 0.1.1 |
| **Fixed by** | Grok (Cursor) |

All 4 bugs, 5 suggestions, and 3 nits from pass 1 addressed.

---

## Pass 1 review — complete

## Active review — pass 1 complete

| Field | Value |
|-------|-------|
| **Status** | `complete` |
| **Requested** | 2026-06-23 |
| **Scope** | Initial NearMe extension scaffold (Option 1): Cargo-backed Special:Nearby |
| **Baseline commit** | `7538685` |
| **Reviewer** | Claude Code |
| **Output file** | `CODE_REVIEW_2026-06-23_pass1_7538685.md` |
| **Completed at** | 2026-06-23T12:00:00-04:00 |

### Summary for Grok

- **4 bugs** / **5 suggestions** / **3 nits** — full details in `CODE_REVIEW_2026-06-23_pass1_7538685.md`
- **B1 (PHP):** `ApiCargoNearby::__construct` uses implicit nullable (`NearbyQueryService $queryService = null`) — E_DEPRECATED on PHP 8.1; change to `?NearbyQueryService`.
- **B2 (PHP):** Both `dieWithError('nearme-error-unknown-table', ...)` calls pass the table name as API `$data` instead of as an i18n param, so error messages show literal `$1` instead of the table name. Fix: `$this->dieWithError( ['nearme-error-unknown-table', $tableFilter], 'unknown-table' )`.
- **B3 (JS — highest impact):** `mw.config.get('wgNearMeDefaultRadius')` and `mw.config.get('wgNearMeDefaultLimit')` in `nearby-api.js` use the wrong key prefix. ResourceLoader module config keys are exposed without `wg`; the keys should be `'NearMeDefaultRadius'` / `'NearMeDefaultLimit'`. As-is, admin-configured radius/limit is **always silently ignored** and hardcoded fallbacks (10000m, 50) are used.
- **B4 (PHP):** `gscoord` parts are not checked with `is_numeric()` before casting — empty string casts to `0.0` and passes the range check, silently querying near lat=0,lon=0.
- **S1:** `queryAll` catches only `MWException`; `Wikimedia\Rdbms\DBError` from Cargo/DB propagates as a 500.
- **S3:** `new mw.Title(row.title)` in `toCard()` throws on invalid titles, breaking the whole result list — use `mw.Title.newFromText()` and filter nulls.
- **S5:** Third argument to `mw.router.addRoute()` (exit callback) may not be supported in MW 1.39 — navigate-away does not clear results; needs testing.
- CSS is clean; XSS risks in the JS template are well-handled via `mw.util.escapeHtml()`.

---

*Add new review cycles above the "Active review" section when starting the next pass.*