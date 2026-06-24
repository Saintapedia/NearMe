# NearbyPages-Style Location Search for Saintapedia (Cargo Coordinates)

**Date:** 2026-06-23  
**Context:** [saintapedia.org](https://saintapedia.org) uses **Cargo 3.5.1** on **MediaWiki 1.39.8** for structured data. The goal is functionality comparable to [Extension:NearbyPages](https://www.mediawiki.org/wiki/Extension:NearbyPages) — a mobile-friendly "what's near me?" experience — but sourcing results from **Cargo `Coordinates` fields** rather than GeoData's `geo_tags` table.

---

## Problem Statement

| NearbyPages expects | Saintapedia has |
|---|---|
| [Extension:GeoData](https://www.mediawiki.org/wiki/Extension:GeoData) installed | Cargo tables with `Coordinates`-typed fields |
| `action=query&list=geosearch` API | `#cargo_query` with the native **`NEAR`** command |
| Page-level geotags in `geo_tags` | Row-level coords in Cargo storage tables (e.g. `Parishes`, `Saints`, `Churches`) |

Cargo already supports geospatial queries:

```wikitext
{{#cargo_query:
tables=Parishes
|fields=_pageName=Parish,City,Coordinates
|where=Coordinates NEAR (40.4406, -79.9959, 25 km)
|order by=_pageName
|limit=50
|format=table
}}
```

NearbyPages does **not** read Cargo. Bridging that gap is the design question.

---

## Rating System: **NEAR-FIT** (max 100 points)

Each option is scored 1–10 on seven criteria, then multiplied by weight.

| ID | Criterion | Weight | What 10 means | What 1 means |
|---|---|---|---|---|
| **U** | **UX fidelity** | 20% | Indistinguishable from Special:Nearby (geolocation, distance sort, mobile list, manual coords) | Static table only, no "near me" flow |
| **E** | **Implementation effort** *(inverse)* | 15% | Shippable in hours with templates only | Multi-month custom extension + frontend |
| **C** | **Cargo-native** | 20% | Reads Cargo coords in place; zero duplicate geo store | Requires mirroring coords into a second system |
| **P** | **Performance at scale** | 15% | Sub-second queries at ~20k parish-scale rows | Full table scans or parser-heavy pages |
| **M** | **Maintenance burden** *(inverse)* | 10% | Set-and-forget wiki content | Ongoing sync jobs, dual-source drift |
| **R** | **Deployment risk** | 10% | No new PHP extensions on live wiki | New extension + schema + API surface (recall SaintapediaDrilldown white-screen incident) |
| **X** | **Extensibility** | 10% | Multi-table queries, filters, future APIs | Locked to one template/table |

**Total score** = Σ (score × weight × 10), rounded to one decimal.

---

## The Five Options

### Option 1 — Custom `SaintapediaNearby` Extension (Integrated Special Page)

**Summary:** Fork the NearbyPages Vue.js frontend and build a sibling extension that registers `Special:Nearby` (or `Special:NearbySaints`) backed by Cargo's `NEAR` SQL generation in PHP.

**Architecture:**
```
Browser geolocation → Vue SPA (forked from NearbyPages)
    → action=cargonearby (new API module)
        → CargoQuery::query( WHERE Coordinates NEAR (...) )
            → JSON [{title, lat, lon, dist, pageid}, ...]
```

**Implementation sketch:**
- `extension.json` + `includes/ApiCargoNearby.php`
- Reuse NearbyPages resource loader modules where possible
- Config: `$wgSaintapediaNearbyTables`, `$wgSaintapediaNearbyCoordField`, `$wgSaintapediaNearbyDefaultRadius`
- Optional compound query across `Saints`, `Parishes`, `Churches` via UNION

**Pros:** Best in-wiki UX; full control; matches existing SaintapediaDrilldown extension pattern.  
**Cons:** Largest build; must track MW 1.39 + Cargo 3.5 compatibility; deployment risk on production.

| U | E | C | P | M | R | X |
|---|---|---|---|---|---|---|
| 9 | 3 | 10 | 8 | 5 | 4 | 9 |

**NEAR-FIT: 72.5 / 100** — Rank **#4**

---

### Option 2 — GeoData Mirror Bridge + Stock NearbyPages

**Summary:** Install GeoData and NearbyPages unchanged. Add a Cargo hook (`PageSaveComplete` or `CargoStore`) that copies each row's coordinates into GeoData's `geo_tags` table so `list=geosearch` works out of the box.

**Architecture:**
```
{{#cargo_store:...|Coordinates=...}}  →  Cargo table
    ↓ (on save hook)
geo_tags (page-level geotag)
    ↓
Stock NearbyPages → list=geosearch
```

**Implementation sketch:**
- `wfLoadExtension('GeoData')` + `wfLoadExtension('NearbyPages')`
- Small bridge extension OR maintenance script `syncCargoToGeoData.php`
- Map `_pageName` → wiki page title; handle multi-row-per-page edge cases

**Pros:** Upstream NearbyPages UX with zero frontend work; battle-tested geosearch.  
**Cons:** **Dual source of truth** — Cargo and GeoData can drift; GeoData adds DB tables; multi-row Cargo tables (many parishes per diocese page?) map poorly to page-level geotags.

| U | E | C | P | M | R | X |
|---|---|---|---|---|---|---|
| 10 | 6 | 2 | 9 | 3 | 5 | 4 |

**NEAR-FIT: 58.5 / 100** — Rank **#5**

---

### Option 3 — Wiki Templates + Gadget (No New Extension)

**Summary:** Create a `Project:NearMe` page (or `Special:RunQuery` form) with a parameterized `#cargo_query` using `NEAR`. Add a **Gadget** or **site JS** module that reads `navigator.geolocation`, then navigates to the page with lat/lon/radius URL parameters parsed by a Scribunto Lua wrapper or PageForms RunQuery.

**Architecture:**
```
User clicks "Near me" gadget
    → window.location = /wiki/Project:NearMe?lat=40.44&lon=-79.99&r=25
        → Lua module reads args → cargo_query NEAR
            → Rendered HTML table/list
```

**Example query page content:**
```wikitext
{{#cargo_query:
tables=Parishes
|fields=_pageName,City,Coordinates
|where=Coordinates NEAR ({{#invoke:NearMe|coord}}, {{#invoke:NearMe|radius}})
|format=table
}}
```

**Pros:** Zero extension deployment risk; fastest to prototype; entirely Cargo-native.  
**Cons:** Weak UX vs NearbyPages (no Vue list, no distance column unless computed, awkward geolocation permission flow, parser cache may fight dynamic coords).

| U | E | C | P | M | R | X |
|---|---|---|---|---|---|---|
| 4 | 9 | 10 | 5 | 9 | 9 | 3 |

**NEAR-FIT: 70.0 / 100** — Rank **#3**

---

### Option 4 — Maps Extension + Cargo `NEAR` Map Discovery Page

**Summary:** Install [Maps for MediaWiki](https://maps.extension.wiki/) (Cargo integration since v7.18). Build a map-centric "near me" page using `#cargo_query` with `format=map` or `format=leaflet`, centered on user coordinates via URL params or a small JS bootstrap.

**Architecture:**
```
Geolocation JS sets center → Project:NearMeMap?center=40.44,-79.99
    → {{#cargo_query: ... |where=Coordinates NEAR (...)|format=map}}
        → Leaflet map with clickable markers → wiki pages
```

Cargo + Maps also supports compound queries for multiple entity types with different marker icons.

**Pros:** Rich spatial UX; well-maintained third-party extension; no GeoData duplication; good for parish/church discovery.  
**Cons:** Map-first, not list-first — different UX than NearbyPages; still needs JS for geolocation; another extension dependency.

| U | E | C | P | M | R | X |
|---|---|---|---|---|---|---|
| 7 | 7 | 10 | 7 | 7 | 7 | 8 |

**NEAR-FIT: 77.0 / 100** — Rank **#2**

---

### Option 5 — Thin `cargonearby` API Shim + Standalone Vue SPA

**Summary:** Minimal PHP extension (~200 lines) exposing `action=cargonearby` that returns geosearch-compatible JSON from Cargo `NEAR`. Deploy the NearbyPages standalone Vue app ([demo](https://wikipedia-nearby.netlify.app/)) pointed at `$wgNearbyPagesUrl` / a forked config — either on `nearby.saintapedia.org`, GitHub Pages, or embedded via iframe.

**Architecture:**
```
Static Vue app (NearbyPages fork, ~config change)
    → saintapedia.org/api.php?action=cargonearby&gscoord=...&gsradius=...
        → Cargo NEAR query
            → {query: {geosearch: [{title, lat, lon, dist}]}}
```

**API response shim** mirrors `list=geosearch` shape so the stock NearbyPages frontend works with minimal changes.

**Pros:** Smallest PHP footprint on production wiki; frontend failures isolated from wiki; easy to iterate UI; Cargo-native; mirrors how Wikimedia ships standalone Nearby demos.  
**Cons:** Two deployables; CORS/auth considerations for API; not a native `Special:` page (unless iframe-embedded).

| U | E | C | P | M | R | X |
|---|---|---|---|---|---|---|
| 9 | 7 | 10 | 8 | 7 | 8 | 9 |

**NEAR-FIT: 84.5 / 100** — Rank **#1** ⭐

---

## Final Rankings

| Rank | Option | NEAR-FIT | One-line verdict |
|---|---|---|---|
| **1** | **Option 5** — API shim + standalone Vue SPA | **84.5** | Best balance: Cargo-native, low deploy risk, NearbyPages UX |
| **2** | **Option 4** — Maps + Cargo NEAR map page | **77.0** | Strong spatial UX if map discovery is acceptable |
| **3** | **Option 1** — Full SaintapediaNearby extension | **72.5** | Best long-term in-wiki integration, highest build cost |
| **4** | **Option 3** — Templates + gadget | **70.0** | Fastest prototype, weakest polish |
| **5** | **Option 2** — GeoData mirror + stock NearbyPages | **58.5** | Avoid — duplicates data, sync drift |

> **Note:** Options 1 and 3 are close (72.5 vs 70.0). Choose **1 over 3** when polished `Special:Nearby` inside the wiki is a hard requirement. Choose **3 over 1** when you need something live this week with zero extension risk.

---

## Recommended Path (Phased)

### Phase A — Validate coords (1 day)
1. Confirm which Cargo tables have `Coordinates` fields (`Special:CargoTables`).
2. Run a manual `NEAR` query from `Special:ViewData` against a known Pittsburgh coordinate.
3. Verify `_pageName` values link to real wiki pages.

### Phase B — Ship Option 5 MVP (3–5 days)
1. Scaffold `SaintapediaCargoNearby` extension with `ApiCargoNearby`.
2. Fork NearbyPages static app; point API URL at saintapedia.org.
3. Test geolocation + manual `#/coord/lat,lon` routing.
4. Embed link in wiki sidebar: "Nearby Saints" / "Nearby Parishes".

### Phase C — Enhance (optional)
- Merge Option 4 map view as a second tab in the SPA.
- If in-wiki `Special:` page is required, promote Option 5 API into full Option 1 extension shell.

---

## Sample API Module Contract (Option 5)

**Request** (geosearch-compatible):
```
GET /api.php?action=cargonearby&format=json
    &gscoord=40.4406|-79.9959
    &gsradius=25000
    &gslimit=50
    &table=Parishes
    &coordfield=Coordinates
```

**Response:**
```json
{
  "cargonearby": [
    {
      "pageid": 1234,
      "ns": 0,
      "title": "St. Paul Cathedral",
      "lat": 40.4412,
      "lon": -79.9963,
      "dist": 0.8
    }
  ]
}
```

**Core PHP logic:**
```php
// Pseudocode — uses Cargo's query builder
$query = CargoUtils::getNearQuery(
    table: $params['table'],
    coordField: $params['coordfield'],
    lat: $lat, lon: $lon,
    radius: $params['gsradius'], // meters
    limit: $params['gslimit']
);
```

---

## Key References

- [Extension:NearbyPages](https://www.mediawiki.org/wiki/Extension:NearbyPages) — target UX
- [Extension:Cargo/Querying data — NEAR command](https://www.mediawiki.org/wiki/Extension:Cargo/Querying_data#The_"NEAR"_command)
- [Extension:Cargo/Storing data — Coordinates type](https://www.mediawiki.org/wiki/Extension:Cargo/Storing_data)
- [API:Geosearch](https://www.mediawiki.org/wiki/API:Geosearch) — response shape to emulate
- [Maps + Cargo integration](https://maps.extension.wiki/wiki/Cargo)
- Saintapedia stack: MW 1.39.8, PHP 8.1.29, Cargo 3.5.1 (from SaintapediaDrilldown project notes)

---

## Decision Matrix (quick reference)

| If you prioritize… | Choose |
|---|---|
| Lowest production risk | **Option 5** (API shim) or **Option 3** (gadget) |
| Fastest demo today | **Option 3** |
| Best map visualization | **Option 4** |
| Native `Special:Nearby` in wiki chrome | **Option 1** (or Option 5 embedded via iframe as interim) |
| Zero custom code | **Option 2** — *not recommended* due to data duplication |