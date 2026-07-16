/**
 * NearMe map — Leaflet markers for nearby results.
 *
 * Requires Extension:Maps (ext.maps.leaflet.library).
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
		this.cluster = null;
		this.centerMarker = null;
	}

	NearMeMap.prototype.getTileLayer = function () {
		var layerName = mw.config.get( 'wgNearMeMapsLeafletLayer', DEFAULT_LAYER );
		try {
			return L.tileLayer.provider( layerName );
		} catch ( err ) {
			return L.tileLayer.provider( DEFAULT_LAYER );
		}
	};

	/**
	 * Maps' Leaflet cluster CSS omits default circle backgrounds; use its PNG icons.
	 *
	 * @return {L.LayerGroup|L.MarkerClusterGroup}
	 */
	NearMeMap.prototype.createClusterLayer = function () {
		if ( window.maps && window.maps.leaflet && window.maps.leaflet.LeafletCluster ) {
			return window.maps.leaflet.LeafletCluster.newLayer( {
				clustermaxradius: 50,
				clustermaxzoom: 18,
				clusterzoomonclick: true,
				clusterspiderfy: true
			} );
		}

		if ( typeof L.markerClusterGroup !== 'function' ) {
			return L.layerGroup();
		}

		var imagePath = mw.config.get( 'wgExtensionAssetsPath', '/w/extensions' ) +
			'/Maps/resources/leaflet/cluster/';

		return L.markerClusterGroup( {
			showCoverageOnHover: false,
			maxClusterRadius: 50,
			iconCreateFunction: function ( cluster ) {
				var childCount = cluster.getChildCount();
				var styles = [
					{ iconUrl: imagePath + 'm1.png', iconSize: [ 53, 52 ] },
					{ iconUrl: imagePath + 'm2.png', iconSize: [ 56, 55 ] },
					{ iconUrl: imagePath + 'm3.png', iconSize: [ 66, 65 ] },
					{ iconUrl: imagePath + 'm4.png', iconSize: [ 78, 77 ] },
					{ iconUrl: imagePath + 'm5.png', iconSize: [ 90, 89 ] }
				];
				var index = 0;
				var dv = childCount;
				while ( dv !== 0 ) {
					dv = parseInt( dv / 10, 10 );
					index++;
				}
				index = Math.max( 0, Math.min( styles.length - 1, index - 1 ) );
				var style = styles[ index ];

				return L.divIcon( {
					iconSize: style.iconSize,
					className: 'nearme-cluster-icon',
					html: '<img alt="" src="' + mw.html.escape( style.iconUrl ) + '" />' +
						'<span class="nearme-cluster-icon__count">' + childCount + '</span>'
				} );
			}
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
		this.cluster = this.createClusterLayer();
		this.map.addLayer( this.cluster );
	};

	/**
	 * @param {{lat: number, lon: number}} center
	 * @param {Object[]} pages Result cards from NearMeApi.toCard
	 */
	NearMeMap.prototype.update = function ( center, pages ) {
		var self = this;
		this.ensureMap();
		this.cluster.clearLayers();

		if ( this.centerMarker ) {
			this.map.removeLayer( this.centerMarker );
			this.centerMarker = null;
		}

		var bounds = L.latLngBounds( [] );
		var centerLatLng = L.latLng( center.lat, center.lon );

		this.centerMarker = L.circleMarker( centerLatLng, {
			radius: 8,
			color: '#36c',
			fillColor: '#36c',
			fillOpacity: 0.9,
			weight: 2
		} ).bindPopup( mw.msg( 'nearme-map-you-are-here' ) ).addTo( this.map );
		bounds.extend( centerLatLng );

		pages.forEach( function ( page ) {
			if ( page.lat == null || page.lon == null ) {
				return;
			}
			var latlng = L.latLng( page.lat, page.lon );
			var popup = '<a href="' + mw.html.escape( page.url ) + '">' +
				mw.html.escape( page.title ) + '</a>';
			if ( page.proximity ) {
				popup += '<br><span class="nearme-map__distance">' +
					mw.html.escape( page.proximity ) + '</span>';
			}
			self.cluster.addLayer( L.marker( latlng ).bindPopup( popup ) );
			bounds.extend( latlng );
		} );

		if ( bounds.isValid() ) {
			this.map.fitBounds( bounds.pad( 0.12 ) );
		} else {
			this.map.setView( centerLatLng, 14 );
		}

		setTimeout( function () {
			self.map.invalidateSize();
		}, 0 );
	};

	NearMeMap.prototype.destroy = function () {
		if ( this.map ) {
			this.map.remove();
			this.map = null;
			this.cluster = null;
			this.centerMarker = null;
		}
	};

	window.NearMeMap = NearMeMap;
}() );