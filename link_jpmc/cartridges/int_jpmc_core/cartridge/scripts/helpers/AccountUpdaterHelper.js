'use strict';

/**
 * @module scripts/helpers/AccountUpdaterHelper
 */

var Logger = require('dw/system/Logger').getLogger('AccountUpdater', 'helper');
var Transaction = require('dw/system/Transaction');

var RTAU_NO_UPDATE_CODES = {
    MATCH_NO_UPDATE: true,
    NO_MATCH_PARTICIPATING_BIN: true,
    NO_MATCH_NON_PARTICIPATING_BIN: true
};

/**
 * extractRtauNewToken
 * @param {Object} responseData - response data
 * @param {Object} auBlock - account updater block
 * @returns {string|null} token
 */
function extractRtauNewToken(responseData, auBlock) {
    if (auBlock && auBlock.accountNumber) {
        return auBlock.accountNumber;
    }

    var card = responseData.paymentMethodType && responseData.paymentMethodType.card;
    if (!card || !Array.isArray(card.paymentTokens)) {
        return null;
    }

    for (var i = 0; i < card.paymentTokens.length; i++) {
        var token = card.paymentTokens[i];
        if (token && token.tokenNumber && token.responseStatus === 'SUCCESS') {
            return token.tokenNumber;
        }
    }
    return null;
}

/**
 * @param {dw.order.PaymentInstrument} paymentInstrument - payment instrument to update
 * @param {Object} responseData - RTAU response from JPMC
 * @returns {Object} update summary (updated, action)
 */
function handleRTAUResponse(paymentInstrument, responseData) {
    var summary = { updated: false, action: null };

    if (!paymentInstrument || !responseData) {
        return summary;
    }

    try {
        var card = responseData.paymentMethodType && responseData.paymentMethodType.card;
        var au = responseData.accountUpdater || (card && card.accountUpdater);
        if (!au) {
            return summary;
        }

        var responseCode = au.accountUpdaterResponse || null;
        summary.action = responseCode;

        if (!responseCode || RTAU_NO_UPDATE_CODES[responseCode]) {
            return summary;
        }

        var newToken = extractRtauNewToken(responseData, au);
        var expiry = au.newAccountExpiry || au.expiry || null;
        var newMonth = expiry && parseInt(String(expiry.month), 10);
        var newYear = expiry && parseInt(String(expiry.year), 10);

        if (!newToken && !(newMonth && newYear)) {
            return summary;
        }

        Transaction.wrap(function () {
            if (newToken) {
                paymentInstrument.setCreditCardToken(newToken);
            }
            if (newMonth && newYear) {
                paymentInstrument.setCreditCardExpirationMonth(newMonth);
                paymentInstrument.setCreditCardExpirationYear(newYear);
            }
        });

        summary.updated = true;
    } catch (e) {
        Logger.error('handleRTAUResponse: {0}', e.message || String(e));
    }

    return summary;
}

module.exports = {
    handleRTAUResponse: handleRTAUResponse
};
