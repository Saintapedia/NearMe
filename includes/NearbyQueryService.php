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
			if ( $distMeters > $radiusMeters ) {
				continue;
			}

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
	 * Cargo-query front: LIKE over configured search fields; only rows with coordinates.
	 *
	 * Equivalent in spirit to action=cargoquery with a generated tables/fields/where,
	 * but does not require the runcargoqueries right (anonymous Special:NearMe use).
	 *
	 * @param array{
	 *   table:string,
	 *   coordField:string,
	 *   labelField?:string,
	 *   searchFields?:array<int,string>,
	 *   displayFields?:array<int,string>
	 * } $source
	 * @return array<int,array<string,mixed>>
	 */
	public function searchSource( array $source, string $query, int $limit ): array {
		$query = trim( $query );
		if ( $query === '' || mb_strlen( $query ) < 2 ) {
			return [];
		}
		if ( mb_strlen( $query ) > 100 ) {
			$query = mb_substr( $query, 0, 100 );
		}

		$table = $source['table'];
		$coordField = $source['coordField'];
		$labelField = $source['labelField'] ?? null;
		$searchFields = $this->resolveSearchFields( $source );
		$displayFields = $this->resolveDisplayFields( $source );

		// Build a Cargo double-quoted LIKE pattern for literal substring match.
		// Field names are config-validated elsewhere; only $query is untrusted input.
		$like = $this->buildLiteralLikePattern( $query );
		if ( $like === null ) {
			return [];
		}

		$conditions = [];
		foreach ( $searchFields as $field ) {
			$conditions[] = $field . ' LIKE "' . $like . '"';
		}
		if ( $conditions === [] ) {
			return [];
		}
		$where = '(' . implode( ' OR ', $conditions ) . ')';

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
		foreach ( $displayFields as $displayField ) {
			if ( !in_array( $displayField, $fields, true ) ) {
				$fields[] = $displayField;
			}
		}

		$orderBy = ( $labelField !== null && $labelField !== '' ) ? $labelField : '_pageName';

		$sqlQuery = CargoSQLQuery::newFromValues(
			$table,
			implode( ',', $fields ),
			$where,
			'',
			'',
			'',
			$orderBy,
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

			$display = [];
			foreach ( $displayFields as $displayField ) {
				if ( !isset( $row[$displayField] ) || $row[$displayField] === '' ) {
					continue;
				}
				$display[$displayField] = (string)$row[$displayField];
			}

			$result = [
				'pageid' => $pageId,
				'ns' => $ns,
				'title' => $title->getPrefixedText(),
				'lat' => $rowLat,
				'lon' => $rowLon,
				'label' => $label,
				'table' => $table,
			];
			if ( $display !== [] ) {
				$result['fields'] = $display;
			}
			$results[] = $result;
		}

		return $results;
	}

	/**
	 * Sanitize user text for a Cargo double-quoted LIKE pattern with literal
	 * substring semantics (leading/trailing % only; user %/_ are escaped).
	 *
	 * CargoSQLQuery takes a string WHERE clause, so we cannot bind parameters.
	 * Defense in depth:
	 * - Strip characters that could break out of a double-quoted Cargo string
	 *   (ASCII/Unicode quotes, backslashes, C0 controls)
	 * - Escape SQL LIKE wildcards % and _ so they match literally
	 * - Truncate (caller already caps at 100; re-check after stripping)
	 *
	 * @return string|null Pattern including surrounding % wildcards, or null if empty
	 */
	private function buildLiteralLikePattern( string $query ): ?string {
		// Drop quotes/backslashes/controls that could break Cargo "..." string parsing.
		$safe = str_replace(
			[
				'"', '\\', "\0", "\n", "\r", "\t",
				// Unicode double-quote lookalikes
				"\u{201C}", "\u{201D}", "\u{201E}", "\u{201F}", "\u{FF02}",
				// Guillemets sometimes used as quotes
				"\u{00AB}", "\u{00BB}",
			],
			'',
			$query
		);
		// Remaining C0 / DEL controls
		$safe = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $safe ) ?? '';
		$safe = trim( $safe );
		if ( $safe === '' || mb_strlen( $safe ) < 2 ) {
			return null;
		}
		if ( mb_strlen( $safe ) > 100 ) {
			$safe = mb_substr( $safe, 0, 100 );
		}
		// Escape LIKE metacharacters so user input is a literal substring.
		// MySQL default ESCAPE is backslash; Cargo passes the WHERE through to SQL.
		$safe = str_replace( [ '%', '_' ], [ '\\%', '\\_' ], $safe );

		return '%' . $safe . '%';
	}

	/**
	 * Fields OR-matched by LIKE for hero name search (Cargo query front).
	 *
	 * @param array{labelField?:string,searchFields?:array<int,string>} $source
	 * @return array<int,string>
	 */
	private function resolveSearchFields( array $source ): array {
		if ( !empty( $source['searchFields'] ) && is_array( $source['searchFields'] ) ) {
			return array_values( $source['searchFields'] );
		}
		$fields = [ '_pageName' ];
		$labelField = $source['labelField'] ?? null;
		if ( $labelField !== null && $labelField !== '' && $labelField !== '_pageName' ) {
			$fields[] = $labelField;
		}
		return $fields;
	}

	/**
	 * Extra Cargo columns returned for match subtitles.
	 *
	 * @param array{displayFields?:array<int,string>,labelField?:string} $source
	 * @return array<int,string>
	 */
	private function resolveDisplayFields( array $source ): array {
		if ( !empty( $source['displayFields'] ) && is_array( $source['displayFields'] ) ) {
			return array_values( $source['displayFields'] );
		}
		return [];
	}

	/**
	 * Search all sources by name, merge, de-dupe by title, truncate.
	 *
	 * @param array<int,array{table:string,coordField:string,labelField?:string}> $sources
	 * @return array<int,array<string,mixed>>
	 */
	public function searchAll( array $sources, string $query, int $limit ): array {
		$merged = [];
		$seen = [];
		foreach ( $sources as $source ) {
			try {
				$rows = $this->searchSource( $source, $query, $limit );
			} catch ( \Exception $e ) {
				wfDebugLog( 'NearMe', 'Cargo name search failed for ' . $source['table'] . ': ' . $e->getMessage() );
				continue;
			}
			foreach ( $rows as $row ) {
				$key = $row['title'] . '|' . $row['table'];
				if ( isset( $seen[$key] ) ) {
					continue;
				}
				$seen[$key] = true;
				$merged[] = $row;
			}
		}

		usort( $merged, static function ( $a, $b ) {
			return strcasecmp( (string)$a['label'], (string)$b['label'] );
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