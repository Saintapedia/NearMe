<?php
/**
 * Special:NearMe — location-based article discovery from Cargo coordinates.
 *
 * @file
 */

declare( strict_types = 1 );

namespace MediaWiki\Extension\NearMe;

use ExtensionRegistry;
use Html;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
use ParserOptions;
use SpecialPage;

/**
 * Provide Special:NearMe with Cargo-backed nearby pages.
 */
class SpecialNearby extends SpecialPage {

	private NearMeConfigService $configService;

	public function __construct( ?NearMeConfigService $configService = null ) {
		parent::__construct( 'NearMe' );
		$this->configService = $configService ?? new NearMeConfigService();
	}

	/** @inheritDoc */
	public function execute( $par ): void {
		$this->setHeaders();
		$this->checkReadOnly();
		$this->outputHeader();

		$registry = ExtensionRegistry::getInstance();

		if ( !$registry->isLoaded( 'Cargo' ) ) {
			$this->getOutput()->addWikiMsg( 'nearme-error-cargo-missing' );
			return;
		}

		$out = $this->getOutput();
		$nearMeConfig = $this->configService->getConfig( $this->getContext() );
		$sources = $nearMeConfig['sources'];

		if ( $sources === [] ) {
			$out->addWikiMsg( 'nearme-error-no-sources' );
			return;
		}

		$out->setPageTitleMsg( $this->msg( 'nearme-title' ) );
		$out->addModuleStyles( [ 'ext.NearMe.styles' ] );

		$modules = [ 'ext.NearMe' ];
		if ( $registry->isLoaded( 'Maps' ) ) {
			$modules[] = 'ext.NearMe.maps';
			$out->addJsConfigVars( [ 'wgNearMeMapsEnabled' => true ] );
		}
		$out->addModules( $modules );

		$examples = $nearMeConfig['examples'];

		// Page Forms cargo-field autocomplete (action=pfautocomplete) when PF is present.
		$out->addJsConfigVars( [
			'NearMeTables' => $sources,
			'NearMeDefaultRadius' => $nearMeConfig['defaultRadius'],
			'NearMeDefaultLimit' => $nearMeConfig['defaultLimit'],
			'NearMeExamples' => $examples,
			'NearMeGeocodeEnabled' => (bool)$this->getConfig()->get( 'NearMeGeocodeEnabled' ),
			'wgNearMePageFormsAutocomplete' => $registry->isLoaded( 'PageForms' ),
		] );

		$html = Html::rawElement(
			'noscript',
			[],
			Html::errorBox(
				$this->msg( 'nearme-requirements-guidance' )->parse(),
				$this->msg( 'nearme-requirements' )->text()
			)
		);

		$introHtml = $this->getIntroHtml();
		if ( $introHtml !== '' ) {
			$html .= Html::rawElement( 'div', [ 'class' => 'nearme-intro' ], $introHtml );
		}

		$buttonLabel = $this->getShowButtonLabel( $sources );

		// Static shell for no-JS / View Source; ext.NearMe.js replaces on load.
		$placeholder = Html::rawElement(
			'div',
			[ 'class' => 'nearme-shell' ],
			Html::rawElement(
				'div',
				[ 'class' => 'nearme-hero' ],
				Html::element(
					'h3',
					[ 'class' => 'nearme-hero__heading' ],
					$this->msg( 'nearme-info-heading' )->text()
				) .
				Html::element(
					'p',
					[ 'class' => 'nearme-hero__description' ],
					$this->msg( 'nearme-info-description' )->text()
				) .
				$this->getExamplesHtml( $examples )
			) .
			Html::rawElement(
				'p',
				[ 'class' => 'nearme-privacy-hint' ],
				$this->msg( 'nearme-privacy-hint' )->text()
			) .
			Html::rawElement(
				'div',
				[ 'class' => 'nearme-footer' ],
				Html::element(
					'button',
					[
						'type' => 'button',
						'class' => 'nearme-button nearme-button--primary',
						'id' => 'nearme-show-btn',
					],
					$buttonLabel
				)
			)
		);

		$html .= Html::rawElement( 'div', [ 'id' => 'nearme-app', 'class' => 'nearme-app' ], $placeholder );

		$out->addHTML( $html );
	}

	/**
	 * @param array<int,array{table:string,coordField:string,labelField?:string,label?:string,default?:bool}> $sources
	 */
	private function getShowButtonLabel( array $sources ): string {
		if ( count( $sources ) === 1 ) {
			$label = $sources[0]['label'] ?? $sources[0]['table'];
			return $this->msg( 'nearme-show-button-table', $label )->text();
		}

		foreach ( $sources as $source ) {
			if ( !empty( $source['default'] ) ) {
				$label = $source['label'] ?? $source['table'];
				return $this->msg( 'nearme-show-button-table', $label )->text();
			}
		}

		return $this->msg( 'nearme-show-button' )->text();
	}

	/**
	 * @param array<int,array{label:string,lat:float,lon:float}> $examples
	 */
	private function getExamplesHtml( array $examples ): string {
		if ( $examples === [] ) {
			return '';
		}

		$html = Html::element(
			'span',
			[ 'class' => 'nearme-examples__label' ],
			$this->msg( 'nearme-try-without-gps' )->text()
		) . ' ';

		foreach ( $examples as $index => $example ) {
			if ( $index > 0 ) {
				$html .= Html::element(
					'span',
					[ 'class' => 'nearme-examples__sep', 'aria-hidden' => 'true' ],
					'·'
				);
			}
			$html .= Html::element(
				'a',
				[
					'class' => 'nearme-examples__link',
					'href' => '#/coord/' . $example['lat'] . ',' . $example['lon'],
				],
				$example['label']
			);
		}

		return Html::rawElement( 'p', [ 'class' => 'nearme-examples' ], $html );
	}

	private function getIntroHtml(): string {
		$pageName = (string)$this->getConfig()->get( 'NearMeIntroPage' );
		if ( $pageName === '' ) {
			return '';
		}

		$title = Title::makeTitleSafe( NS_MEDIAWIKI, $pageName );
		if ( $title === null || !$title->exists() ) {
			return '';
		}

		$wikiPage = MediaWikiServices::getInstance()->getWikiPageFactory()->newFromTitle( $title );
		$parserOutput = $wikiPage->getParserOutput(
			ParserOptions::newFromContext( $this->getContext() )
		);
		if ( $parserOutput === null ) {
			return '';
		}

		return $parserOutput->getText( [
			'enableSectionEditLinks' => false,
		] );
	}

	/** @inheritDoc */
	protected function getGroupName(): string {
		return 'pages';
	}
}