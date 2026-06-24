<?php
/**
 * Runs Cargo NEAR queries and returns geosearch-shaped result rows.
 *
 * @file
 */

declare( strict_types = 1 );

namespace MediaWiki\Extension\NearMe;

use CargoSQLQuery;
use CargoUtils;
use MWException;
use Title;

/**
 * Service for querying Cargo coordinate fields near a point.
 */
class NearbyQueryService {

	/**
	 * @param array{table:string,coordField:string,labelField?:string} $source
	 * @param float $lat
	 * @param float $lon
	 * @param int $radiusMeters
	 * @param int $limit
	 * @return array<int,array<string,mixed>>
	 */
	public function querySource(
		array $source,
		float $lat,
		float $lon,
		int $radiusMeters,
		int $limit
	): array {
		$table = $source['table'];
		$coordField = $source['coordField'];
		$labelField = $source['labelField'] ?? null;

		$radiusKm = $radiusMeters / 1000;
		$where = sprintf(
			'%s NEAR (%F, %F, %F km)',
			$coordField,
			$lat,
			$lon,
			$radiusKm
		);

		$fields = [
			'_pageName',
			'_pageID',
			'_pageNamespace',
			$coordField,
			$coordField . '__lat',
			$coordField . '__lon',
		];
		if ( $labelField !== null && $labelField !== '' ) {
			$fields[] = $labelField;
		}

		$sqlQuery = CargoSQLQuery::newFromValues(
			$table,
			implode( ',', $fields ),
			$where,
			'',
			'',
			'',
			'',
			(string)$limit,
			''
		);

		$rows = $sqlQuery->run();
		$results = [];

		foreach ( $rows as $row ) {
			$parsed = $this->parseRowCoordinates( $row, $coordField );
			if ( $parsed === null ) {
				continue;
			}

			[ $rowLat, $rowLon ] = $parsed;
			$pageName = $row['_pageName'] ?? '';
			if ( $pageName === '' ) {
				continue;
			}

			$ns = (int)( $row['_pageNamespace'] ?? 0 );
			$pageId = (int)( $row['_pageID'] ?? 0 );
			$title = Title::makeTitleSafe( $ns, $pageName );
			if ( $title === null ) {
				continue;
			}
			if ( $pageId <= 0 ) {
				$pageId = $title->getArticleID();
			}

			$label = $pageName;
			if ( $labelField !== null && isset( $row[$labelField] ) && $row[$labelField] !== '' ) {
				$label = (string)$row[$labelField];
			}

			$distMeters = self::haversineMeters( $lat, $lon, $rowLat, $rowLon );

			$results[] = [
				'pageid' => $pageId,
				'ns' => $ns,
				'title' => $title->getPrefixedText(),
				'lat' => $rowLat,
				'lon' => $rowLon,
				'dist' => $distMeters,
				'label' => $label,
				'table' => $table,
			];
		}

		return $results;
	}

	/**
	 * Query all configured sources, merge, sort by distance, and truncate.
	 *
	 * @param array<int,array{table:string,coordField:string,labelField?:string}> $sources
	 * @return array<int,array<string,mixed>>
	 */
	public function queryAll(
		array $sources,
		float $lat,
		float $lon,
		int $radiusMeters,
		int $limit
	): array {
		$merged = [];
		foreach ( $sources as $source ) {
			try {
				$rows = $this->querySource( $source, $lat, $lon, $radiusMeters, $limit );
			} catch ( \Exception $e ) {
				wfDebugLog( 'NearMe', 'Cargo query failed for ' . $source['table'] . ': ' . $e->getMessage() );
				continue;
			}
			$merged = array_merge( $merged, $rows );
		}

		usort( $merged, static function ( $a, $b ) {
			return ( $a['dist'] <=> $b['dist'] );
		} );

		if ( count( $merged ) > $limit ) {
			$merged = array_slice( $merged, 0, $limit );
		}

		return $merged;
	}

	/**
	 * @param array<string,mixed> $row
	 * @return array{0:float,1:float}|null
	 */
	private function parseRowCoordinates( array $row, string $coordField ): ?array {
		$latKey = $coordField . '__lat';
		$lonKey = $coordField . '__lon';

		if ( isset( $row[$latKey], $row[$lonKey] ) && $row[$latKey] !== '' && $row[$lonKey] !== '' ) {
			return [ (float)$row[$latKey], (float)$row[$lonKey] ];
		}

		if ( !isset( $row[$coordField] ) || $row[$coordField] === '' ) {
			return null;
		}

		try {
			$parsed = CargoUtils::parseCoordinatesString( (string)$row[$coordField] );
			if ( !is_array( $parsed ) || count( $parsed ) < 2 ) {
				return null;
			}
			return [ (float)$parsed[0], (float)$parsed[1] ];
		} catch ( MWException $e ) {
			return null;
		}
	}

	public static function haversineMeters(
		float $lat1,
		float $lon1,
		float $lat2,
		float $lon2
	): float {
		$earthRadius = 6371000.0;
		$lat1Rad = deg2rad( $lat1 );
		$lat2Rad = deg2rad( $lat2 );
		$deltaLat = deg2rad( $lat2 - $lat1 );
		$deltaLon = deg2rad( $lon2 - $lon1 );

		$a = sin( $deltaLat / 2 ) ** 2
			+ cos( $lat1Rad ) * cos( $lat2Rad ) * sin( $deltaLon / 2 ) ** 2;
		$c = 2 * atan2( sqrt( $a ), sqrt( 1 - $a ) );

		return $earthRadius * $c;
	}

	/**
	 * @param array<int,array{table:string,coordField:string,labelField?:string}> $configured
	 * @return array<int,array{table:string,coordField:string,labelField?:string}>
	 */
	public function filterSources( array $configured, ?string $tableFilter ): array {
		if ( $tableFilter === null || $tableFilter === '' ) {
			return $configured;
		}

		$filtered = array_values( array_filter(
			$configured,
			static function ( $source ) use ( $tableFilter ) {
				return $source['table'] === $tableFilter;
			}
		) );

		return $filtered;
	}

	/**
	 * @param string $table
	 * @return bool
	 */
	public function isKnownCargoTable( string $table ): bool {
		return in_array( $table, CargoUtils::getTables(), true );
	}
}