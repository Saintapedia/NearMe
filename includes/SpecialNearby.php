<?php
/**
 * Special:Nearby — location-based article discovery from Cargo coordinates.
 *
 * @file
 */

declare( strict_types = 1 );

namespace MediaWiki\Extension\NearMe;

use ExtensionRegistry;
use Html;
use SpecialPage;

/**
 * Provide Special:Nearby with Cargo-backed nearby pages.
 */
class SpecialNearby extends SpecialPage {

	public function __construct() {
		parent::__construct( 'Nearby' );
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
		$out->setPageTitleMsg( $this->msg( 'nearme-title' ) );
		$out->addModuleStyles( [ 'ext.NearMe.styles' ] );

		$modules = [ 'ext.NearMe' ];
		if ( $registry->isLoaded( 'Maps' ) ) {
			$modules[] = 'ext.NearMe.maps';
			$out->addJsConfigVars( [ 'wgNearMeMapsEnabled' => true ] );
		}
		$out->addModules( $modules );

		$html = Html::rawElement(
			'noscript',
			[],
			Html::errorBox(
				$this->msg( 'nearme-requirements-guidance' )->parse(),
				$this->msg( 'nearme-requirements' )->text()
			)
		);

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
				)
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
					$this->msg( 'nearme-show-button' )->text()
				)
			)
		);

		$html .= Html::rawElement( 'div', [ 'id' => 'nearme-app', 'class' => 'nearme-app' ], $placeholder );

		$out->addHTML( $html );
	}

	/** @inheritDoc */
	protected function getGroupName(): string {
		return 'pages';
	}
}