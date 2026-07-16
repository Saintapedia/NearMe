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
	 * @param {OO.Router} router
	 */
	function NearMeApp( root, router ) {
		this.root = root;
		this.router = router;
		this.pages = [];
		this.center = null;
		this.error = null;
		this.loading = false;
		// locating: browser geolocation pending; loading: Cargo API pending
		this.locating = false;
		this.showButtonDisabled = false;
		this.loadInFlight = null;
		this.mapView = null;
		this.render();
		try {
			this.bindRoutes();
		} catch ( err ) {
			this.error = mw.msg( 'nearme-error' ) + ' ' + mw.msg( 'nearme-error-guidance' );
			if ( window.console && window.console.error ) {
				window.console.error( 'NearMe bindRoutes failed:', err );
			}
			this.render();
		}
	}

	NearMeApp.prototype.render = function () {
		var self = this;
		var mapsEnabled = mw.config.get( 'wgNearMeMapsEnabled', false );
		var hasMap = this.pages.length > 0 && mapsEnabled;
		var shellClass = 'nearme-shell' + ( hasMap ? ' nearme-shell--with-map' : '' );

		if ( this.mapView ) {
			this.mapView.destroy();
			this.mapView = null;
		}

		var html = '<div class="' + shellClass + '">';

		if ( this.error ) {
			html += '<div class="nearme-message nearme-message--error">' +
				mw.html.escape( this.error ) + '</div>';
		}

		// Two-phase feedback: GPS can take up to 15s before the Cargo search begins.
		if ( this.locating ) {
			html += '<div class="nearme-message nearme-message--loading">' +
				mw.html.escape( mw.msg( 'nearme-locating' ) ) + '</div>';
		} else if ( this.loading ) {
			html += '<div class="nearme-message nearme-message--loading">' +
				mw.html.escape( mw.msg( 'nearme-loading' ) ) + '</div>';
		}

		if ( this.pages.length === 0 && !this.loading && !this.locating && !this.error ) {
			html += '<div class="nearme-hero">' +
				'<h3 class="nearme-hero__heading">' + mw.html.escape( mw.msg( 'nearme-info-heading' ) ) + '</h3>' +
				'<p class="nearme-hero__description">' + mw.html.escape( mw.msg( 'nearme-info-description' ) ) + '</p>' +
				'</div>';
		}

		if ( this.pages.length > 0 ) {
			if ( mapsEnabled ) {
				html += '<div id="nearme-map" class="nearme-map" role="region" aria-label="' +
					mw.html.escape( mw.msg( 'nearme-map-label' ) ) + '"></div>';
			}
			html += '<ol class="nearme-list">';
			this.pages.forEach( function ( page ) {
				html += '<li class="nearme-list__item">' +
					'<a class="nearme-list__link" href="' + mw.html.escape( page.url ) + '">' +
					mw.html.escape( page.title ) +
					'</a>';
				if ( page.proximity ) {
					html += '<span class="nearme-list__distance">' + mw.html.escape( page.proximity ) + '</span>';
				}
				html += '</li>';
			} );
			html += '</ol>';
		}

		html += '<div class="nearme-footer">' +
			'<button type="button" class="nearme-button nearme-button--primary" id="nearme-show-btn"' +
			( this.showButtonDisabled ? ' disabled' : '' ) + '>' +
			mw.html.escape( mw.msg( 'nearme-show-button' ) ) +
			'</button></div>';

		html += '</div>';
		this.root.innerHTML = html;

		var btn = this.root.querySelector( '#nearme-show-btn' );
		if ( btn ) {
			btn.addEventListener( 'click', function () {
				self.showNearby();
			} );
		}

		this.updateMap();
	};

	NearMeApp.prototype.updateMap = function () {
		if ( !mw.config.get( 'wgNearMeMapsEnabled', false ) || !this.center || this.pages.length === 0 ) {
			return;
		}

		var mapEl = this.root.querySelector( '#nearme-map' );
		if ( !mapEl ) {
			return;
		}

		var self = this;
		function initMap() {
			if ( !window.NearMeMap ) {
				return;
			}
			if ( self.mapView ) {
				self.mapView.destroy();
			}
			self.mapView = new window.NearMeMap( mapEl );
			self.mapView.update( self.center, self.pages );
		}

		if ( window.NearMeMap ) {
			initMap();
		} else if ( mw.loader.getState( 'ext.NearMe.maps' ) !== null ) {
			mw.loader.using( 'ext.NearMe.maps' ).then( initMap );
		}
	};

	NearMeApp.prototype.setError = function ( messageKey ) {
		this.error = mw.msg( messageKey );
		if ( messageKey === 'nearme-error' ) {
			this.error += ' ' + mw.msg( 'nearme-error-guidance' );
		}
		this.pages = [];
		this.loading = false;
		this.locating = false;
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
		// Keep disabled through the full locate → search cycle (see showNearby).
		this.showButtonDisabled = true;
		this.pages = [];
		this.render();

		var coordPath = '/coord/' + lat + ',' + lon;
		if ( location.hash.replace( /^#/, '' ) !== coordPath ) {
			this.router.navigateTo( null, {
				path: '#' + coordPath,
				useReplaceState: true
			} );
		}

		nearbyApi.getPagesAtCoordinates( lat, lon ).then( function ( result ) {
			self.loading = false;
			self.loadInFlight = null;
			self.showButtonDisabled = false;
			self.center = { lat: lat, lon: lon };
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
			self.showButtonDisabled = false;
			self.setError( 'nearme-error' );
		} );
	};

	NearMeApp.prototype.showNearby = function () {
		var self = this;

		// Ignore re-clicks while a request is in flight (button is also disabled).
		if ( this.locating || this.loading ) {
			return;
		}

		this.locating = true;
		this.showButtonDisabled = true;
		this.error = null;
		this.render();

		locationProvider.getCurrentPosition().then( function ( coordinate ) {
			self.locating = false;
			// loadPages owns showButtonDisabled until the Cargo call finishes.
			self.loadPages( coordinate.latitude, coordinate.longitude );
		}, function ( code ) {
			self.locating = false;
			switch ( code ) {
				case locationProvider.ERROR_PERMISSION_DENIED:
					// Permanent until the user changes site permission in the browser.
					self.showButtonDisabled = true;
					self.setError( 'nearme-permission-denied' );
					break;
				case locationProvider.ERROR_POSITION_UNAVAILABLE:
				case locationProvider.ERROR_TIMEOUT:
					self.showButtonDisabled = false;
					self.setError( 'nearme-location-unavailable' );
					break;
				default:
					self.showButtonDisabled = false;
					self.setError( 'nearme-error' );
			}
		} );
	};

	NearMeApp.prototype.clearResults = function () {
		this.pages = [];
		this.center = null;
		this.error = null;
		this.loading = false;
		this.locating = false;
		this.render();
	};

	NearMeApp.prototype.bindRoutes = function () {
		var self = this;
		var coordinateRegex = /^\/coord\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

		this.router.addRoute(
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

		this.router.checkRoute();
	};

	$( function () {
		var root = document.getElementById( 'nearme-app' );
		if ( !root ) {
			return;
		}
		var router;
		try {
			router = mw.loader.require( 'mediawiki.router' );
		} catch ( err ) {
			root.innerHTML = '<div class="nearme-shell"><div class="nearme-message nearme-message--error">' +
				mw.html.escape( mw.msg( 'nearme-error' ) + ' ' + mw.msg( 'nearme-error-guidance' ) ) +
				'</div></div>';
			if ( window.console && window.console.error ) {
				window.console.error( 'NearMe failed to load mediawiki.router:', err );
			}
			return;
		}
		new NearMeApp( root, router );
	} );
}() );