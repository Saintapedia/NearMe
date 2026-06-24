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

		if ( !ExtensionRegistry::getInstance()->isLoaded( 'Cargo' ) ) {
			$this->getOutput()->addWikiMsg( 'nearme-error-cargo-missing' );
			return;
		}

		$out = $this->getOutput();
		$out->setPageTitleMsg( $this->msg( 'nearme-title' ) );
		$out->addModuleStyles( [ 'ext.NearMe.styles' ] );
		$out->addModules( [ 'ext.NearMe' ] );

		$html = Html::rawElement(
			'noscript',
			[],
			Html::errorBox(
				$this->msg( 'nearme-requirements-guidance' )->parse(),
				$this->msg( 'nearme-requirements' )->text()
			)
		);

		$html .= Html::rawElement( 'div', [ 'id' => 'nearme-app', 'class' => 'nearme-app' ], '' );

		$out->addHTML( $html );
	}

	/** @inheritDoc */
	protected function getGroupName(): string {
		return 'pages';
	}
}