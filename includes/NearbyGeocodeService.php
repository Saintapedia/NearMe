<?php
/**
 * Free-form place geocoding via Nominatim (OpenStreetMap).
 *
 * Used so hero search is not limited to Cargo table rows: any city, address,
 * or place name can resolve to coordinates for a nearby Cargo search.
 *
 * @file
 */

declare( strict_types = 1 );

namespace MediaWiki\Extension\NearMe;

use MediaWiki\Http\HttpRequestFactory;
use MediaWiki\MediaWikiServices;
use WANObjectCache;
use Wikimedia\IPUtils;

/**
 * Geocode arbitrary place text to lat/lon candidates.
 */
class NearbyGeocodeService {

	private const CACHE_TTL = 86400;
	private const USER_AGENT = 'NearMe-MediaWiki-Extension/0.3 (https://github.com/Saintapedia/NearMe)';

	/** Default min seconds between outbound HTTP geocodes (Nominatim public policy ~1/s). */
	private const DEFAULT_MIN_INTERVAL = 1.1;

	/** Seconds a result-fetch lock is held to collapse identical concurrent queries. */
	private const FETCH_LOCK_TSE = 10;

	private HttpRequestFactory $http;
	private WANObjectCache $cache;

	public function __construct(
		?HttpRequestFactory $http = null,
		?WANObjectCache $cache = null
	) {
		$services = MediaWikiServices::getInstance();
		$this->http = $http ?? $services->getHttpRequestFactory();
		$this->cache = $cache ?? $services->getMainWANObjectCache();
	}

	/**
	 * @return array<int,array{
	 *   title:string,
	 *   lat:float,
	 *   lon:float,
	 *   type:string,
	 *   subtitle?:string,
	 *   kind?:string
	 * }>
	 */
	public function search( string $query, int $limit, array $config ): array {
		$query = trim( $query );
		if ( mb_strlen( $query ) < 2 || $limit < 1 ) {
			return [];
		}

		// Direct coordinates: "40.44, -79.99" or "40.44|-79.99" — no external call.
		$coordMatch = $this->parseCoordinates( $query );
		if ( $coordMatch !== null ) {
			return [ $coordMatch ];
		}

		// Opt-in only (extension default is false).
		if ( !( $config['enabled'] ?? false ) ) {
			return [];
		}

		$limit = min( max( $limit, 1 ), 10 );
		$baseUrl = rtrim( (string)( $config['url'] ?? 'https://nominatim.openstreetmap.org' ), '/' );
		$countryCodes = trim( (string)( $config['countryCodes'] ?? '' ) );
		$minInterval = (float)( $config['minInterval'] ?? self::DEFAULT_MIN_INTERVAL );

		$cacheKey = $this->cache->makeKey(
			'nearme-geocode',
			'v2',
			md5( $query . '|' . $limit . '|' . $baseUrl . '|' . $countryCodes )
		);

		// Result cache with lockTSE: concurrent identical queries stampede into one
		// outbound fetch; other workers wait/reuse rather than each calling Nominatim.
		// Throttle failures must not be cached (TTL_UNCACHEABLE inside callback).
		$result = $this->cache->getWithSetCallback(
			$cacheKey,
			self::CACHE_TTL,
			function ( $oldValue, &$ttl ) use ( $query, $limit, $baseUrl, $countryCodes, $minInterval ) {
				// Aggregate (wiki-wide) gate — atomic set-if-absent, not get-then-set.
				if ( $minInterval > 0 && !$this->acquireOutboundSlot( $minInterval ) ) {
					wfDebugLog( 'NearMe', 'Geocode aggregate throttle: skipped outbound for ' . $query );
					$ttl = WANObjectCache::TTL_UNCACHEABLE;
					return [];
				}

				$fetched = $this->fetchFromNominatim( $query, $limit, $baseUrl, $countryCodes );
				if ( $fetched === null ) {
					// Transport/parse failure: do not cache empty for a day.
					$ttl = WANObjectCache::TTL_UNCACHEABLE;
					return [];
				}

				return $fetched;
			},
			[
				// Collapse concurrent misses for the same key onto one recompute.
				'lockTSE' => self::FETCH_LOCK_TSE,
				// While the lock holder fetches, others get a temporary empty list
				// rather than also calling Nominatim.
				'busyValue' => [],
			]
		);

		return is_array( $result ) ? $result : [];
	}

	/**
	 * Atomic wiki-wide gate for outbound geocode HTTP (all users share one budget).
	 *
	 * Uses BagOStuff/WANObjectCache::add() (set-if-absent) so concurrent PHP-FPM
	 * workers cannot both pass a get-then-set race. Only the worker that creates
	 * the short-lived key may issue an outbound request during that TTL window.
	 *
	 * @param float $minInterval Seconds between outbound requests
	 */
	private function acquireOutboundSlot( float $minInterval ): bool {
		$key = $this->cache->makeKey( 'nearme-geocode', 'outbound-lock' );
		// Integer TTL only; ceil(1.1) => 2s is slightly stricter than 1.1s (safer for Nominatim).
		$ttl = max( 1, (int)ceil( $minInterval ) );
		// add() is atomic across the cache backend (Memcached/Redis/etc.).
		return $this->cache->add( $key, microtime( true ), $ttl );
	}

	/**
	 * Perform the HTTP Nominatim search. Returns null on transport/parse failure
	 * (caller must not cache), or a (possibly empty) list of place hits.
	 *
	 * @return array<int,array<string,mixed>>|null
	 */
	private function fetchFromNominatim(
		string $query,
		int $limit,
		string $baseUrl,
		string $countryCodes
	): ?array {
		$params = [
			'q' => $query,
			'format' => 'json',
			'limit' => (string)$limit,
			'addressdetails' => '0',
		];
		if ( $countryCodes !== '' ) {
			$params['countrycodes'] = $countryCodes;
		}

		$url = $baseUrl . '/search?' . wfArrayToCgi( $params );
		$request = $this->http->create( $url, [
			'method' => 'GET',
			'timeout' => 5,
			'connectTimeout' => 3,
		], __METHOD__ );
		$request->setHeader( 'User-Agent', self::USER_AGENT );
		$request->setHeader( 'Accept', 'application/json' );

		$status = $request->execute();
		if ( !$status->isOK() ) {
			wfDebugLog(
				'NearMe',
				'Geocode HTTP failed for ' . $query . ': ' . $status->getWikiText( false, false, 'en' )
			);
			return null;
		}

		$body = $request->getContent();
		if ( !is_string( $body ) || $body === '' ) {
			return null;
		}

		$decoded = json_decode( $body, true );
		if ( !is_array( $decoded ) ) {
			wfDebugLog( 'NearMe', 'Geocode JSON decode failed for ' . $query );
			return null;
		}

		$results = [];
		foreach ( $decoded as $row ) {
			if ( !is_array( $row ) ) {
				continue;
			}
			$lat = isset( $row['lat'] ) ? (float)$row['lat'] : null;
			$lon = isset( $row['lon'] ) ? (float)$row['lon'] : null;
			$display = isset( $row['display_name'] ) ? trim( (string)$row['display_name'] ) : '';
			if ( $lat === null || $lon === null || $display === '' ) {
				continue;
			}
			if ( $lat < -90 || $lat > 90 || $lon < -180 || $lon > 180 ) {
				continue;
			}
			$kind = '';
			if ( !empty( $row['type'] ) ) {
				$kind = (string)$row['type'];
			} elseif ( !empty( $row['class'] ) ) {
				$kind = (string)$row['class'];
			}
			$results[] = [
				'title' => $display,
				'lat' => $lat,
				'lon' => $lon,
				'type' => 'geocode',
				'subtitle' => $kind !== '' ? $kind : null,
				'kind' => $kind !== '' ? $kind : null,
			];
			if ( count( $results ) >= $limit ) {
				break;
			}
		}

		foreach ( $results as &$r ) {
			if ( ( $r['subtitle'] ?? null ) === null ) {
				unset( $r['subtitle'] );
			}
			if ( ( $r['kind'] ?? null ) === null ) {
				unset( $r['kind'] );
			}
		}
		unset( $r );

		return $results;
	}

	/**
	 * @return array{title:string,lat:float,lon:float,type:string,subtitle?:string}|null
	 */
	private function parseCoordinates( string $query ): ?array {
		// Avoid treating bare IPs as coordinates.
		if ( IPUtils::isValid( $query ) ) {
			return null;
		}
		if ( !preg_match(
			'/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,|\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/',
			$query,
			$m
		) ) {
			return null;
		}
		$lat = (float)$m[1];
		$lon = (float)$m[2];
		if ( $lat < -90 || $lat > 90 || $lon < -180 || $lon > 180 ) {
			return null;
		}
		return [
			'title' => $lat . ', ' . $lon,
			'lat' => $lat,
			'lon' => $lon,
			'type' => 'coordinates',
			'subtitle' => 'coordinates',
		];
	}
}
