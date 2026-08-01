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
	 * Autocomplete suggestions — same stack as Page Forms when available
	 * (action=pfautocomplete + cargo_table/cargo_field), else Cargo's
	 * action=cargoautocomplete.
	 *
	 * @param {string} query
	 * @param {Object} [options]
	 * @param {Array.<Object>} [options.sources]
	 * @param {string} [options.table]
	 * @param {Object.<string,string>} [options.tableLabels]
	 * @return {jQuery.Promise} resolves to { suggestions: Array.<{title:string,table?:string,tableLabel?:string}> }
	 */
	function suggestNames( query, options ) {
		options = options || {};
		query = ( query || '' ).trim();
		if ( query.length < 2 ) {
			return $.Deferred().resolve( { suggestions: [] } ).promise();
		}

		var sources = options.sources || mw.config.get( 'NearMeTables', [] );
		var tableFilter = options.table || null;
		var tableLabels = options.tableLabels || null;
		var usePageForms = !!mw.config.get( 'wgNearMePageFormsAutocomplete', false );

		var targets = sources.filter( function ( source ) {
			if ( tableFilter && source.table !== tableFilter ) {
				return false;
			}
			return !!getAutocompleteField( source );
		} );

		if ( targets.length === 0 ) {
			return $.Deferred().resolve( { suggestions: [] } ).promise();
		}

		var requests = targets.map( function ( source ) {
			var field = getAutocompleteField( source );
			var request;
			if ( usePageForms ) {
				request = {
					action: 'pfautocomplete',
					format: 'json',
					cargo_table: source.table,
					cargo_field: field,
					substr: query
				};
			} else {
				request = {
					action: 'cargoautocomplete',
					format: 'json',
					table: source.table,
					field: field,
					substr: query
				};
			}

			return api.get( request ).then( function ( data ) {
				var raw = [];
				if ( usePageForms && data && data.pfautocomplete ) {
					raw = data.pfautocomplete.map( function ( row ) {
						return row.displaytitle || row.title;
					} );
				} else if ( data && data.cargoautocomplete ) {
					raw = data.cargoautocomplete;
				}
				return raw.filter( Boolean ).map( function ( title ) {
					return {
						title: title,
						table: source.table,
						tableLabel: tableLabels ?
							( tableLabels[ source.table ] || source.label || source.table ) :
							( source.label || source.table )
					};
				} );
			}, function () {
				return [];
			} );
		} );

		return $.when.apply( $, requests ).then( function () {
			var lists = requests.length === 1 ?
				[ arguments[ 0 ] ] :
				Array.prototype.slice.call( arguments );
			var seen = {};
			var suggestions = [];
			lists.forEach( function ( list ) {
				( list || [] ).forEach( function ( item ) {
					var key = ( item.title || '' ).toLowerCase();
					if ( !key || seen[ key ] ) {
						return;
					}
					seen[ key ] = true;
					suggestions.push( item );
				} );
			} );
			// Prefer shorter titles first (Page Forms does this for UX).
			suggestions.sort( function ( a, b ) {
				return a.title.length - b.title.length ||
					a.title.localeCompare( b.title );
			} );
			return { suggestions: suggestions.slice( 0, 15 ) };
		} );
	}

	/**
	 * Field used for Page Forms / Cargo autocomplete (combobox values).
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
		suggestNames: suggestNames,
		getAutocompleteField: getAutocompleteField,
		formatDistance: formatDistance,
		toCard: toCard
	};
}() );