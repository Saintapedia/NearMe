<?php
/**
 * Extension registration hooks for NearMe.
 *
 * @file
 */

declare( strict_types = 1 );

namespace MediaWiki\Extension\NearMe;

/**
 * Registration-time defaults (rate limits for anonymous search surfaces).
 */
class NearMeHooks {

	/**
	 * Ensure $wgRateLimits has keys for NearMe anonymous API modules.
	 * Site config can override by setting the same keys in LocalSettings.php.
	 */
	public static function onExtensionFunction(): void {
		global $wgRateLimits;

		// 30 requests / 60s for anonymous IP; logged-in users get a higher budget.
		// action=cargonearbysearch and action=cargonearbygeocode both use this key.
		if ( !isset( $wgRateLimits['nearme-search'] ) ) {
			$wgRateLimits['nearme-search'] = [
				'ip' => [ 30, 60 ],
				'newbie' => [ 40, 60 ],
				'user' => [ 60, 60 ],
			];
		}
	}
}
