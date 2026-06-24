# NearMe

A [MediaWiki](https://www.mediawiki.org/) extension that provides **Special:Nearby** — location-based page discovery powered by [Cargo](https://www.mediawiki.org/wiki/Extension:Cargo) `Coordinates` fields and the native `NEAR` query command.

Built for [Saintapedia](https://saintapedia.org) as a Cargo-native alternative to [Extension:NearbyPages](https://www.mediawiki.org/wiki/Extension:NearbyPages), which requires GeoData.

## Features

- **Special:Nearby** with geolocation and manual coordinate URLs (`#/coord/40.44,-79.99`)
- **`action=cargonearby` API** returning distance-sorted results from Cargo tables
- **Multi-table support** — search Saints, Parishes, Churches, etc. from one interface
- **MW 1.39+ compatible** — no Codex/Vue dependency (unlike upstream NearbyPages 1.47+)

## Requirements

| Component | Version |
|---|---|
| MediaWiki | >= 1.39 |
| Cargo | >= 3.0 |
| PHP | >= 7.4 |

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

3. Configure Cargo tables to search (adjust table/field names to match your wiki):

   ```php
   $wgNearMeTables = [
       [
           'table' => 'Saints',
           'coordField' => 'Coordinates',
           'labelField' => 'Name',
       ],
       [
           'table' => 'Parishes',
           'coordField' => 'Coordinates',
           'labelField' => 'Name',
       ],
   ];

   $wgNearMeDefaultRadius = 10000; // metres (10 km)
   $wgNearMeDefaultLimit = 50;
   ```

4. Run `php maintenance/update.php` and verify at [Special:Version](Special:Version).

5. Open [Special:Nearby](Special:Nearby) and click **Show nearby pages**.

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
      "title": "St. Paul Cathedral",
      "lat": 40.4412,
      "lon": -79.9963,
      "dist": 812.4,
      "label": "St. Paul Cathedral",
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
