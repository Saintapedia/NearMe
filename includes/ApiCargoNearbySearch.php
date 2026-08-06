<?php
/**
 * API module: action=cargonearbysearch
 *
 * Text search for Cargo rows that have coordinates (hero name search on Special:NearMe).
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
class ApiCargoNearbySearch extends ApiBase {

	private NearbyQueryService $queryService;
	private NearMeConfigService $configService;

	public function __construct(
		ApiMain $main,
		string $action,
		?NearbyQueryService $queryService = null,
		?NearMeConfigService $configService = null
	) {
		parent::__construct( $main, $action );
		$this->queryService = $queryService ?? new NearbyQueryService();
		$this->configService = $configService ?? new NearMeConfigService();
	}

	/** @inheritDoc */
	public function execute(): void {
		if ( !ExtensionRegistry::getInstance()->isLoaded( 'Cargo' ) ) {
			$this->dieWithError( 'nearme-error-cargo-missing', 'cargo-missing' );
		}

		// Anonymous multi-table LIKE search — share Cargo's query limiter when set,
		// plus NearMe's dedicated key (defaults registered in NearMeHooks).
		if (
			$this->getUser()->pingLimiter( 'nearme-search' ) ||
			$this->getUser()->pingLimiter( 'cargo-query' )
		) {
			$this->dieWithError( 'apierror-ratelimited' );
		}

		$params = $this->extractRequestParams();
		$query = trim( (string)$params['gsearch'] );
		if ( mb_strlen( $query ) < 2 ) {
			$this->dieWithError( 'nearme-name-search-too-short', 'search-too-short' );
		}

		$mainConfig = $this->getConfig();
		$maxLimit = (int)$mainConfig->get( 'NearMeMaxLimit' );
		$limit = min( (int)$params['gslimit'], $maxLimit );

		/** @var array<int,array{table:string,coordField:string,labelField?:string}> $sources */
		$sources = $this->configService->getSources( $this->getContext() );
		$tableFilter = $params['table'] !== '' ? $params['table'] : null;

		if ( $tableFilter !== null && !$this->isConfiguredTable( $sources, $tableFilter ) ) {
			$this->dieWithError( [ 'nearme-error-unknown-table', $tableFilter ], 'unknown-table' );
		}

		$sources = $this->queryService->filterSources( $sources, $tableFilter );
		if ( $sources === [] ) {
			$this->dieWithError( 'nearme-error-no-sources', 'no-sources' );
		}

		$results = $this->queryService->searchAll( $sources, $query, $limit );

		$this->getResult()->addValue( null, $this->getModuleName(), $results );
	}

	/**
	 * @param array<int,array{table:string,coordField:string,labelField?:string}> $sources
	 */
	private function isConfiguredTable( array $sources, string $table ): bool {
		foreach ( $sources as $source ) {
			if ( $source['table'] === $table ) {
				return true;
			}
		}
		return false;
	}

	/** @inheritDoc */
	public function getAllowedParams(): array {
		$nearMeConfig = $this->configService->getConfig( $this->getContext() );
		$mainConfig = $this->getConfig();

		return [
			'gsearch' => [
				self::PARAM_TYPE => 'string',
				self::PARAM_REQUIRED => true,
			],
			'gslimit' => [
				self::PARAM_TYPE => 'integer',
				self::PARAM_DFLT => min( 20, (int)$nearMeConfig['defaultLimit'] ),
				IntegerDef::PARAM_MIN => 1,
				IntegerDef::PARAM_MAX => $mainConfig->get( 'NearMeMaxLimit' ),
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
			'action=cargonearbysearch&gsearch=Mary'
				=> 'apihelp-cargonearbysearch-example-1',
		];
	}

	/** @inheritDoc */
	public function isReadMode(): bool {
		return true;
	}
}
