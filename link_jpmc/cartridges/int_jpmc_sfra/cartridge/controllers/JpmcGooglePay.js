'use strict';

var server = require('server');
var csrfProtection = require('*/cartridge/scripts/middleware/csrf');
var consentTracking = require('*/cartridge/scripts/middleware/consentTracking');

/**
 * Returns Google Pay configuration and current basket total.
 * All config values come from Site Preferences — no hardcoded defaults.
 */
server.get('GetConfig',
    server.middleware.https,
    consentTracking.consent,
    function (req, res, next) {
        var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
        var BasketMgr = require('dw/order/BasketMgr');

        var gpayConfig = JPMCConfig.getGooglePayConfig();

        if (!gpayConfig.enabled) {
            res.json({ error: false, enabled: false });
            return next();
        }

        var currentBasket = BasketMgr.getCurrentBasket();
        var totalPrice = '0.00';
        var currencyCode = '';

        if (currentBasket) {
            var totalGrossPrice = currentBasket.getTotalGrossPrice();
            if (totalGrossPrice.available) {
                totalPrice = totalGrossPrice.getValue().toFixed(2);
                currencyCode = totalGrossPrice.getCurrencyCode();
            }
        }

        if (!currencyCode || totalPrice === '0.00') {
            res.json({ error: true, enabled: false });
            return next();
        }

        res.json({
            error: false,
            enabled: true,
            environment: gpayConfig.environment,
            gateway: gpayConfig.gateway,
            gatewayMerchantId: gpayConfig.gatewayMerchantId,
            googlePayMerchantId: gpayConfig.googlePayMerchantId,
            merchantName: gpayConfig.merchantName,
            allowedCardNetworks: gpayConfig.allowedCardNetworks,
            allowedAuthMethods: gpayConfig.allowedAuthMethods,
            totalPrice: totalPrice,
            currencyCode: currencyCode
        });

        return next();
    }
);

/**
 * Receives the Google Pay token from the client and stores in session.privacy.
 * Full structural validation is performed in the Handle hook.
 */
server.post('StoreToken',
    server.middleware.https,
    csrfProtection.validateAjaxRequest,
    function (req, res, next) {
        var Logger = require('dw/system/Logger').getLogger('JPMC', 'googlepay');

        var token = req.form.token;
        if (!token) {
            res.json({ error: true });
            return next();
        }

        // Basic JSON validation only — structural validation happens in Handle hook
        try {
            JSON.parse(token);
        } catch (e) {
            Logger.error('StoreToken: Invalid token JSON');
            res.json({ error: true });
            return next();
        }

        session.privacy.jpmcGooglePayToken = token;

        res.json({ error: false });
        return next();
    }
);

/**
 * Clears Google Pay token from session. Called on payment method switch or navigation.
 */
server.post('ClearToken',
    server.middleware.https,
    csrfProtection.validateAjaxRequest,
    function (req, res, next) {
        session.privacy.jpmcGooglePayToken = null;

        res.json({ error: false });
        return next();
    }
);

module.exports = server.exports();
