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

		// Direct coordinates: "40.44, -79.99" or "40.44|-79.99"
		$coordMatch = $this->parseCoordinates( $query );
		if ( $coordMatch !== null ) {
			return [ $coordMatch ];
		}

		if ( !( $config['enabled'] ?? true ) ) {
			return [];
		}

		$limit = min( max( $limit, 1 ), 10 );
		$baseUrl = rtrim( (string)( $config['url'] ?? 'https://nominatim.openstreetmap.org' ), '/' );
		$countryCodes = trim( (string)( $config['countryCodes'] ?? '' ) );

		$cacheKey = $this->cache->makeKey(
			'nearme-geocode',
			md5( $query . '|' . $limit . '|' . $baseUrl . '|' . $countryCodes )
		);

		$cached = $this->cache->get( $cacheKey );
		if ( is_array( $cached ) ) {
			return $cached;
		}

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
			wfDebugLog( 'NearMe', 'Geocode HTTP failed for ' . $query . ': ' . $status->getWikiText( false, false, 'en' ) );
			return [];
		}

		$body = $request->getContent();
		if ( !is_string( $body ) || $body === '' ) {
			return [];
		}

		$decoded = json_decode( $body, true );
		if ( !is_array( $decoded ) ) {
			wfDebugLog( 'NearMe', 'Geocode JSON decode failed for ' . $query );
			return [];
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

		// Strip null subtitles for cleaner API JSON
		foreach ( $results as &$r ) {
			if ( ( $r['subtitle'] ?? null ) === null ) {
				unset( $r['subtitle'] );
			}
			if ( ( $r['kind'] ?? null ) === null ) {
				unset( $r['kind'] );
			}
		}
		unset( $r );

		$this->cache->set( $cacheKey, $results, self::CACHE_TTL );
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
