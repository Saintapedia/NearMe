# NearMe Fix Report — pass 1

**Review:** `CODE_REVIEW_2026-06-23_pass1_7538685.md`  
**Fixed by:** Grok (Cursor)  
**Date:** 2026-06-23

## Summary

Addressed all 4 bugs and 5 suggestions from Claude Code pass 1 review. Also applied 3 nits. Version bumped to 0.1.1.

## Bugs fixed

| ID | File | Fix |
|---|---|---|
| B1 | `includes/ApiCargoNearby.php` | `?NearbyQueryService` explicit nullable constructor param |
| B2 | `includes/ApiCargoNearby.php` | `dieWithError( [ 'nearme-error-unknown-table', $table ], ... )` at both call sites |
| B3 | `modules/nearby-api.js` | `mw.config.get( 'NearMeDefaultRadius' )` / `'NearMeDefaultLimit'` (no `wg` prefix) |
| B4 | `includes/ApiCargoNearby.php` | `is_numeric()` guard on `gscoord` parts before float cast |

## Suggestions fixed

| ID | File | Fix |
|---|---|---|
| S1 | `includes/NearbyQueryService.php` | `catch ( \Exception $e )` instead of `MWException` only |
| S2 | `includes/NearbyQueryService.php` | `wfDebugLog( 'NearMe', ... )` instead of `wfLogWarning()` |
| S3 | `modules/nearby-api.js` | `mw.Title.newFromText()` + `.filter( Boolean )` |
| S4 | `modules/ext.NearMe.js` | Reset `showButtonDisabled` at start of `showNearby()` |
| S5 | `modules/ext.NearMe.js` | Removed undocumented router exit callback; `hashchange` listener clears stale results |

## Nits fixed

| ID | Fix |
|---|---|
| N1 | Append `nearme-error-guidance` when showing `nearme-error` |
| N2 | README + composer.json PHP requirement → `>= 8.1` |
| N3 | Added `jquery` to `ext.NearMe` module dependencies |

## Verification

Static fixes only — no live MW/Cargo environment in this session.