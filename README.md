# NearMe

A [MediaWiki](https://www.mediawiki.org/) extension that provides **Special:NearMe** — location-based page discovery powered by [Cargo](https://www.mediawiki.org/wiki/Extension:Cargo) `Coordinates` fields and the native `NEAR` query command.

Built for [Saintapedia](https://saintapedia.org) as a Cargo-native alternative to [Extension:NearbyPages](https://www.mediawiki.org/wiki/Extension:NearbyPages), which requires GeoData.

## Features

- **Special:NearMe** with geolocation and manual coordinate URLs (`#/coord/40.44,-79.99`)
- **Name search (Cargo query front)** — landing-screen search over configured Cargo fields, then show pages near a match (no GPS; no `runcargoqueries` right required)
- **Free-form place geocode (opt-in)** — optional Nominatim-compatible geocoding so any city/address can center the map (`$wgNearMeGeocodeEnabled`; default **off**)
- **Result filter** — after nearby results load, filter the list and map by name
- **`action=cargonearby` API** returning distance-sorted results from Cargo tables
- **`action=cargonearbysearch` API** — constrained Cargo-style name query for rows with coordinates
- **`action=cargonearbygeocode` API** — free-form place → coordinates (when geocode is enabled)

- **Parish-first** — defaults to Saintapedia's `Parishes` Cargo table (`ParishLocation` coordinates)
- **Example location** — “Try without GPS” link for Philadelphia, PA (override via `$wgNearMeExamples` or wiki config)
- **Multi-table support** — add Saints, Shrines, etc. via `$wgNearMeTables`
- **MW 1.39+ compatible** — no Codex/Vue dependency (unlike upstream NearbyPages 1.47+)

## Requirements

| Component | Version |
|---|---|
| MediaWiki | >= 1.39 |
| Cargo | >= 3.0 |
| PHP | >= 8.1 |

Cargo tables must declare a field of type `Coordinates`.

## Installation

1. Clone into your MediaWiki `extensions/` directory. The folder name **must** be `NearMe`:

   ```bash
   cd extensions/
   git clone https://github.com/Saintapedia/NearMe.git NearMe
   ```

2. Enable the extension in `LocalSettings.php` **after** Cargo:

   ```php
   wfLoadExtension( 'Cargo' );
   wfLoadExtension( 'NearMe' );
   ```

3. Configure Cargo tables to search.

   **Saintapedia `Parishes` table** ([Special:Drilldown/Parishes](https://saintapedia.org/wiki/Special:Drilldown/Parishes)):

   | Field | Type | NearMe uses |
   |-------|------|-------------|
   | `ParishLocation` | Coordinates | **geosearch** (`coordField`) |
   | `ShortName` | Text | **list label** (`labelField`) |
   | `Dedication` | Page | — |
   | `Diocese` | Page | — |
   | `Deanery` | Page | — |
   | `MailingAddress` | Searchtext | — |
   | `City` | Page | — |
   | `AdministrativeSubdivision` | Page | — |
   | `Country` | Page | — |
   | `County` | Page | — |
   | `ParishImage` | File | — |
   | `ParishWebsite` | URL | — |
   | `ParishFounded` | Start date | — |
   | `ParishSchool` | Boolean | — |
   | `ParishEmailAddress` | Email | — |
   | `VeneratedSaints` | List of Page | — |
   | `Type` | List of String | — |
   | `IsNonParochial` | Boolean | — |
   | `OperatedBy` | Page | — |
   | `Maintenance` | List of String | — |

   ```php
   $wgNearMeTables = [
       [
           'table' => 'Parishes',
           'coordField' => 'ParishLocation',
           'labelField' => 'ShortName',
       ],
   ];

   $wgNearMeDefaultRadius = 10000; // metres (10 km)
   $wgNearMeDefaultLimit = 50;

   // Optional: replace the default Philadelphia example (or set [] to hide)
   // $wgNearMeExamples = [
   //     [ 'label' => 'Philadelphia, PA', 'lat' => 39.9526, 'lon' => -75.1652 ],
   // ];
   ```

   Or copy `config/NearMe-config.sample.json` (includes the Philadelphia example) to
   `MediaWiki:NearMe-config` on the wiki.

4. Run `php maintenance/update.php` and verify at [Special:Version](Special:Version).

5. Open [Special:NearMe](Special:NearMe). Use **Try without GPS: Philadelphia, PA** or
   click **Show nearby parishes**.

   Parishes without `ParishLocation` coordinates are excluded automatically.

## API

```
GET /api.php?action=cargonearby&format=json&gscoord=40.4406|-79.9959&gsradius=10000&gslimit=50
```

Optional `table` parameter restricts the search to one configured Cargo table.

**Name search (hero box — Cargo query front):**

```
GET /api.php?action=cargonearbysearch&format=json&gsearch=Mary&gslimit=20
```

Per-source options in `MediaWiki:NearMe-config` / `$wgNearMeTables`:

| Key | Purpose |
|-----|---------|
| `searchFields` | Cargo columns OR-matched with `LIKE %query%` on Search (default: `_pageName` + `labelField`) |
| `displayFields` | Extra columns returned as `fields` and shown under each match |
| `autocompleteField` | Single Cargo field for typeahead (`pfautocomplete` / `cargoautocomplete`; default: `labelField`) |

**Page Forms integration:** if Extension:PageForms is loaded, the hero combobox suggestions call `action=pfautocomplete&cargo_table=…&cargo_field=…` — the same API form inputs use. Choosing a suggestion (or pressing Search) still resolves coordinates via `cargonearbysearch` so Nearby can center on that place.

Example Parishes entry:

```json
{
  "table": "Parishes",
  "coordField": "ParishLocation",
  "labelField": "ShortName",
  "label": "Parishes",
  "searchFields": [ "ShortName", "City", "Dedication", "_pageName" ],
  "displayFields": [ "City", "Diocese" ]
}
```

This is intentionally a **safe subset** of `action=cargoquery` (fixed tables from config, generated WHERE, coordinates required) so anonymous Special:NearMe users can search without the `runcargoqueries` right. User input is sanitized for Cargo double-quoted strings and LIKE wildcards (`%` / `_`) are escaped for literal substring match. The endpoint is rate-limited via `$wgRateLimits['nearme-search']` (defaults: 30/min anon IP) and also participates in Cargo’s `cargo-query` limiter when that is configured.

**Free-form place geocoding (opt-in):**

Hero search can also resolve arbitrary cities/addresses (not only Cargo rows) via a Nominatim-compatible geocoder.

```
GET /api.php?action=cargonearbygeocode&format=json&gsearch=Pittsburgh&gslimit=5
```

| Config | Default | Purpose |
|--------|---------|---------|
| `$wgNearMeGeocodeEnabled` | **`false`** | Must be set `true` to turn on free-form geocode (opt-in) |
| `$wgNearMeGeocodeUrl` | `https://nominatim.openstreetmap.org` | Nominatim-compatible base URL |
| `$wgNearMeGeocodeCountryCodes` | `''` | Optional ISO country bias (e.g. `us`) |
| `$wgNearMeGeocodeMaxLimit` | `10` | Max geocode hits per request |
| `$wgNearMeGeocodeMinInterval` | `1.1` | **Wiki-wide** minimum seconds between *outbound* HTTP geocode calls |

```php
// LocalSettings.php — enable after choosing an endpoint you are allowed to use
$wgNearMeGeocodeEnabled = true;
// Production: self-host Nominatim (or another compatible service), do not rely on the public OSM instance
// $wgNearMeGeocodeUrl = 'https://nominatim.example.org';
```

**Nominatim / deployment notes**

- **Default is off** so installing/upgrading NearMe does not start sending visitor queries to a third-party service without an admin choice.
- The [public Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) expects roughly **1 request/second for the whole application** (not per visitor), a valid identifying `User-Agent` (NearMe sets one), and **self-hosting for heavy or production use**.
- NearMe still applies: 24h result cache, client debounce, per-IP `$wgRateLimits['nearme-search']`, and an **aggregate** outbound interval (`$wgNearMeGeocodeMinInterval`) shared by all users on the wiki. Per-IP limits alone cannot protect the site IP against concurrent traffic.
- Coordinate paste (`40.44, -79.99`) never hits the network.

**Response:**

```json
{
  "cargonearby": [
    {
      "pageid": 1234,
      "ns": 0,
      "title": "Blessed Sacrament (Anchorage)",
      "lat": 40.4412,
      "lon": -79.9963,
      "dist": 812.4,
      "label": "Blessed Sacrament",
      "table": "Parishes"
    }
  ]
}
```

## Architecture

```
Special:NearMe (JS)
    → action=cargonearby
        → NearbyQueryService
            → CargoSQLQuery (WHERE Coordinates NEAR (lat, lon, N km))
                → haversine sort + distance field
```

## Development

```bash
composer install
composer test   # parallel-lint + phpcs
```

## License

MIT — see [LICENSE](LICENSE).
