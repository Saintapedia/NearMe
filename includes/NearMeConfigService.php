<?php
/**
 * Loads NearMe configuration from MediaWiki:NearMe-config (JSON) with
 * LocalSettings fallbacks.
 *
 * Minimal source entry: table, coordField, label (friendly table name for UI).
 * Optional: labelField (row label; defaults to wiki page title), default.
 *
 * @file
 */

declare( strict_types = 1 );

namespace MediaWiki\Extension\NearMe;

use CargoUtils;
use IContextSource;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;


/**
 * Resolves NearMe table sources and defaults for Special:Nearby and the API.
 */
class NearMeConfigService {

	private const CACHE_VERSION = 3;
	private const CACHE_TTL = 300;

	/**
	 * @param IContextSource $context
	 * @return array{
	 *   defaultRadius:int,
	 *   defaultLimit:int,
	 *   sources:array<int,array{
	 *     table:string,
	 *     coordField:string,
	 *     labelField?:string,
	 *     label?:string,
	 *     default?:bool
	 *   }>,
	 *   examples:array<int,array{label:string,lat:float,lon:float}>
	 * }
	 */
	public function getConfig( IContextSource $context ): array {
		$wikiConfig = $this->getWikiConfig( $context );
		$mainConfig = $context->getConfig();

		$defaultRadius = (int)$mainConfig->get( 'NearMeDefaultRadius' );
		$defaultLimit = (int)$mainConfig->get( 'NearMeDefaultLimit' );

		if ( $wikiConfig !== null ) {
			if ( isset( $wikiConfig['defaultRadius'] ) ) {
				$defaultRadius = (int)$wikiConfig['defaultRadius'];
			}
			if ( isset( $wikiConfig['defaultLimit'] ) ) {
				$defaultLimit = (int)$wikiConfig['defaultLimit'];
			}
		}

		$wikiSources = ( $wikiConfig !== null ) ? ( $wikiConfig['sources'] ?? null ) : null;
		$sources = $this->normalizeSources(
			$wikiSources,
			$mainConfig->get( 'NearMeTables' )
		);

		$examples = [];
		if ( $wikiConfig !== null && isset( $wikiConfig['examples'] ) ) {
			$examples = $this->normalizeExamples( $wikiConfig['examples'] );
		}

		return [
			'defaultRadius' => $defaultRadius,
			'defaultLimit' => $defaultLimit,
			'sources' => $this->filterValidSources( $sources ),
			'examples' => $examples,
		];
	}

	/**
	 * @param IContextSource $context
	 * @return array<int,array{table:string,coordField:string,labelField?:string,label?:string,default?:bool}>
	 */
	public function getSources( IContextSource $context ): array {
		return $this->getConfig( $context )['sources'];
	}

	/**
	 * @param IContextSource $context
	 * @return array<string,mixed>|null
	 */
	private function getWikiConfig( IContextSource $context ): ?array {
		$pageName = (string)$context->getConfig()->get( 'NearMeConfigPage' );
		if ( $pageName === '' ) {
			return null;
		}

		$title = Title::makeTitleSafe( NS_MEDIAWIKI, $pageName );
		if ( $title === null || !$title->exists() ) {
			return null;
		}

		$cache = MediaWikiServices::getInstance()->getMainWANObjectCache();
		$key = $cache->makeKey(
			'nearme-config',
			self::CACHE_VERSION,
			$title->getLatestRevID()
		);

		return $cache->getWithSetCallback(
			$key,
			self::CACHE_TTL,
			function () use ( $title ) {
				$wikiPage = MediaWikiServices::getInstance()->getWikiPageFactory()->newFromTitle( $title );
				$content = $wikiPage->getContent();
				if ( $content === null ) {
					return null;
				}

				return $this->parseJsonConfig( $content->getText() );
			}
		);
	}

	/**
	 * @param string $text
	 * @return array<string,mixed>|null
	 */
	public function parseJsonConfig( string $text ): ?array {
		$text = trim( $text );
		if ( $text === '' ) {
			return null;
		}

		// Allow wikitext wrappers (<pre>, nowiki) — extract the JSON object.
		if ( preg_match( '/\{.*\}/s', $text, $matches ) ) {
			$text = $matches[0];
		}

		$decoded = json_decode( $text, true );
		if ( !is_array( $decoded ) ) {
			wfDebugLog( 'NearMe', 'Failed to parse MediaWiki:NearMe-config as JSON.' );
			return null;
		}

		return $decoded;
	}

	/**
	 * @param mixed $wikiSources
	 * @param mixed $localSources
	 * @return array<int,array<string,mixed>>
	 */
	private function normalizeSources( $wikiSources, $localSources ): array {
		if ( is_array( $wikiSources ) && $wikiSources !== [] ) {
			return $this->normalizeSourceList( $wikiSources );
		}

		if ( !is_array( $localSources ) ) {
			return [];
		}

		return $this->normalizeSourceList( $localSources );
	}

	/**
	 * @param array<int,mixed> $raw
	 * @return array<int,array{table:string,coordField:string,labelField?:string,label?:string,default?:bool}>
	 */
	private function normalizeSourceList( array $raw ): array {
		$normalized = [];

		foreach ( $raw as $entry ) {
			if ( !is_array( $entry ) ) {
				continue;
			}

			$table = isset( $entry['table'] ) ? trim( (string)$entry['table'] ) : '';
			$coordField = isset( $entry['coordField'] ) ? trim( (string)$entry['coordField'] ) : '';
			if ( $table === '' || $coordField === '' ) {
				continue;
			}

			$source = [
				'table' => $table,
				'coordField' => $coordField,
			];

			if ( isset( $entry['labelField'] ) && $entry['labelField'] !== '' ) {
				$source['labelField'] = (string)$entry['labelField'];
			}

			if ( isset( $entry['label'] ) && $entry['label'] !== '' ) {
				$source['label'] = (string)$entry['label'];
			} else {
				$source['label'] = $table;
			}

			if ( !empty( $entry['default'] ) ) {
				$source['default'] = true;
			}

			$normalized[] = $source;
		}

		return $normalized;
	}

	/**
	 * @param array<int,array{table:string,coordField:string,labelField?:string,label?:string,default?:bool}> $sources
	 * @return array<int,array{table:string,coordField:string,labelField?:string,label?:string,default?:bool}>
	 */
	private function filterValidSources( array $sources ): array {
		$knownTables = CargoUtils::getTables();
		$valid = [];

		foreach ( $sources as $source ) {
			if ( !in_array( $source['table'], $knownTables, true ) ) {
				wfDebugLog(
					'NearMe',
					'Skipping unknown Cargo table in config: ' . $source['table']
				);
				continue;
			}
			$valid[] = $source;
		}

		return $valid;
	}

	/**
	 * @param mixed $raw
	 * @return array<int,array{label:string,lat:float,lon:float}>
	 */
	private function normalizeExamples( $raw ): array {
		if ( !is_array( $raw ) ) {
			return [];
		}

		$examples = [];
		foreach ( $raw as $entry ) {
			if ( !is_array( $entry ) ) {
				continue;
			}

			$label = isset( $entry['label'] ) ? trim( (string)$entry['label'] ) : '';
			if ( $label === '' || !isset( $entry['lat'] ) || !isset( $entry['lon'] ) ) {
				continue;
			}

			if ( !is_numeric( $entry['lat'] ) || !is_numeric( $entry['lon'] ) ) {
				continue;
			}

			$lat = (float)$entry['lat'];
			$lon = (float)$entry['lon'];
			if ( $lat < -90 || $lat > 90 || $lon < -180 || $lon > 180 ) {
				continue;
			}

			$examples[] = [
				'label' => $label,
				'lat' => $lat,
				'lon' => $lon,
			];

			if ( count( $examples ) >= 5 ) {
				break;
			}
		}

		return $examples;
	}
}