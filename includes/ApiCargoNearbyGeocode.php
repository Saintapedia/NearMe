<?php
/**
 * API module: action=cargonearbygeocode
 *
 * Free-form place search (Nominatim) for hero location entry when the query
 * is not (only) a Cargo table row.
 *
 * @file
 */

declare( strict_types = 1 );

namespace MediaWiki\Extension\NearMe;

use ApiBase;
use ApiMain;
use Wikimedia\ParamValidator\TypeDef\IntegerDef;

/**
 * @ingroup API
 */
class ApiCargoNearbyGeocode extends ApiBase {

	private NearbyGeocodeService $geocodeService;

	public function __construct(
		ApiMain $main,
		string $action,
		?NearbyGeocodeService $geocodeService = null
	) {
		parent::__construct( $main, $action );
		$this->geocodeService = $geocodeService ?? new NearbyGeocodeService();
	}

	/** @inheritDoc */
	public function execute(): void {
		if ( $this->getUser()->pingLimiter( 'nearme-search' ) ) {
			$this->dieWithError( 'apierror-ratelimited' );
		}

		$params = $this->extractRequestParams();
		$query = trim( (string)$params['gsearch'] );
		if ( mb_strlen( $query ) < 2 ) {
			$this->dieWithError( 'nearme-name-search-too-short', 'search-too-short' );
		}

		$mainConfig = $this->getConfig();
		if ( !(bool)$mainConfig->get( 'NearMeGeocodeEnabled' ) ) {
			$this->getResult()->addValue( null, $this->getModuleName(), [] );
			return;
		}

		$limit = min(
			(int)$params['gslimit'],
			(int)$mainConfig->get( 'NearMeGeocodeMaxLimit' )
		);

		$results = $this->geocodeService->search( $query, $limit, [
			'enabled' => true,
			'url' => (string)$mainConfig->get( 'NearMeGeocodeUrl' ),
			'countryCodes' => (string)$mainConfig->get( 'NearMeGeocodeCountryCodes' ),
		] );

		$this->getResult()->addValue( null, $this->getModuleName(), $results );
	}

	/** @inheritDoc */
	public function getAllowedParams(): array {
		$mainConfig = $this->getConfig();

		return [
			'gsearch' => [
				self::PARAM_TYPE => 'string',
				self::PARAM_REQUIRED => true,
			],
			'gslimit' => [
				self::PARAM_TYPE => 'integer',
				self::PARAM_DFLT => 5,
				IntegerDef::PARAM_MIN => 1,
				IntegerDef::PARAM_MAX => (int)$mainConfig->get( 'NearMeGeocodeMaxLimit' ),
			],
		];
	}

	/** @inheritDoc */
	public function isReadMode(): bool {
		return true;
	}

	/** @inheritDoc */
	protected function getExamplesMessages(): array {
		return [
			'action=cargonearbygeocode&gsearch=Pittsburgh' =>
				'apihelp-cargonearbygeocode-example-1',
		];
	}

	/** @inheritDoc */
	public function getHelpUrls(): array {
		return [ 'https://www.mediawiki.org/wiki/Extension:NearMe' ];
	}
}
