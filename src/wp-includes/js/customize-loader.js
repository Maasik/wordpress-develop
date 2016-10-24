/* global _wpCustomizeLoaderSettings, confirm */
/*
 * Expose a public API that allows the customizer to be
 * loaded on any page.
 */
window.wp = window.wp || {};

(function( exports, $ ){
	var api = wp.customize,
		Loader;

	$.extend( $.support, {
		history: !! ( window.history && history.pushState ),
		hashchange: ('onhashchange' in window) && (document.documentMode === undefined || document.documentMode > 7)
	});

	/**
	 * Allows the Customizer to be overlayed on any page.
	 *
	 * By default, any element in the body with the load-customize class will open
	 * an iframe overlay with the URL specified.
	 *
	 *     e.g. <a class="load-customize" href="<?php echo wp_customize_url(); ?>">Open Customizer</a>
	 *
	 * @augments wp.customize.Events
	 */
	Loader = $.extend( {}, api.Events, {

		changesetUuid: null,

		/**
		 * Setup the Loader; triggered on document#ready.
		 */
		initialize: function() {
			this.body = $( document.body );

			// Ensure the loader is supported.
			// Check for settings, postMessage support, and whether we require CORS support.
			if ( ! Loader.settings || ! $.support.postMessage || ( ! $.support.cors && Loader.settings.isCrossDomain ) ) {
				return;
			}

			this.window  = $( window );
			this.element = $( '<div id="customize-container" />' ).appendTo( this.body );

			// Bind events for opening and closing the overlay.
			this.bind( 'open', this.overlay.show );
			this.bind( 'close', this.overlay.hide );

			// Any element in the body with the `load-customize` class opens
			// the Customizer.
			$('#wpbody').on( 'click', '.load-customize', function( event ) {
				event.preventDefault();

				// Store a reference to the link that opened the Customizer.
				Loader.link = $(this);
				// Load the theme.
				Loader.open( Loader.link.attr('href') );
			});

			// Add navigation listeners.
			if ( $.support.history ) {
				this.window.on( 'popstate', Loader.popstate );
			}

			if ( $.support.hashchange ) {
				this.window.on( 'hashchange', Loader.hashchange );
				this.window.triggerHandler( 'hashchange' );
			}
		},

		popstate: function( event ) {
			var state = event.originalEvent.state, urlParser, queryParams;

			urlParser = document.createElement( 'a' );
			urlParser.href = location.href;
			queryParams = api.utils.parseQueryString( urlParser.search.substr( 1 ) );

			if ( state && state.customize ) {
				if ( ! Loader.active ) {
					Loader.open( state.customize );
				} else {
					Loader.messenger.send( 'history-change', {
						queryParams: queryParams
					} );
				}

				// Make sure the current UUID is persisted.
				if ( queryParams.changeset_uuid !== Loader.changesetUuid ) {
					queryParams.changeset_uuid = Loader.changesetUuid;
					urlParser.search = $.param( queryParams ).replace( /%5B/g, '[' ).replace( /%5D/g, ']' ).replace( /%2F/g, '/' ).replace( /%3A/g, ':' );
					history.replaceState( state, '', urlParser.href );
				}
			} else if ( Loader.active ) {
				Loader.close();
			}
		},

		hashchange: function() {
			var hash = window.location.toString().split('#')[1];

			if ( hash && 0 === hash.indexOf( 'wp_customize=on' ) ) {
				Loader.open( Loader.settings.url + '?' + hash );
			}

			if ( ! hash && ! $.support.history ) {
				Loader.close();
			}
		},

		beforeunload: function () {
			if ( ! Loader.saved() ) {
				return Loader.settings.l10n.saveAlert;
			}
		},

		onHistoryChange: function onHistoryChange( data ) {
			var urlParser, state;
			if ( ! data.queryParams ) {
				return;
			}
			urlParser = document.createElement( 'a' );
			urlParser.href = location.href;
			if ( Loader.changesetUuid ) {
				data.queryParams.changeset_uuid = Loader.changesetUuid;
			}
			urlParser.search = $.param( data.queryParams ).replace( /%5B/g, '[' ).replace( /%5D/g, ']' ).replace( /%2F/g, '/' ).replace( /%3A/g, ':' );

			state = {
				customize: urlParser.href
			};
			if ( 'pushState' === data.method ) {
				history.pushState( state, '', urlParser.href );
			} else if ( 'replaceState' === data.method ) {
				history.pushState( state, '', urlParser.href );
			} else {
				location.href = urlParser.href;
			}
		},

		/**
		 * Open the Customizer overlay for a specific URL.
		 *
		 * @param {string} src URL to load in the Customizer.
		 */
		open: function( src ) {

			if ( this.active ) {
				return;
			}

			// Load the full page on mobile devices.
			if ( Loader.settings.browser.mobile ) {
				return window.location = src;
			}

			// Store the document title prior to opening the Live Preview
			this.originalDocumentTitle = document.title;

			this.active = true;
			this.body.addClass('customize-loading');

			/*
			 * Track the dirtiness state (whether the drafted changes have been published)
			 * of the Customizer in the iframe. This is used to decide whether to display
			 * an AYS alert if the user tries to close the window before saving changes.
			 */
			this.saved = new api.Value( true );

			this.iframe = $( '<iframe />', { 'src': src, 'title': Loader.settings.l10n.mainIframeTitle } ).appendTo( this.element );
			this.iframe.one( 'load', this.loaded );

			// Create a postMessage connection with the iframe.
			this.messenger = new api.Messenger({
				url: src,
				channel: 'loader',
				targetWindow: this.iframe[0].contentWindow
			});

			// Wait for the connection from the iframe before sending any postMessage events.
			this.messenger.bind( 'ready', function() {
				Loader.messenger.send( 'back' );
			});

			this.messenger.bind( 'changeset-uuid', function( changesetUuid ) {
				Loader.changesetUuid = changesetUuid;
			} );

			this.messenger.bind( 'close', function() {
				var onPopState;
				if ( $.support.history ) {
					onPopState = function( event ) {
						if ( null !== event.originalEvent.state ) {
							history.back();
						} else {
							$( window ).off( 'popstate.customize-loader', onPopState );
						}
					};
					$( window ).on( 'popstate.customize-loader', onPopState );
					history.back();
				} else if ( $.support.hashchange ) {
					window.location.hash = '';
				} else {
					Loader.close();
				}
			} );

			// Prompt AYS dialog when navigating away
			$( window ).on( 'beforeunload', this.beforeunload );

			this.messenger.bind( 'saved', function () {
				Loader.saved( true );
			} );
			this.messenger.bind( 'change', function () {
				Loader.saved( false );
			} );

			this.messenger.bind( 'title', function( newTitle ){
				window.document.title = newTitle;
			});

			this.messenger.bind( 'history-change', this.onHistoryChange );

			this.pushState( src );

			this.trigger( 'open' );
		},

		pushState: function ( src ) {
			var hash = src.split( '?' )[1];

			// Ensure we don't call pushState if the user hit the forward button.
			if ( $.support.history && window.location.href !== src ) {
				history.pushState( { customize: src }, '', src );
			} else if ( ! $.support.history && $.support.hashchange && hash ) {
				window.location.hash = 'wp_customize=on&' + hash;
			}

			// @todo Only trigger open if not active.
			if ( ! this.active ) {
				this.trigger( 'open' );
			}
		},

		/**
		 * Callback after the Customizer has been opened.
		 */
		opened: function() {
			Loader.body.addClass( 'customize-active full-overlay-active' ).attr( 'aria-busy', 'true' );
		},

		/**
		 * Close the Customizer overlay.
		 */
		close: function() {
			if ( ! this.active ) {
				return;
			}

			// Display AYS dialog if Customizer is dirty
			if ( ! this.saved() && ! confirm( Loader.settings.l10n.saveAlert ) ) {
				// Go forward since Customizer is exited by history.back()
				history.forward();
				return;
			}

			this.active = false;

			this.trigger( 'close' );

			// Restore document title prior to opening the Live Preview
			if ( this.originalDocumentTitle ) {
				document.title = this.originalDocumentTitle;
			}
		},

		/**
		 * Callback after the Customizer has been closed.
		 */
		closed: function() {
			if ( Loader.iframe ) {
				Loader.iframe.remove();
			}
			if ( Loader.messenger ) {
				Loader.messenger.destroy();
			}
			Loader.iframe    = null;
			Loader.messenger = null;
			Loader.saved     = null;
			Loader.body.removeClass( 'customize-active full-overlay-active' ).removeClass( 'customize-loading' );
			$( window ).off( 'beforeunload', Loader.beforeunload );
			/*
			 * Return focus to the link that opened the Customizer overlay after
			 * the body element visibility is restored.
			 */
			if ( Loader.link ) {
				Loader.link.focus();
			}
		},

		/**
		 * Callback for the `load` event on the Customizer iframe.
		 */
		loaded: function() {
			Loader.body.removeClass( 'customize-loading' ).attr( 'aria-busy', 'false' );
		},

		/**
		 * Overlay hide/show utility methods.
		 */
		overlay: {
			show: function() {
				this.element.fadeIn( 200, Loader.opened );
			},

			hide: function() {
				this.element.fadeOut( 200, Loader.closed );
			}
		}
	});

	// Bootstrap the Loader on document#ready.
	$( function() {
		Loader.settings = _wpCustomizeLoaderSettings;
		Loader.initialize();
	});

	// Expose the API publicly on window.wp.customize.Loader
	api.Loader = Loader;
})( wp, jQuery );
