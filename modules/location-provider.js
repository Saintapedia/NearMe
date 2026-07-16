/**
 * Browser geolocation helpers for NearMe.
 *
 * @module location-provider
 */
( function () {
	'use strict';

	var ERROR_PERMISSION_DENIED = 'permission-denied';
	var ERROR_POSITION_UNAVAILABLE = 'position-unavailable';
	var ERROR_TIMEOUT = 'timeout';
	var ERROR_SERVICE_UNAVAILABLE = 'service-unavailable';

	// W3C GeolocationPositionError.code values. Do not use error.PERMISSION_DENIED etc. in
	// the getCurrentPosition error callback — those names live on the interface, not on the
	// error instance, so they are undefined and every failure would hit the default branch.
	var GEO_PERMISSION_DENIED = 1;
	var GEO_POSITION_UNAVAILABLE = 2;
	var GEO_TIMEOUT = 3;

	/**
	 * @return {jQuery.Promise}
	 */
	function getCurrentPosition() {
		var deferred = $.Deferred();

		if ( !navigator.geolocation ) {
			deferred.reject( ERROR_SERVICE_UNAVAILABLE );
			return deferred.promise();
		}

		navigator.geolocation.getCurrentPosition(
			function ( position ) {
				deferred.resolve( {
					latitude: position.coords.latitude,
					longitude: position.coords.longitude
				} );
			},
			function ( error ) {
				switch ( error.code ) {
					case GEO_PERMISSION_DENIED:
						deferred.reject( ERROR_PERMISSION_DENIED );
						break;
					case GEO_POSITION_UNAVAILABLE:
						deferred.reject( ERROR_POSITION_UNAVAILABLE );
						break;
					case GEO_TIMEOUT:
						deferred.reject( ERROR_TIMEOUT );
						break;
					default:
						deferred.reject( ERROR_SERVICE_UNAVAILABLE );
				}
			},
			{
				// High accuracy can take several seconds; the UI shows nearme-locating meanwhile.
				enableHighAccuracy: true,
				timeout: 15000,
				maximumAge: 60000
			}
		);

		return deferred.promise();
	}

	window.NearMeLocationProvider = {
		getCurrentPosition: getCurrentPosition,
		ERROR_PERMISSION_DENIED: ERROR_PERMISSION_DENIED,
		ERROR_POSITION_UNAVAILABLE: ERROR_POSITION_UNAVAILABLE,
		ERROR_TIMEOUT: ERROR_TIMEOUT,
		ERROR_SERVICE_UNAVAILABLE: ERROR_SERVICE_UNAVAILABLE
	};
}() );