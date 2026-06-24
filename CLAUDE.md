# CLAUDE.md — NearMe

MediaWiki extension: Cargo-backed **Special:Nearby** for [Saintapedia](https://saintapedia.org).

**Repo:** https://github.com/Saintapedia/NearMe  
**Local path:** `/home/tom/NearMe`  
**Stack target:** MediaWiki 1.39.8, PHP 8.1+, Cargo 3.5.1

## Review handoff (read this when asked to review)

You are reviewing the NearMe extension so **Grok can read your findings next**.

### Deliverables

| # | Action | Path |
|---|--------|------|
| 1 | Write full review | `/home/tom/NearMe/CODE_REVIEW_YYYY-MM-DD_passN_<shortsha>.md` |
| 2 | Update status index | `/home/tom/NearMe/REVIEW-LOG.md` |
| 3 | Set machine-readable done flag | `/home/tom/NearMe/.review-handoff/state.json` |
| 4 | Append completion event | `/home/tom/NearMe/.review-handoff/log.jsonl` |

### Review file template (`CODE_REVIEW_*.md`)

```markdown
# NearMe Code Review — pass N

**Commit:** `<full or short sha>`
**Reviewer:** Claude Code
**Date:** YYYY-MM-DD

## Summary
(2–4 sentences)

## Bugs (must fix)
- ...

## Suggestions (should fix)
- ...

## Nits (optional)
- ...

## Verification notes
(what you ran or could not run)
```

### On completion — update `state.json`

```json
{
  "status": "complete",
  "review_file": "CODE_REVIEW_2026-06-23_pass1_7538685.md",
  "completed_at": "<ISO-8601 timestamp>",
  "summary_for_grok": "<one paragraph>",
  "counts": { "bugs": 0, "suggestions": 2, "nits": 1 }
}
```

### On completion — append to `log.jsonl`

```json
{"event":"review_complete","pass":1,"file":"CODE_REVIEW_...","bugs":0,"suggestions":2,"nits":1,"sha":"7538685","at":"<ISO-8601>"}
```

### On completion — update `REVIEW-LOG.md`

Change the **Active review** table: `Status` → `complete`, fill `Output file`, `Completed at`, and add **Summary for Grok** bullets.

**Grok checks `REVIEW-LOG.md` and `.review-handoff/state.json` for `status: complete`, then opens `review_file`.**

## Architecture (quick reference)

```
Special:Nearby → ext.NearMe.js → action=cargonearby
    → NearbyQueryService → CargoSQLQuery (NEAR)
```

Config: `$wgNearMeTables`, `$wgNearMeDefaultRadius`, `$wgNearMeDefaultLimit` in `LocalSettings.php`.

**Saintapedia Parishes schema** ([Special:Drilldown/Parishes](https://saintapedia.org/wiki/Special:Drilldown/Parishes)):

| Field | Type |
|-------|------|
| Dedication | Page |
| ShortName | Text |
| Diocese | Page |
| Deanery | Page |
| MailingAddress | Searchtext |
| **ParishLocation** | **Coordinates** ← `coordField` |
| City | Page |
| AdministrativeSubdivision | Page |
| Country | Page |
| County | Page |
| ParishImage | File |
| ParishWebsite | URL |
| ParishFounded | Start date |
| ParishSchool | Boolean |
| ParishEmailAddress | Email |
| VeneratedSaints | List of Page |
| Type | List of String |
| IsNonParochial | Boolean |
| OperatedBy | Page |
| Maintenance | List of String |

NearMe config: `ParishLocation` + `ShortName` (falls back to wiki page title when ShortName is empty).

## Key files

| Path | Role |
|------|------|
| `extension.json` | manifest, APIModules, RL modules |
| `includes/NearbyQueryService.php` | Cargo NEAR + haversine |
| `includes/ApiCargoNearby.php` | `action=cargonearby` |
| `includes/SpecialNearby.php` | Special:Nearby |
| `modules/ext.NearMe.js` | frontend (no Vue/Codex — MW 1.39) |

## Prior art

- Options analysis: `cargo-nearby-options.md`
- SaintapediaDrilldown deploy lesson: extension folder name must match manifest `name` exactly (`NearMe`)