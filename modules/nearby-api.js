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

	/**
	 * Typeahead suggestions for the hero name search.
	 *
	 * Merges:
	 *  - Cargo multi-field matches (parishes / configured tables)
	 *  - Free-form geocode places (cities, addresses) via Nominatim
	 *
	 * @param {string} query
	 * @param {Object} [options]
	 * @param {string} [options.table]
	 * @param {Object.<string,string>} [options.tableLabels]
	 * @param {number} [options.limit=10]
	 * @return {jQuery.Promise} resolves to {
	 *   suggestions: Array.<{
	 *     title:string, subtitle?:string, table?:string, tableLabel?:string,
	 *     lat?:number, lon?:number, url?:string, id?:string, source?:string
	 *   }>
	 * }
	 */
	function suggestNames( query, options ) {
		options = options || {};
		query = ( query || '' ).trim();
		if ( query.length < 2 ) {
			return $.Deferred().resolve( { suggestions: [] } ).promise();
		}

		return searchPlaces( query, {
			table: options.table,
			tableLabels: options.tableLabels,
			limit: options.limit || 10,
			geocodeLimit: 5
		} ).then( function ( result ) {
			return { suggestions: result.matches || [] };
		} );
	}

	/**
	 * Free-form place geocode (Nominatim via action=cargonearbygeocode).
	 *
	 * @param {string} query
	 * @param {Object} [options]
	 * @param {number} [options.limit=5]
	 * @return {jQuery.Promise}
	 */
	function geocodePlaces( query, options ) {
		options = options || {};
		if ( !mw.config.get( 'NearMeGeocodeEnabled', true ) ) {
			return $.Deferred().resolve( { matches: [] } ).promise();
		}
		query = ( query || '' ).trim();
		if ( query.length < 2 ) {
			return $.Deferred().resolve( { matches: [] } ).promise();
		}

		return api.get( {
			action: 'cargonearbygeocode',
			format: 'json',
			gsearch: query,
			gslimit: options.limit || 5
		} ).then( function ( data ) {
			var rows = ( data && data.cargonearbygeocode ) ? data.cargonearbygeocode : [];
			return {
				matches: rows.map( function ( row ) {
					if ( row.lat == null || row.lon == null || !row.title ) {
						return null;
					}
					return {
						title: row.title,
						subtitle: row.subtitle || '',
						lat: row.lat,
						lon: row.lon,
						source: row.type === 'coordinates' ? 'coordinates' : 'geocode',
						tableLabel: mw.msg( 'nearme-name-search-place-badge' ),
						id: 'geo:' + row.lat + ',' + row.lon,
						url: null
					};
				} ).filter( Boolean )
			};
		}, function () {
			return { matches: [] };
		} );
	}

	/**
	 * Combined place search: Cargo rows + free-form geocode.
	 * Geocode failures never fail the whole search.
	 *
	 * @param {string} query
	 * @param {Object} [options]
	 * @return {jQuery.Promise}
	 */
	function searchPlaces( query, options ) {
		options = options || {};
		var cargoLimit = options.limit || 20;
		var geocodeLimit = options.geocodeLimit || 5;

		var cargoPromise = searchByName( query, {
			table: options.table,
			tableLabels: options.tableLabels,
			limit: cargoLimit
		} ).then( function ( result ) {
			return ( result.matches || [] ).map( function ( match ) {
				match.source = 'cargo';
				if ( !match.tableLabel ) {
					match.tableLabel = mw.msg( 'nearme-name-search-wiki-badge' );
				}
				return match;
			} );
		}, function () {
			return [];
		} );

		var geoPromise = geocodePlaces( query, { limit: geocodeLimit } ).then( function ( result ) {
			return result.matches || [];
		} );

		return $.when( cargoPromise, geoPromise ).then( function ( cargoMatches, geoMatches ) {
			// Prefer wiki rows first, then free-form places.
			var merged = ( cargoMatches || [] ).concat( geoMatches || [] );
			var seen = {};
			var out = [];
			merged.forEach( function ( item ) {
				var key = item.source === 'cargo' ?
					( 'c:' + ( item.id || item.title ) ) :
					( 'g:' + Number( item.lat ).toFixed( 5 ) + ',' + Number( item.lon ).toFixed( 5 ) );
				if ( seen[ key ] ) {
					return;
				}
				seen[ key ] = true;
				out.push( item );
			} );
			return { matches: out };
		} );
	}

	/**
	 * Primary label field for a source (used for display defaults).
	 *
	 * @param {Object} source
	 * @return {string|null}
	 */
	function getAutocompleteField( source ) {
		if ( !source ) {
			return null;
		}
		if ( source.autocompleteField ) {
			return source.autocompleteField;
		}
		if ( source.labelField && source.labelField !== '_pageName' ) {
			return source.labelField;
		}
		if ( source.searchFields && source.searchFields.length ) {
			var i;
			for ( i = 0; i < source.searchFields.length; i++ ) {
				if ( source.searchFields[ i ] && source.searchFields[ i ] !== '_pageName' ) {
					return source.searchFields[ i ];
				}
			}
		}
		return null;
	}

	/**
	 * Name search for places with coordinates (hero search).
	 * Full Cargo multi-field query via action=cargonearbysearch.
	 *
	 * @param {string} query
	 * @param {Object} [options]
	 * @return {jQuery.Promise}
	 */
	function searchByName( query, options ) {
		options = options || {};
		var limit = options.limit || 20;
		var request = {
			action: 'cargonearbysearch',
			format: 'json',
			gsearch: query,
			gslimit: limit
		};

		if ( options.table ) {
			request.table = options.table;
		}

		return api.get( request ).then( function ( data ) {
			var rows = ( data && data.cargonearbysearch ) ? data.cargonearbysearch : [];
			var tableLabels = options.tableLabels || null;
			return {
				matches: rows.map( function ( row ) {
					var title = mw.Title.newFromText( row.title );
					if ( !title || row.lat == null || row.lon == null ) {
						return null;
					}
					var subtitle = '';
					if ( row.fields && typeof row.fields === 'object' ) {
						subtitle = Object.keys( row.fields ).map( function ( key ) {
							return row.fields[ key ];
						} ).filter( Boolean ).join( ' · ' );
					}
					return {
						url: title.getUrl(),
						title: row.label || row.title,
						id: row.title,
						lat: row.lat,
						lon: row.lon,
						table: row.table,
						tableLabel: ( tableLabels && row.table ) ?
							( tableLabels[ row.table ] || row.table ) : row.table,
						subtitle: subtitle,
						fields: row.fields || null
					};
				} ).filter( Boolean )
			};
		} );
	}

	window.NearMeApi = {
		getPagesAtCoordinates: getPagesAtCoordinates,
		searchByName: searchByName,
		searchPlaces: searchPlaces,
		geocodePlaces: geocodePlaces,
		suggestNames: suggestNames,
		getAutocompleteField: getAutocompleteField,
		formatDistance: formatDistance,
		toCard: toCard
	};
}() );