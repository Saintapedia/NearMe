/**
 * NearMe frontend — Special:Nearby
 *
 * Hash routes (NearbyPages-compatible):
 *   #/coord/lat,lon
 *   #/coord/lat,lon/table/TableName
 *
 * @module ext.NearMe
 */
( function () {
	'use strict';

	var locationProvider = window.NearMeLocationProvider;
	var nearbyApi = window.NearMeApi;

	/**
	 * @return {Array.<Object>}
	 */
	function getSources() {
		return mw.config.get( 'NearMeTables', [] );
	}

	/**
	 * @return {Array.<{label:string,lat:number,lon:number}>}
	 */
	function getExamples() {
		return mw.config.get( 'NearMeExamples', [] );
	}

	/**
	 * @param {Array.<Object>} sources
	 * @return {Object.<string,string>}
	 */
	function buildTableLabels( sources ) {
		var labels = {};
		sources.forEach( function ( source ) {
			labels[ source.table ] = source.label || source.table;
		} );
		return labels;
	}

	/**
	 * @param {Array.<Object>} sources
	 * @param {string|null} selectedTable
	 * @return {string}
	 */
	function getButtonLabel( sources, selectedTable ) {
		if ( selectedTable ) {
			var match = sources.filter( function ( s ) {
				return s.table === selectedTable;
			} )[ 0 ];
			if ( match ) {
				return mw.msg( 'nearme-show-button-table', match.label || match.table );
			}
		}

		if ( sources.length === 1 ) {
			return mw.msg( 'nearme-show-button-table', sources[ 0 ].label || sources[ 0 ].table );
		}

		var defaultSource = sources.filter( function ( s ) {
			return s.default;
		} )[ 0 ];
		if ( defaultSource ) {
			return mw.msg( 'nearme-show-button-table', defaultSource.label || defaultSource.table );
		}

		return mw.msg( 'nearme-show-button' );
	}

	/**
	 * @param {HTMLElement} root
	 * @param {OO.Router} router
	 */
	function NearMeApp( root, router ) {
		this.root = root;
		this.router = router;
		this.sources = getSources();
		this.tableLabels = buildTableLabels( this.sources );
		this.selectedTable = this.getInitialTable();
		this.pages = [];
		this.filterQuery = '';
		this.nameQuery = '';
		this.nameMatches = [];
		this.nameSearching = false;
		this.nameSearchError = null;
		this.nameSearchDebounceTimer = null;
		this.center = null;
		this.error = null;
		this.loading = false;
		this.locating = false;
		this.showButtonDisabled = false;
		this.loadInFlight = null;
		this.mapView = null;
		this.mapCollapsed = false;
		this.filterDebounceTimer = null;
		this.mapUpdateGeneration = 0;
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

	/**
	 * @return {string|null}
	 */
	NearMeApp.prototype.getInitialTable = function () {
		if ( this.sources.length <= 1 ) {
			return this.sources.length === 1 ? this.sources[ 0 ].table : null;
		}

		var defaultSource = this.sources.filter( function ( s ) {
			return s.default;
		} )[ 0 ];
		return defaultSource ? defaultSource.table : null;
	};

	/**
	 * @return {boolean}
	 */
	NearMeApp.prototype.showTablePicker = function () {
		return this.sources.length > 1;
	};

	/**
	 * @return {boolean}
	 */
	NearMeApp.prototype.showTableBadges = function () {
		return this.sources.length > 1 && !this.selectedTable;
	};

	NearMeApp.prototype.renderExamples = function () {
		var examples = getExamples();
		if ( examples.length === 0 ) {
			return '';
		}

		var html = '<p class="nearme-examples"><span class="nearme-examples__label">' +
			mw.html.escape( mw.msg( 'nearme-try-without-gps' ) ) + '</span> ';
		examples.forEach( function ( example, index ) {
			if ( index > 0 ) {
				html += '<span class="nearme-examples__sep" aria-hidden="true">·</span>';
			}
			html += '<a class="nearme-examples__link" href="#/coord/' +
				example.lat + ',' + example.lon + '">' +
				mw.html.escape( example.label ) + '</a>';
		} );
		html += '</p>';
		return html;
	};

	/**
	 * Name search on the empty hero (find a place, then show nearby from there).
	 *
	 * @return {string}
	 */
	NearMeApp.prototype.renderNameSearch = function () {
		return '<div class="nearme-name-search">' +
			'<label class="nearme-name-search__label" for="nearme-name-search">' +
			mw.html.escape( mw.msg( 'nearme-name-search-label' ) ) +
			'</label>' +
			'<p class="nearme-name-search__hint">' +
			mw.html.escape( mw.msg( 'nearme-name-search-hint' ) ) +
			'</p>' +
			'<div class="nearme-name-search__row">' +
			'<input type="search" id="nearme-name-search" class="nearme-name-search__input" ' +
			'placeholder="' + mw.html.escape( mw.msg( 'nearme-name-search-placeholder' ) ) + '" ' +
			'value="' + mw.html.escape( this.nameQuery || '' ) + '" ' +
			'autocomplete="off" enterkeyhint="search" />' +
			'<button type="button" class="nearme-button nearme-button--secondary" id="nearme-name-search-btn">' +
			mw.html.escape( mw.msg( 'nearme-name-search-button' ) ) +
			'</button>' +
			'</div>' +
			'</div>';
	};

	/**
	 * @return {string}
	 */
	NearMeApp.prototype.renderNameMatches = function () {
		var self = this;
		var html = '';

		if ( this.nameSearching ) {
			html += '<div class="nearme-message nearme-message--loading" role="status">' +
				mw.html.escape( mw.msg( 'nearme-name-searching' ) ) +
				'</div>';
			return html;
		}

		if ( this.nameSearchError ) {
			html += '<div class="nearme-message nearme-message--error" role="status">' +
				mw.html.escape( this.nameSearchError ) +
				'</div>';
			return html;
		}

		if ( !this.nameQuery || this.nameQuery.trim().length < 2 ) {
			return html;
		}

		if ( this.nameMatches.length === 0 ) {
			html += '<div class="nearme-message nearme-message--empty" role="status">' +
				mw.html.escape( mw.msg( 'nearme-name-search-no-matches' ) ) +
				'</div>';
			return html;
		}

		html += '<ul class="nearme-name-matches" aria-label="' +
			mw.html.escape( mw.msg( 'nearme-name-search-label' ) ) + '">';
		this.nameMatches.forEach( function ( match, index ) {
			var showBadge = self.showTableBadges() && match.tableLabel;
			html += '<li class="nearme-name-matches__item">';
			if ( showBadge ) {
				html += '<span class="nearme-list__badge">' +
					mw.html.escape( match.tableLabel ) + '</span>';
			}
			html += '<button type="button" class="nearme-name-matches__nearby" ' +
				'data-index="' + index + '">' +
				mw.html.escape( match.title ) +
				'<span class="nearme-name-matches__action">' +
				mw.html.escape( mw.msg( 'nearme-name-search-nearby' ) ) +
				'</span></button>';
			html += '<a class="nearme-name-matches__page" href="' +
				mw.html.escape( match.url ) + '">' +
				mw.html.escape( mw.msg( 'nearme-name-search-open-page' ) ) +
				'</a>';
			html += '</li>';
		} );
		html += '</ul>';
		return html;
	};

	NearMeApp.prototype.clearNameSearchDebounce = function () {
		if ( this.nameSearchDebounceTimer ) {
			clearTimeout( this.nameSearchDebounceTimer );
			this.nameSearchDebounceTimer = null;
		}
	};

	NearMeApp.prototype.bindNameSearch = function () {
		var self = this;
		var input = this.root.querySelector( '#nearme-name-search' );
		var btn = this.root.querySelector( '#nearme-name-search-btn' );
		if ( !input ) {
			return;
		}

		var runSearch = function () {
			self.clearNameSearchDebounce();
			self.nameQuery = input.value;
			self.runNameSearch();
		};

		input.addEventListener( 'input', function () {
			self.nameQuery = input.value;
			self.clearNameSearchDebounce();
			self.nameSearchDebounceTimer = setTimeout( function () {
				self.nameSearchDebounceTimer = null;
				self.runNameSearch();
			}, 300 );
		} );
		input.addEventListener( 'keydown', function ( event ) {
			if ( event.key === 'Enter' ) {
				event.preventDefault();
				runSearch();
			}
		} );
		if ( btn ) {
			btn.addEventListener( 'click', runSearch );
		}

		var matchButtons = this.root.querySelectorAll( '.nearme-name-matches__nearby' );
		matchButtons.forEach( function ( matchBtn ) {
			matchBtn.addEventListener( 'click', function () {
				var index = parseInt( matchBtn.getAttribute( 'data-index' ), 10 );
				var match = self.nameMatches[ index ];
				if ( match && match.lat != null && match.lon != null ) {
					self.nameMatches = [];
					self.nameSearchError = null;
					self.loadPages( match.lat, match.lon );
				}
			} );
		} );
	};

	NearMeApp.prototype.runNameSearch = function () {
		var self = this;
		var query = ( this.nameQuery || '' ).trim();

		if ( query.length < 2 ) {
			this.nameMatches = [];
			this.nameSearching = false;
			this.nameSearchError = query.length === 0 ? null :
				mw.msg( 'nearme-name-search-too-short' );
			this.render();
			this.focusNameSearch();
			return;
		}

		this.nameSearching = true;
		this.nameSearchError = null;
		this.error = null;
		this.render();
		this.focusNameSearch();

		nearbyApi.searchByName( query, {
			table: this.selectedTable || undefined,
			tableLabels: this.tableLabels,
			limit: 20
		} ).then( function ( result ) {
			// Ignore stale responses if the user kept typing.
			if ( ( self.nameQuery || '' ).trim() !== query ) {
				return;
			}
			self.nameSearching = false;
			self.nameMatches = result.matches || [];
			self.render();
			self.focusNameSearch();
		}, function () {
			if ( ( self.nameQuery || '' ).trim() !== query ) {
				return;
			}
			self.nameSearching = false;
			self.nameMatches = [];
			self.nameSearchError = mw.msg( 'nearme-error' );
			self.render();
			self.focusNameSearch();
		} );
	};

	NearMeApp.prototype.focusNameSearch = function () {
		var input = this.root.querySelector( '#nearme-name-search' );
		if ( !input ) {
			return;
		}
		// Restore focus after full re-render (hero name search).
		var len = input.value.length;
		input.focus();
		try {
			input.setSelectionRange( len, len );
		} catch ( err ) {
			// Some input types may not support setSelectionRange.
		}
	};

	NearMeApp.prototype.bindExamples = function () {
		var self = this;
		var links = this.root.querySelectorAll( '.nearme-examples__link' );
		links.forEach( function ( link ) {
			link.addEventListener( 'click', function ( event ) {
				event.preventDefault();
				var match = link.getAttribute( 'href' ).match( /^#\/coord\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ );
				if ( match ) {
					self.loadPages( parseFloat( match[ 1 ] ), parseFloat( match[ 2 ] ) );
				}
			} );
		} );
	};

	NearMeApp.prototype.renderTablePicker = function () {
		var self = this;
		if ( !this.showTablePicker() ) {
			return '';
		}

		var html = '<div class="nearme-table-picker" role="tablist" aria-label="' +
			mw.html.escape( mw.msg( 'nearme-filter-label' ) ) + '">';

		html += '<button type="button" class="nearme-table-picker__btn' +
			( !this.selectedTable ? ' nearme-table-picker__btn--active' : '' ) +
			'" data-table="" role="tab" aria-selected="' + ( !this.selectedTable ? 'true' : 'false' ) + '">' +
			mw.html.escape( mw.msg( 'nearme-filter-all' ) ) + '</button>';

		this.sources.forEach( function ( source ) {
			var active = self.selectedTable === source.table;
			html += '<button type="button" class="nearme-table-picker__btn' +
				( active ? ' nearme-table-picker__btn--active' : '' ) +
				'" data-table="' + mw.html.escape( source.table ) + '" role="tab" aria-selected="' +
				( active ? 'true' : 'false' ) + '">' +
				mw.html.escape( source.label || source.table ) + '</button>';
		} );

		html += '</div>';
		return html;
	};

	NearMeApp.prototype.bindTablePicker = function () {
		var self = this;
		var buttons = this.root.querySelectorAll( '.nearme-table-picker__btn' );
		buttons.forEach( function ( btn ) {
			btn.addEventListener( 'click', function () {
				var table = btn.getAttribute( 'data-table' ) || null;
				self.setSelectedTable( table );
			} );
		} );
	};

	/**
	 * @return {Array.<Object>}
	 */
	NearMeApp.prototype.getFilteredPages = function () {
		var query = ( this.filterQuery || '' ).trim().toLowerCase();
		if ( !query ) {
			return this.pages;
		}
		return this.pages.filter( function ( page ) {
			// Match display label and underlying wiki title (ShortName vs full page name).
			var title = ( page.title || '' ).toLowerCase();
			var id = ( page.id || '' ).toLowerCase();
			var tableLabel = ( page.tableLabel || '' ).toLowerCase();
			return title.indexOf( query ) !== -1 ||
				id.indexOf( query ) !== -1 ||
				tableLabel.indexOf( query ) !== -1;
		} );
	};

	/**
	 * @return {string}
	 */
	NearMeApp.prototype.renderSearch = function () {
		if ( this.pages.length === 0 ) {
			return '';
		}

		return '<div class="nearme-search">' +
			'<label class="nearme-search__label" for="nearme-search">' +
			mw.html.escape( mw.msg( 'nearme-search-label' ) ) +
			'</label>' +
			'<input type="search" id="nearme-search" class="nearme-search__input" ' +
			'placeholder="' + mw.html.escape( mw.msg( 'nearme-search-placeholder' ) ) + '" ' +
			'value="' + mw.html.escape( this.filterQuery || '' ) + '" ' +
			'autocomplete="off" enterkeyhint="done" ' +
			'aria-controls="nearme-search-status nearme-results" />' +
			'</div>';
	};

	NearMeApp.prototype.clearFilterDebounce = function () {
		if ( this.filterDebounceTimer ) {
			clearTimeout( this.filterDebounceTimer );
			this.filterDebounceTimer = null;
		}
	};

	NearMeApp.prototype.bindSearch = function () {
		var self = this;
		var input = this.root.querySelector( '#nearme-search' );
		if ( !input ) {
			return;
		}
		// Coalesce rapid keystrokes so list/map work is not repeated per character.
		var FILTER_DEBOUNCE_MS = 150;
		input.addEventListener( 'input', function () {
			self.filterQuery = input.value;
			self.clearFilterDebounce();
			self.filterDebounceTimer = setTimeout( function () {
				self.filterDebounceTimer = null;
				self.updateFilteredResults();
			}, FILTER_DEBOUNCE_MS );
		} );
		input.addEventListener( 'keydown', function ( event ) {
			// Live filter only — avoid browser “search” submit quirks on Enter.
			if ( event.key === 'Enter' ) {
				event.preventDefault();
				self.clearFilterDebounce();
				self.updateFilteredResults();
			}
		} );
	};

	/**
	 * Update the persistent filter status live region.
	 *
	 * The status node is never replaced by filter updates — only its text changes —
	 * so screen readers reliably announce count / no-match feedback (aria-live).
	 */
	NearMeApp.prototype.updateSearchStatus = function () {
		var statusEl = this.root.querySelector( '#nearme-search-status' );
		if ( !statusEl ) {
			return;
		}

		var filtered = this.getFilteredPages();
		var hasQuery = ( this.filterQuery || '' ).trim() !== '';
		var text = '';

		if ( hasQuery ) {
			if ( filtered.length === 0 ) {
				text = mw.msg( 'nearme-search-no-matches' );
			} else {
				text = mw.msg( 'nearme-search-result-count', filtered.length );
			}
		}

		// Avoid no-op writes so ATs are not re-notified with identical content.
		if ( statusEl.textContent !== text ) {
			statusEl.textContent = text;
		}
		statusEl.classList.toggle( 'nearme-search-status--empty', hasQuery && filtered.length === 0 );
		statusEl.hidden = !text;
	};

	/**
	 * Re-render list + map for the current filter without destroying the search input
	 * or the persistent aria-live status region.
	 */
	NearMeApp.prototype.updateFilteredResults = function () {
		var resultsEl = this.root.querySelector( '#nearme-results' );
		if ( !resultsEl ) {
			return;
		}
		this.updateSearchStatus();
		resultsEl.innerHTML = this.renderResultsList();
		// Filter path: refresh markers without re-fitting the camera each keystroke.
		this.updateMap( { reuseMap: true, fitBounds: false } );
	};

	/**
	 * @return {string}
	 */
	NearMeApp.prototype.renderResultsList = function () {
		var self = this;
		var filtered = this.getFilteredPages();
		var html = '';

		// Empty / count messaging lives in #nearme-search-status (persistent live region).
		// This container only holds the result list so filter updates do not tear down aria-live.
		if ( filtered.length === 0 ) {
			return html;
		}

		html += '<ol class="nearme-list">';
		filtered.forEach( function ( page ) {
			var showBadge = self.showTableBadges() && page.tableLabel;
			html += '<li class="nearme-list__item' +
				( showBadge ? ' nearme-list__item--with-badge' : '' ) + '">';
			if ( showBadge ) {
				html += '<span class="nearme-list__badge">' + mw.html.escape( page.tableLabel ) + '</span>';
			}
			html += '<a class="nearme-list__link" href="' + mw.html.escape( page.url ) + '">' +
				mw.html.escape( page.title ) +
				'</a>';
			if ( page.proximity ) {
				html += '<span class="nearme-list__distance">' + mw.html.escape( page.proximity ) + '</span>';
			}
			html += '</li>';
		} );
		html += '</ol>';
		return html;
	};

	/**
	 * @param {string|null} table
	 */
	NearMeApp.prototype.setSelectedTable = function ( table ) {
		this.selectedTable = table || null;

		if ( this.center ) {
			this.loadPages( this.center.lat, this.center.lon );
		} else {
			this.render();
		}
	};

	NearMeApp.prototype.render = function () {
		var self = this;
		var mapsEnabled = mw.config.get( 'wgNearMeMapsEnabled', false );
		var hasMap = this.pages.length > 0 && mapsEnabled;
		var shellClass = 'nearme-shell' + ( hasMap ? ' nearme-shell--with-map' : '' );
		// Show hero (incl. name search) whenever there is no nearby-results list.
		// Keep it available after location errors so users can still search by name.
		var showHero = this.pages.length === 0 && !this.loading && !this.locating;

		// Full re-render replaces the DOM; drop any pending filter timer so it
		// cannot fire against a torn-down results container.
		this.clearFilterDebounce();

		if ( this.mapView ) {
			this.mapView.destroy();
			this.mapView = null;
		}

		var html = '<div class="' + shellClass + '">';

		html += this.renderTablePicker();

		if ( this.error ) {
			html += '<div class="nearme-message nearme-message--error">' +
				mw.html.escape( this.error ) + '</div>';
		}

		if ( this.locating ) {
			html += '<div class="nearme-message nearme-message--loading">' +
				mw.html.escape( mw.msg( 'nearme-locating' ) ) + '</div>';
		} else if ( this.loading ) {
			html += '<div class="nearme-message nearme-message--loading">' +
				mw.html.escape( mw.msg( 'nearme-loading' ) ) + '</div>';
		}

		if ( showHero ) {
			html += '<div class="nearme-hero">' +
				'<h3 class="nearme-hero__heading">' + mw.html.escape( mw.msg( 'nearme-info-heading' ) ) + '</h3>' +
				'<p class="nearme-hero__description">' + mw.html.escape( mw.msg( 'nearme-info-description' ) ) + '</p>' +
				this.renderNameSearch() +
				this.renderNameMatches() +
				this.renderExamples() +
				'</div>';
		}

		if ( this.pages.length > 0 ) {
			if ( mapsEnabled ) {
				html += '<div class="nearme-map-wrap' + ( this.mapCollapsed ? ' nearme-map-wrap--collapsed' : '' ) + '">';
				html += '<button type="button" class="nearme-map-toggle" aria-expanded="' +
					( this.mapCollapsed ? 'false' : 'true' ) +
					'" aria-controls="nearme-map">' +
					mw.html.escape( mw.msg( 'nearme-map-toggle' ) ) + '</button>';
				html += '<div id="nearme-map" class="nearme-map" role="region" aria-label="' +
					mw.html.escape( mw.msg( 'nearme-map-label' ) ) + '"></div>';
				html += '</div>';
			}
			html += this.renderSearch();
			// Persistent live region: textContent is updated in place on filter changes.
			// Do not put this inside #nearme-results (that subtree is replaced via innerHTML).
			html += '<div id="nearme-search-status" class="nearme-search-status" ' +
				'role="status" aria-live="polite" aria-atomic="true" hidden></div>';
			html += '<div id="nearme-results" class="nearme-results">' +
				this.renderResultsList() + '</div>';
		}

		if ( showHero ) {
			html += '<p class="nearme-privacy-hint">' +
				mw.html.escape( mw.msg( 'nearme-privacy-hint' ) ) + '</p>';
		}

		html += '<div class="nearme-footer">' +
			'<button type="button" class="nearme-button nearme-button--primary" id="nearme-show-btn"' +
			( this.showButtonDisabled ? ' disabled' : '' ) + '>' +
			mw.html.escape( getButtonLabel( this.sources, this.selectedTable ) ) +
			'</button></div>';

		html += '</div>';
		this.root.innerHTML = html;

		var btn = this.root.querySelector( '#nearme-show-btn' );
		if ( btn ) {
			btn.addEventListener( 'click', function () {
				self.showNearby();
			} );
		}

		var mapToggle = this.root.querySelector( '.nearme-map-toggle' );
		if ( mapToggle ) {
			mapToggle.addEventListener( 'click', function () {
				self.mapCollapsed = !self.mapCollapsed;
				self.render();
			} );
		}

		this.bindTablePicker();
		this.bindExamples();
		this.bindNameSearch();
		this.bindSearch();
		this.updateSearchStatus();
		this.updateMap( { reuseMap: false, fitBounds: true } );
	};

	/**
	 * @param {Object} [options]
	 * @param {boolean} [options.reuseMap] Prefer updating an existing map instance.
	 * @param {boolean} [options.fitBounds] Whether to re-fit the map camera (default true).
	 */
	NearMeApp.prototype.updateMap = function ( options ) {
		options = options || {};
		var preferReuse = !!options.reuseMap;
		var fitBounds = options.fitBounds !== false;

		if ( !mw.config.get( 'wgNearMeMapsEnabled', false ) || !this.center || this.pages.length === 0 ) {
			return;
		}

		if ( this.mapCollapsed ) {
			return;
		}

		var mapEl = this.root.querySelector( '#nearme-map' );
		if ( !mapEl ) {
			return;
		}

		var self = this;
		// Bump generation so late-resolving map module loads cannot overwrite a newer filter state.
		this.mapUpdateGeneration = ( this.mapUpdateGeneration || 0 ) + 1;
		var generation = this.mapUpdateGeneration;

		function applyMap() {
			if ( generation !== self.mapUpdateGeneration ) {
				return;
			}
			if ( !window.NearMeMap || !self.center ) {
				return;
			}
			// Read filter state at apply time so async map loads cannot use a stale snapshot.
			var filtered = self.getFilteredPages();

			if ( preferReuse && self.mapView ) {
				// Existing map: honor fitBounds (false while typing so the camera does not jump).
				self.mapView.update( self.center, filtered, { fitBounds: fitBounds } );
				return;
			}

			// Full render path destroys the map before innerHTML; recreate on a fresh container.
			// Always fit on first create — a filter keystroke may win the async race with
			// fitBounds:false before the map instance exists, leaving Leaflet at world view.
			if ( self.mapView ) {
				self.mapView.destroy();
				self.mapView = null;
			}
			self.mapView = new window.NearMeMap( mapEl );
			self.mapView.update( self.center, filtered, { fitBounds: true } );
		}

		if ( window.NearMeMap ) {
			applyMap();
		} else if ( mw.loader.getState( 'ext.NearMe.maps' ) !== null ) {
			mw.loader.using( 'ext.NearMe.maps' ).then( applyMap );
		}
	};

	NearMeApp.prototype.setError = function ( messageKey ) {
		this.error = mw.msg( messageKey );
		if ( messageKey === 'nearme-error' ) {
			this.error += ' ' + mw.msg( 'nearme-error-guidance' );
		}
		this.pages = [];
		this.filterQuery = '';
		this.clearFilterDebounce();
		this.loading = false;
		this.locating = false;
		this.render();
	};

	/**
	 * @param {number} lat
	 * @param {number} lon
	 * @param {string|null} [table]
	 */
	NearMeApp.prototype.loadPages = function ( lat, lon, table ) {
		var self = this;
		var activeTable = ( table !== undefined ) ? table : this.selectedTable;
		var coordKey = lat + ',' + lon + ':' + ( activeTable || '' );

		if ( this.loadInFlight === coordKey ) {
			return;
		}
		this.loadInFlight = coordKey;

		this.error = null;
		this.loading = true;
		this.showButtonDisabled = true;
		this.pages = [];
		this.filterQuery = '';
		this.nameMatches = [];
		this.nameSearchError = null;
		this.clearFilterDebounce();
		this.clearNameSearchDebounce();
		this.render();

		var coordPath = '/coord/' + lat + ',' + lon;
		if ( activeTable ) {
			coordPath += '/table/' + encodeURIComponent( activeTable );
		}
		if ( location.hash.replace( /^#/, '' ) !== coordPath ) {
			this.router.navigateTo( null, {
				path: '#' + coordPath,
				useReplaceState: true
			} );
		}

		nearbyApi.getPagesAtCoordinates( lat, lon, {
			table: activeTable || undefined,
			tableLabels: self.tableLabels
		} ).then( function ( result ) {
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

		if ( this.locating || this.loading ) {
			return;
		}

		this.locating = true;
		this.showButtonDisabled = true;
		this.error = null;
		this.render();

		locationProvider.getCurrentPosition().then( function ( coordinate ) {
			self.locating = false;
			self.loadPages( coordinate.latitude, coordinate.longitude );
		}, function ( code ) {
			self.locating = false;
			switch ( code ) {
				case locationProvider.ERROR_PERMISSION_DENIED:
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
		this.filterQuery = '';
		this.clearFilterDebounce();
		this.clearNameSearchDebounce();
		this.center = null;
		this.error = null;
		this.loading = false;
		this.locating = false;
		this.render();
	};

	NearMeApp.prototype.bindRoutes = function () {
		var self = this;
		var coordinateRegex = /^\/coord\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\/table\/([^/]+))?/;

		this.router.addRoute(
			coordinateRegex,
			function ( lat, lon, table ) {
				if ( table ) {
					self.selectedTable = decodeURIComponent( table );
				}
				self.loadPages( parseFloat( lat ), parseFloat( lon ), self.selectedTable );
			}
		);

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