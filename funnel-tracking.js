/* ============================================================
   FUNNEL CONVERSION TRACKING — Traffic Ticket Mama

   Fires Website conversion events at each step of the ticket flow.
   Add Traffic Ticket Mama's own Google Ads conversion IDs below
   when its Ads account is ready. Until then this is a safe no-op.

   Example entry:
     { id: 'AW-XXXXXXXXXX',
       scanStarted: 'LABEL_SCAN_STARTED',
       scanCompleted: 'LABEL_SCAN_COMPLETED',
       caseCreated: 'LABEL_CASE_CREATED' }

   Each event fires once per account (its own label).
   Scan Started/Completed trigger on POST /api/assistant/extract
   (request / success); Case Created on POST /api/cases success,
   with the tracking code as transaction_id for deduping.
   ============================================================ */
(function () {
  'use strict';
  if (window.__ttfFunnelTracked) return;
  window.__ttfFunnelTracked = true;

  // Traffic Ticket Mama Google Ads destinations.
  // TODO: add Fairy's own AW ID + conversion labels here.
  var DESTINATIONS = [
  ];

  function gtagFn() {
    if (typeof window.gtag === 'function') return window.gtag;
    window.dataLayer = window.dataLayer || [];
    return function () { window.dataLayer.push(arguments); };
  }

  function fireConversion(which, extra) {
    try {
      var g = gtagFn();
      for (var i = 0; i < DESTINATIONS.length; i++) {
        var d = DESTINATIONS[i];
        var label = d[which];
        if (!label) continue;
        var params = { send_to: d.id + '/' + label, transport_type: 'beacon' };
        if (extra) {
          for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) params[k] = extra[k];
          }
        }
        g('event', 'conversion', params);
      }
    } catch (e) { /* tracking must never break the flow */ }
  }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function methodOf(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (input && typeof input !== 'string' && input.method) return String(input.method).toUpperCase();
    return 'GET';
  }

  var origFetch = window.fetch;
  if (typeof origFetch !== 'function') return;

  window.fetch = function (input, init) {
    var url = urlOf(input);
    var method = methodOf(input, init);
    var isExtract = url.indexOf('/api/assistant/extract') !== -1 && method === 'POST';
    var isCaseCreate = url.indexOf('/api/cases') !== -1 && method === 'POST' &&
                       url.indexOf('/api/cases/') === -1;

    if (isExtract) fireConversion('scanStarted');

    var promise;
    try {
      promise = origFetch.apply(this, arguments);
    } catch (e) {
      throw e;
    }
    if (!isExtract && !isCaseCreate) return promise;

    return promise.then(function (resp) {
      try {
        if (!resp) return resp;
        if (isExtract && resp.ok) {
          fireConversion('scanCompleted');
        } else if (isCaseCreate && resp.ok) {
          try {
            resp.clone().json().then(function (d) {
              var code = d && (d.trackingCode || d.tracking_code || d.code);
              fireConversion('caseCreated', code ? { transaction_id: String(code) } : null);
            }, function () {
              fireConversion('caseCreated');
            });
          } catch (e) {
            fireConversion('caseCreated');
          }
        }
      } catch (e) { /* never break the app */ }
      return resp;
    });
  };
})();
