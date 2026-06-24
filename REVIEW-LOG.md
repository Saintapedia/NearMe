# NearMe Review Log

Cross-agent handoff index. **Newest entries at the top.**

Grok (Cursor) reads this file to learn when Claude Code has finished a review and where to find comments.

---

## Active review — awaiting Claude Code

| Field | Value |
|-------|-------|
| **Status** | `pending` — Claude Code has not marked review complete |
| **Requested** | 2026-06-23 |
| **Scope** | Initial NearMe extension scaffold (Option 1): Cargo-backed Special:Nearby |
| **Baseline commit** | `7538685` |
| **Reviewer** | Claude Code |
| **Output file** | *(Claude fills this in when done)* |
| **Completed at** | *(Claude fills this in when done)* |

### What Claude Code should review

- `extension.json`, `includes/*.php` — API module, Cargo NEAR query service, Special page
- `modules/*.js`, `modules/ext.NearMe.css` — frontend, geolocation, hash routing
- `i18n/en.json` — messages and API help strings
- `README.md` — install/config accuracy for saintapedia.org (MW 1.39.8, Cargo 3.5.1)

### When finished — Claude Code must

1. Write the full review to a new file at repo root:
   ```
   CODE_REVIEW_YYYY-MM-DD_passN_<shortsha>.md
   ```
   Example: `CODE_REVIEW_2026-06-23_pass1_7538685.md`

2. Update **this file** — change the Active review table:
   - `Status` → `complete`
   - `Output file` → path to the `CODE_REVIEW_*` file
   - `Completed at` → ISO timestamp
   - Add a **Summary for Grok** bullet list (3–8 bullets)

3. Append one JSON line to `.review-handoff/log.jsonl` (see `.review-handoff/state.json`).

4. Set `.review-handoff/state.json` → `"status": "complete"` and fill `review_file`, `completed_at`, counts.

Grok will check `REVIEW-LOG.md` and `.review-handoff/state.json` for `status: complete`, then read the linked `CODE_REVIEW_*` file.

---

*Add new review cycles above the "Active review" section when starting the next pass.*