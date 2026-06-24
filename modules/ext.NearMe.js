/**
 * NearMe frontend — Special:Nearby
 *
 * Hash routes (NearbyPages-compatible):
 *   #/coord/lat,lon
 *
 * @module ext.NearMe
 */
( function () {
	'use strict';

	var locationProvider = window.NearMeLocationProvider;
	var nearbyApi = window.NearMeApi;

	/**
	 * @param {HTMLElement} root
	 */
	function NearMeApp( root ) {
		this.root = root;
		this.pages = [];
		this.error = null;
		this.loading = false;
		this.showButtonDisabled = false;
		this.loadInFlight = null;
		this.render();
		this.bindRoutes();
	}

	NearMeApp.prototype.render = function () {
		var self = this;
		var html = '<div class="nearme-shell">';

		if ( this.error ) {
			html += '<div class="nearme-message nearme-message--error">' +
				mw.util.escapeHtml( this.error ) + '</div>';
		}

		if ( this.loading ) {
			html += '<div class="nearme-message nearme-message--loading">' +
				mw.util.escapeHtml( mw.msg( 'nearme-loading' ) ) + '</div>';
		}

		if ( this.pages.length === 0 && !this.loading && !this.error ) {
			html += '<div class="nearme-hero">' +
				'<h3 class="nearme-hero__heading">' + mw.util.escapeHtml( mw.msg( 'nearme-info-heading' ) ) + '</h3>' +
				'<p class="nearme-hero__description">' + mw.util.escapeHtml( mw.msg( 'nearme-info-description' ) ) + '</p>' +
				'</div>';
		}

		if ( this.pages.length > 0 ) {
			html += '<ol class="nearme-list">';
			this.pages.forEach( function ( page ) {
				html += '<li class="nearme-list__item">' +
					'<a class="nearme-list__link" href="' + mw.util.escapeHtml( page.url ) + '">' +
					mw.util.escapeHtml( page.title ) +
					'</a>';
				if ( page.proximity ) {
					html += '<span class="nearme-list__distance">' + mw.util.escapeHtml( page.proximity ) + '</span>';
				}
				html += '</li>';
			} );
			html += '</ol>';
		}

		html += '<div class="nearme-footer">' +
			'<button type="button" class="nearme-button nearme-button--primary" id="nearme-show-btn"' +
			( this.showButtonDisabled ? ' disabled' : '' ) + '>' +
			mw.util.escapeHtml( mw.msg( 'nearme-show-button' ) ) +
			'</button></div>';

		html += '</div>';
		this.root.innerHTML = html;

		var btn = this.root.querySelector( '#nearme-show-btn' );
		if ( btn ) {
			btn.addEventListener( 'click', function () {
				self.showNearby();
			} );
		}
	};

	NearMeApp.prototype.setError = function ( messageKey ) {
		this.error = mw.msg( messageKey );
		if ( messageKey === 'nearme-error' ) {
			this.error += ' ' + mw.msg( 'nearme-error-guidance' );
		}
		this.pages = [];
		this.loading = false;
		this.render();
	};

	NearMeApp.prototype.loadPages = function ( lat, lon ) {
		var self = this;
		var coordKey = lat + ',' + lon;

		if ( this.loadInFlight === coordKey ) {
			return;
		}
		this.loadInFlight = coordKey;

		this.error = null;
		this.loading = true;
		this.pages = [];
		this.render();

		var coordPath = '/coord/' + lat + ',' + lon;
		if ( location.hash.replace( /^#/, '' ) !== coordPath ) {
			mw.router.navigateTo( null, {
				path: '#' + coordPath,
				useReplaceState: true
			} );
		}

		nearbyApi.getPagesAtCoordinates( lat, lon ).then( function ( result ) {
			self.loading = false;
			self.loadInFlight = null;
			if ( result.pages.length === 0 ) {
				self.error = mw.msg( 'nearme-noresults' ) + ' ' + mw.msg( 'nearme-noresults-guidance' );
				self.pages = [];
			} else {
				self.error = null;
				self.pages = result.pages;
			}
			self.render();
		}, function () {
			self.loading = false;
			self.loadInFlight = null;
			self.setError( 'nearme-error' );
		} );
	};

	NearMeApp.prototype.showNearby = function () {
		var self = this;
		this.showButtonDisabled = false;
		this.error = null;
		this.render();

		locationProvider.getCurrentPosition().then( function ( coordinate ) {
			self.loadPages( coordinate.latitude, coordinate.longitude );
		}, function ( code ) {
			switch ( code ) {
				case locationProvider.ERROR_PERMISSION_DENIED:
					self.showButtonDisabled = true;
					self.setError( 'nearme-permission-denied' );
					break;
				case locationProvider.ERROR_POSITION_UNAVAILABLE:
				case locationProvider.ERROR_TIMEOUT:
					self.setError( 'nearme-location-unavailable' );
					break;
				default:
					self.setError( 'nearme-error' );
			}
		} );
	};

	NearMeApp.prototype.clearResults = function () {
		this.pages = [];
		this.error = null;
		this.loading = false;
		this.render();
	};

	NearMeApp.prototype.bindRoutes = function () {
		var self = this;
		var coordinateRegex = /^\/coord\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

		mw.router.addRoute(
			coordinateRegex,
			function ( lat, lon ) {
				self.loadPages( parseFloat( lat ), parseFloat( lon ) );
			}
		);

		// MW 1.39 router has no documented exit callback; clear stale results on hash change.
		window.addEventListener( 'hashchange', function () {
			var path = location.hash.replace( /^#/, '' );
			if ( !coordinateRegex.test( path ) ) {
				self.clearResults();
			}
		} );

		mw.router.checkRoute();
	};

	$( function () {
		var root = document.getElementById( 'nearme-app' );
		if ( root ) {
			new NearMeApp( root );
		}
	} );
}() );