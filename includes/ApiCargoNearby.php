<?php
/**
 * API module: action=cargonearby
 *
 * Cargo-backed geosearch for Special:Nearby and the NearMe frontend.
 *
 * @file
 */

declare( strict_types = 1 );

namespace MediaWiki\Extension\NearMe;

use ApiBase;
use ApiMain;
use ExtensionRegistry;
use Wikimedia\ParamValidator\TypeDef\IntegerDef;

/**
 * @ingroup API
 */
class ApiCargoNearby extends ApiBase {

	private NearbyQueryService $queryService;

	public function __construct( ApiMain $main, string $action, ?NearbyQueryService $queryService = null ) {
		parent::__construct( $main, $action );
		$this->queryService = $queryService ?? new NearbyQueryService();
	}

	/** @inheritDoc */
	public function execute(): void {
		if ( !ExtensionRegistry::getInstance()->isLoaded( 'Cargo' ) ) {
			$this->dieWithError( 'nearme-error-cargo-missing', 'cargo-missing' );
		}

		$params = $this->extractRequestParams();
		$coord = $params['gscoord'];
		$parts = explode( '|', $coord, 2 );
		if ( count( $parts ) !== 2 ) {
			$this->dieWithError( [ 'apierror-badparameter', 'gscoord' ], 'bad-coord' );
		}

		if ( !is_numeric( $parts[0] ) || !is_numeric( $parts[1] ) ) {
			$this->dieWithError( [ 'apierror-badparameter', 'gscoord' ], 'bad-coord' );
		}

		$lat = (float)$parts[0];
		$lon = (float)$parts[1];
		if ( $lat < -90 || $lat > 90 || $lon < -180 || $lon > 180 ) {
			$this->dieWithError( [ 'apierror-badparameter', 'gscoord' ], 'bad-coord' );
		}

		$config = $this->getConfig();
		$maxRadius = (int)$config->get( 'NearMeMaxRadius' );
		$maxLimit = (int)$config->get( 'NearMeMaxLimit' );
		$radius = min( (int)$params['gsradius'], $maxRadius );
		$limit = min( (int)$params['gslimit'], $maxLimit );

		/** @var array<int,array{table:string,coordField:string,labelField?:string}> $sources */
		$sources = $config->get( 'NearMeTables' );
		$tableFilter = $params['table'] !== '' ? $params['table'] : null;

		if ( $tableFilter !== null && !$this->queryService->isKnownCargoTable( $tableFilter ) ) {
			$this->dieWithError( [ 'nearme-error-unknown-table', $tableFilter ], 'unknown-table' );
		}

		$sources = $this->queryService->filterSources( $sources, $tableFilter );
		if ( $sources === [] ) {
			$this->dieWithError( 'nearme-error-no-sources', 'no-sources' );
		}

		foreach ( $sources as $source ) {
			if ( !$this->queryService->isKnownCargoTable( $source['table'] ) ) {
				$this->dieWithError(
					[ 'nearme-error-unknown-table', $source['table'] ],
					'unknown-table'
				);
			}
		}

		$results = $this->queryService->queryAll( $sources, $lat, $lon, $radius, $limit );

		$this->getResult()->addValue( null, $this->getModuleName(), $results );
	}

	/** @inheritDoc */
	public function getAllowedParams(): array {
		return [
			'gscoord' => [
				self::PARAM_TYPE => 'string',
				self::PARAM_REQUIRED => true,
			],
			'gsradius' => [
				self::PARAM_TYPE => 'integer',
				self::PARAM_DFLT => $this->getConfig()->get( 'NearMeDefaultRadius' ),
				IntegerDef::PARAM_MIN => 100,
				IntegerDef::PARAM_MAX => $this->getConfig()->get( 'NearMeMaxRadius' ),
			],
			'gslimit' => [
				self::PARAM_TYPE => 'integer',
				self::PARAM_DFLT => $this->getConfig()->get( 'NearMeDefaultLimit' ),
				IntegerDef::PARAM_MIN => 1,
				IntegerDef::PARAM_MAX => $this->getConfig()->get( 'NearMeMaxLimit' ),
			],
			'table' => [
				self::PARAM_TYPE => 'string',
				self::PARAM_DFLT => '',
			],
		];
	}

	/** @inheritDoc */
	protected function getExamplesMessages(): array {
		return [
			'action=cargonearby&gscoord=40.4406|-79.9959'
				=> 'apihelp-cargonearby-example-1',
		];
	}

	/** @inheritDoc */
	public function isReadMode(): bool {
		return true;
	}
}