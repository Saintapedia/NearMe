# NearMe

A [MediaWiki](https://www.mediawiki.org/) extension that provides **Special:Nearby** — location-based page discovery powered by [Cargo](https://www.mediawiki.org/wiki/Extension:Cargo) `Coordinates` fields and the native `NEAR` query command.

Built for [Saintapedia](https://saintapedia.org) as a Cargo-native alternative to [Extension:NearbyPages](https://www.mediawiki.org/wiki/Extension:NearbyPages), which requires GeoData.

## Features

- **Special:Nearby** with geolocation and manual coordinate URLs (`#/coord/40.44,-79.99`)
- **`action=cargonearby` API** returning distance-sorted results from Cargo tables
- **Parish-first** — defaults to Saintapedia's `Parishes` Cargo table (`ParishLocation` coordinates)
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
   ```

4. Run `php maintenance/update.php` and verify at [Special:Version](Special:Version).

5. Open [Special:Nearby](Special:Nearby) and click **Show nearby parishes**.

   Parishes without `ParishLocation` coordinates are excluded automatically.

## API

```
GET /api.php?action=cargonearby&format=json&gscoord=40.4406|-79.9959&gsradius=10000&gslimit=50
```

Optional `table` parameter restricts the search to one configured Cargo table.

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
Special:Nearby (JS)
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
