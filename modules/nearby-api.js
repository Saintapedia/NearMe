/**
 * NearMe API client — action=cargonearby
 *
 * @module nearby-api
 */
( function () {
	'use strict';

	var api = new mw.Api();

	/**
	 * @param {number} distMeters
	 * @return {string}
	 */
	function formatDistance( distMeters ) {
		if ( distMeters < 1000 ) {
			var meters = Math.ceil( distMeters / 10 ) * 10;
			if ( meters === 1000 ) {
				return mw.msg( 'nearme-distance-km', mw.language.convertNumber( '1' ) );
			}
			return mw.msg( 'nearme-distance-m', mw.language.convertNumber( String( meters ) ) );
		}

		var km = distMeters / 1000;
		var formatted;
		if ( km > 2 ) {
			formatted = ( Math.ceil( km * 10 ) / 10 ).toFixed( 1 );
		} else {
			formatted = ( Math.ceil( km * 100 ) / 100 ).toFixed( 2 );
		}
		return mw.msg( 'nearme-distance-km', mw.language.convertNumber( formatted ) );
	}

	/**
	 * @param {Object} row API result row
	 * @param {Object.<string,string>} [tableLabels]
	 * @return {Object|null}
	 */
	function toCard( row, tableLabels ) {
		var title = mw.Title.newFromText( row.title );
		if ( !title ) {
			return null;
		}
		return {
			url: title.getUrl(),
			title: row.label || row.title,
			id: row.title,
			proximity: formatDistance( row.dist ),
			geoURI: 'geo:' + row.lat + ',' + row.lon,
			lat: row.lat,
			lon: row.lon,
			table: row.table,
			tableLabel: ( tableLabels && row.table ) ? ( tableLabels[ row.table ] || row.table ) : row.table
		};
	}

	/**
	 * @param {number} lat
	 * @param {number} lon
	 * @param {Object} [options]
	 * @return {jQuery.Promise}
	 */
	function getPagesAtCoordinates( lat, lon, options ) {
		options = options || {};
		var radius = options.radius || mw.config.get( 'NearMeDefaultRadius', 10000 );
		var limit = options.limit || mw.config.get( 'NearMeDefaultLimit', 50 );
		var request = {
			action: 'cargonearby',
			format: 'json',
			gscoord: lat + '|' + lon,
			gsradius: radius,
			gslimit: limit
		};

		if ( options.table ) {
			request.table = options.table;
		}

		return api.get( request ).then( function ( data ) {
			var rows = ( data && data.cargonearby ) ? data.cargonearby : [];
			var tableLabels = options.tableLabels || null;
			return {
				pages: rows.map( function ( row ) {
					return toCard( row, tableLabels );
				} ).filter( Boolean ),
				latitude: lat,
				longitude: lon
			};
		} );
	}

	window.NearMeApi = {
		getPagesAtCoordinates: getPagesAtCoordinates,
		formatDistance: formatDistance,
		toCard: toCard
	};
}() );