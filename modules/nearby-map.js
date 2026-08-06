/**
 * NearMe map — Leaflet markers for nearby results.
 *
 * Requires Extension:Maps (ext.maps.leaflet.library).
 *
 * Result pins use CSS divIcons (not Leaflet default PNGs) so markers stay
 * visible even when Maps' egMapsScriptPath imagePath is wrong (common on
 * Canasta user-extension layouts).
 *
 * @module nearby-map
 */
( function () {
	'use strict';

	var DEFAULT_LAYER = 'OpenStreetMap';

	/**
	 * @param {HTMLElement} container
	 */
	function NearMeMap( container ) {
		this.container = container;
		this.map = null;
		this.resultsLayer = null;
		this.centerMarker = null;
		/** @type {Object.<string, L.Marker>} */
		this.markersById = {};
	}

	NearMeMap.prototype.getTileLayer = function () {
		var layerName = mw.config.get( 'egMapsLeafletLayer', DEFAULT_LAYER );
		try {
			return L.tileLayer.provider( layerName );
		} catch ( err ) {
			try {
				return L.tileLayer.provider( DEFAULT_LAYER );
			} catch ( err2 ) {
				// Last resort: plain OSM tiles (no leaflet-providers).
				return L.tileLayer( 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
					maxZoom: 19,
					attribution: '&copy; OpenStreetMap'
				} );
			}
		}
	};

	/**
	 * Numbered pin matching the results list (1-based index).
	 *
	 * @param {number} index1
	 * @param {boolean} [isPlace]
	 * @return {L.DivIcon}
	 */
	NearMeMap.prototype.makeResultIcon = function ( index1, isPlace ) {
		var label = String( index1 );
		var cls = 'nearme-map-pin' + ( isPlace ? ' nearme-map-pin--place' : '' );
		return L.divIcon( {
			className: cls,
			html: '<span class="nearme-map-pin__dot">' + mw.html.escape( label ) + '</span>',
			iconSize: [ 28, 28 ],
			iconAnchor: [ 14, 14 ],
			popupAnchor: [ 0, -14 ]
		} );
	};

	NearMeMap.prototype.ensureMap = function () {
		if ( this.map ) {
			return;
		}

		this.map = L.map( this.container, {
			zoomControl: true,
			scrollWheelZoom: false
		} );
		this.getTileLayer().addTo( this.map );
		// LayerGroup (not cluster): numbered pins stay readable and do not
		// depend on Maps cluster PNG paths under /extensions/Maps/.
		this.resultsLayer = L.layerGroup().addTo( this.map );
	};

	/**
	 * @param {{lat: number, lon: number}|null} center Search origin (null for name-match maps)
	 * @param {Object[]} pages Result cards from NearMeApi.toCard / name matches
	 * @param {Object} [options]
	 * @param {boolean} [options.fitBounds=true] When false, only refresh markers (keep camera).
	 * @param {function(Object):void} [options.onMarkerClick] Called when a result marker is clicked
	 */
	NearMeMap.prototype.update = function ( center, pages, options ) {
		var self = this;
		options = options || {};
		var shouldFitBounds = options.fitBounds !== false;
		var onMarkerClick = typeof options.onMarkerClick === 'function' ?
			options.onMarkerClick : null;

		this.ensureMap();
		this.resultsLayer.clearLayers();
		this.markersById = {};

		if ( this.centerMarker ) {
			this.map.removeLayer( this.centerMarker );
			this.centerMarker = null;
		}

		var bounds = L.latLngBounds( [] );
		var centerLatLng = null;

		if ( center && center.lat != null && center.lon != null ) {
			centerLatLng = L.latLng( center.lat, center.lon );
			this.centerMarker = L.circleMarker( centerLatLng, {
				radius: 9,
				color: '#fff',
				fillColor: '#36c',
				fillOpacity: 1,
				weight: 2
			} ).bindPopup( mw.msg( 'nearme-map-you-are-here' ) ).addTo( this.map );
			bounds.extend( centerLatLng );
		}

		var index1 = 0;
		pages.forEach( function ( page ) {
			if ( page.lat == null || page.lon == null ) {
				return;
			}
			index1 += 1;
			var latlng = L.latLng( page.lat, page.lon );
			var isPlace = page.source === 'geocode' || page.source === 'coordinates';
			var popup = page.url ?
				'<a href="' + mw.html.escape( page.url ) + '">' +
				mw.html.escape( page.title ) + '</a>' :
				mw.html.escape( page.title );
			if ( page.subtitle ) {
				popup += '<br><span class="nearme-map__distance">' +
					mw.html.escape( page.subtitle ) + '</span>';
			}
			if ( page.proximity ) {
				popup += '<br><span class="nearme-map__distance">' +
					mw.html.escape( page.proximity ) + '</span>';
			}
			if ( onMarkerClick ) {
				popup += '<br><button type="button" class="nearme-map__nearby-btn">' +
					mw.html.escape( mw.msg( 'nearme-name-search-nearby' ) ) +
					'</button>';
			}

			var marker = L.marker( latlng, {
				icon: self.makeResultIcon( index1, isPlace ),
				title: page.title || ''
			} ).bindPopup( popup );

			if ( onMarkerClick ) {
				marker.on( 'popupopen', function () {
					var btn = self.container.querySelector( '.nearme-map__nearby-btn' );
					if ( btn ) {
						btn.addEventListener( 'click', function ( event ) {
							event.preventDefault();
							onMarkerClick( page );
						} );
					}
				} );
			}

			self.resultsLayer.addLayer( marker );
			var id = page.id || ( page.lat + ',' + page.lon + ':' + index1 );
			self.markersById[ id ] = marker;
			// Also index by list position for click-from-list.
			self.markersById[ 'i:' + index1 ] = marker;
			bounds.extend( latlng );
		} );

		if ( shouldFitBounds ) {
			if ( bounds.isValid() ) {
				var pad = pages.length === 1 && !centerLatLng ? 0.35 : 0.12;
				this.map.fitBounds( bounds.pad( pad ) );
				if ( pages.length === 1 && !centerLatLng ) {
					var z = this.map.getZoom();
					if ( z > 14 ) {
						this.map.setZoom( 14 );
					}
				}
			} else if ( centerLatLng ) {
				this.map.setView( centerLatLng, 14 );
			}
		}

		setTimeout( function () {
			if ( self.map ) {
				self.map.invalidateSize();
			}
		}, 0 );
	};

	/**
	 * Open the popup for a result (by page id or 1-based list index).
	 *
	 * @param {string|number} idOrIndex
	 */
	NearMeMap.prototype.openResult = function ( idOrIndex ) {
		if ( !this.map ) {
			return;
		}
		var marker = this.markersById[ idOrIndex ] ||
			this.markersById[ 'i:' + idOrIndex ];
		if ( marker ) {
			marker.openPopup();
			var ll = marker.getLatLng();
			if ( ll ) {
				this.map.panTo( ll );
			}
		}
	};

	NearMeMap.prototype.destroy = function () {
		if ( this.map ) {
			this.map.remove();
			this.map = null;
			this.resultsLayer = null;
			this.centerMarker = null;
			this.markersById = {};
		}
	};

	window.NearMeMap = NearMeMap;
}() );