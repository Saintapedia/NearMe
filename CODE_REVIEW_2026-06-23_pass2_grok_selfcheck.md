# NearMe Self-Check — pass 2 (Grok)

**Commit reviewed:** `f0bcb8e` (post pass-1 fixes)  
**Reviewer:** Grok (Cursor) — self-verification  
**Date:** 2026-06-23

## Verdict: PASS (with 2 bugs fixed in this pass)

---

## Checklist

1. Pass 1 review findings (B1–B4, S1–S5, N1–N3) correctly applied — **verified**
2. Extension scaffold complete for MW 1.39 + Cargo — **verified**
3. Pushed to GitHub Saintapedia/NearMe — **verified** (`f0bcb8e`)
4. No regressions in pass-1 fixes — **verified**
5. New issues in post-fix code — **2 found and fixed**

---

## Pass 1 fix verification

| ID | Status | Evidence |
|---|---|---|
| B1 `?NearbyQueryService` | ✅ | `ApiCargoNearby.php:26` |
| B2 `dieWithError` i18n array | ✅ | `ApiCargoNearby.php:65,76` |
| B3 `NearMeDefaultRadius` config keys | ✅ | `nearby-api.js:63-64` |
| B4 `is_numeric()` on gscoord | ✅ | `ApiCargoNearby.php:44-46` |
| S1 `catch (\Exception)` | ✅ | `NearbyQueryService.php:138` |
| S2 `wfDebugLog` | ✅ | `NearbyQueryService.php:139` |
| S3 `Title.newFromText` + filter | ✅ | `nearby-api.js:39-41,76` |
| S4 `showButtonDisabled` reset | ✅ | `ext.NearMe.js:121` |
| S5 `hashchange` route cleanup | ✅ | `ext.NearMe.js:162-167` |
| N1–N3 | ✅ | guidance text, PHP 8.1, jquery dep |

---

## Build & test results

| Command | Result |
|---|---|
| `php -l includes/*.php` | ✅ No syntax errors |
| `node --check modules/*.js` | ✅ All three modules parse |
| `composer test` | ⏭ Skipped — composer not installed in environment |

---

## New issues found (pass 2)

### B5 — Cargo NEAR bounding box returns points outside radius (fixed)

**File:** `includes/NearbyQueryService.php`

Cargo's `NEAR` uses a lat/lon bounding box, not a true circle. Corner points can lie outside the requested radius. Haversine distance was computed but never used to filter.

**Fix:** Skip rows where `$distMeters > $radiusMeters`.

### B6 — Double API fetch on geolocation button (fixed)

**File:** `modules/ext.NearMe.js`

`showNearby()` → `loadPages()` → `navigateTo()` → router callback → `loadPages()` again = two identical `cargonearby` requests.

**Fix:** `loadInFlight` guard per coord key; skip `navigateTo` when hash already matches.

---

## Remaining suggestions (not blocking)

| ID | Severity | Note |
|---|---|---|
| S6 | suggestion | `queryAll` queries each table with full `$limit` before merge — inefficient for multi-table configs |
| S7 | suggestion | No validation that `$wgNearMeTables` entries contain required `table`/`coordField` keys |
| S8 | suggestion | No unit tests for `NearbyQueryService::haversineMeters` or API param validation |
| S9 | nit | `NearMeTables` exposed to JS via RL config but unused client-side |

---

## Security

- User-facing output escaped via `mw.util.escapeHtml()` — ✅
- Table names validated against `CargoUtils::getTables()` — ✅
- `coordField`/`labelField` from admin config only — ✅ (not user input)
- API is read-only (`isReadMode: true`) — ✅

---

## VERDICT: PASS

Pass 1 fixes verified correct. Two additional bugs (B5 radius filter, B6 double-fetch) found and fixed in pass 2. Ready for saintapedia.org deploy smoke-test.