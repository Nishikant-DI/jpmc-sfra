/**
 * JPMC Payment Operations — fraud check and verification functions.
 * Re-exported by JPMCPaymentHelper.js for backward compatibility.
 * @module scripts/helpers/JPMCPaymentOperations
 */

'use strict';

var Logger = require('dw/system/Logger').getLogger('JPMC', 'payment-ops');
var Transaction = require('dw/system/Transaction');
var UUID = require('dw/util/UUIDUtils');

/**
 * Performs fraud check for a basket or order.
 * @param {dw.order.Basket|dw.order.Order} basketOrOrder
 * @param {Object} options
 * @returns {Object}
 */
function performFraudCheck(basketOrOrder, options) {
    var JPMCServiceHelper = require('*/cartridge/scripts/services/JPMCServiceHelper');
    var JPMCPayloadBuilder = require('*/cartridge/scripts/helpers/JPMCPayloadBuilder');
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');

    var result = {
        success: false,
        fraudCheckId: null,
        riskLevel: null,
        fraudScore: null,
        error: null,
        data: null
    };

    if (!basketOrOrder) {
        result.error = 'Basket or order is required';
        Logger.error('performFraudCheck: {0}', result.error);
        return result;
    }

    try {
        var orderNo = options && options.orderNo ? options.orderNo : null;
        var hasOrderNo = !!(orderNo);

        var paymentInstrument;
        if (options && options.paymentInstrument) {
            paymentInstrument = options.paymentInstrument;
        } else {
            var paymentInstruments = basketOrOrder.getPaymentInstruments();
            if (paymentInstruments.length === 0) {
                result.error = 'No payment instruments found';
                Logger.error('performFraudCheck: {0}', result.error);
                return result;
            }
            paymentInstrument = paymentInstruments[0];
        }

        var config = JPMCConfig.getConfig();
        if (!config || !config.merchantId) {
            result.error = 'Merchant ID not configured';
            Logger.error('performFraudCheck: {0}', result.error);
            return result;
        }

        var fraudCheckPayload = JPMCPayloadBuilder.buildFraudCheckPayload({
            basketOrOrder: basketOrOrder,
            paymentInstrument: paymentInstrument,
            deviceIPAddress: options ? options.deviceIPAddress : undefined,
            fraudScore: options ? options.fraudScore : null,
            accountNumberType: options ? options.accountNumberType : undefined
        });

        var requestId = 'fraud-' + UUID.createUUID();
        var headers = {
            'merchant-id': config.merchantId,
            'request-id': requestId
        };

        if (config.platformId) {
            headers['platform-id'] = config.platformId;
        }

        var serviceResult = JPMCServiceHelper.callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCFraudCheck',
            method: 'POST',
            data: fraudCheckPayload,
            headers: headers
        });

        if (serviceResult.success && serviceResult.data) {
            var fraudData = serviceResult.data;

            if (fraudData.responseStatus === 'SUCCESS' || fraudData.responseStatus === 'APPROVED') {
                result.success = true;
                result.transactionId = fraudData.transactionId || null;
                result.riskElement = fraudData.riskElement || null;
                result.riskDecision = fraudData.riskDecision || null;
                result.data = fraudData;

                Logger.info('performFraudCheck: SUCCESS - TransactionId={0}', result.transactionId);

                if (hasOrderNo) {
                    Transaction.wrap(function () {
                        if (result.transactionId) {
                            basketOrOrder.custom.jpmcFraudTransactionId = result.transactionId;
                        }
                        if (result.riskElement) {
                            basketOrOrder.custom.jpmcFraudRiskElement = result.riskElement ? JSON.stringify(result.riskElement) : '';
                        }
                        if (result.riskDecision !== null) {
                            basketOrOrder.custom.jpmcFraudRiskDecision = result.riskDecision ? JSON.stringify(result.riskDecision) : '';
                        }
                        basketOrOrder.custom.jpmcFraudCheckDate = new Date();

                        if (options.fraudScore && options.fraudScore.sessionId) {
                            basketOrOrder.custom.kountSessionId = options.fraudScore.sessionId;
                        }

                        if (fraudData) {
                            try {
                                basketOrOrder.custom.jpmcFraudResponse = JSON.stringify(fraudData);
                            } catch (jsonError) {
                                // ignore serialization errors — fraud check result already stored
                            }
                        }
                    });
                }

            } else {
                result.error = fraudData.responseMessage || 'Fraud check failed with status: ' + fraudData.responseStatus;
                result.data = fraudData;
                result.riskLevel = fraudData.riskLevel || 'UNKNOWN';

                Logger.warn('performFraudCheck: FLAGGED - Status: {0}, Code: {1}, RiskLevel: {2}, Message: {3}',
                    fraudData.responseStatus, fraudData.responseCode, result.riskLevel, fraudData.responseMessage);

                if (hasOrderNo) {
                    Transaction.wrap(function () {
                        if (fraudData) {
                            try {
                                basketOrOrder.custom.jpmcFraudResponse = JSON.stringify(fraudData);
                                basketOrOrder.custom.jpmcFraudCheckDate = new Date();
                            } catch (jsonError) {
                                // ignore serialization errors
                            }
                        }
                    });
                }
            }
        } else {
            result.error = serviceResult.error || 'Fraud check service call failed';
            Logger.error('performFraudCheck: SERVICE ERROR - Error: {0}', result.error);

            if (hasOrderNo && serviceResult.data) {
                Transaction.wrap(function () {
                    try {
                        basketOrOrder.custom.jpmcFraudResponse = JSON.stringify(serviceResult.data);
                        basketOrOrder.custom.jpmcFraudCheckDate = new Date();
                    } catch (jsonError) {
                        // ignore serialization errors
                    }
                });
            }
        }

    } catch (e) {
        result.error = e.message || String(e);
        Logger.error('performFraudCheck: EXCEPTION - Error: {0}', result.error);
    }

    return result;
}

/**
 * Performs fraud check for card save in My Account (minimal payload).
 * @param {Object} cardData
 * @param {Object} options
 * @returns {Object}
 */
function performFraudCheckForCardSave(cardData, options) {
    var JPMCServiceHelper = require('*/cartridge/scripts/services/JPMCServiceHelper');
    var JPMCPayloadBuilder = require('*/cartridge/scripts/helpers/JPMCPayloadBuilder');
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var Site = require('dw/system/Site');
    var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');

    var result = {
        success: false,
        riskDecision: null,
        riskElement: null,
        error: null,
        data: null
    };

    try {
        if (!cardData || !cardData.accountNumber) {
            result.error = 'Card data is required for fraud check';
            Logger.error('performFraudCheckForCardSave: {0}', result.error);
            return result;
        }

        var config = JPMCConfig.getConfig();
        if (!config || !config.merchantId) {
            result.error = 'Merchant ID not configured';
            Logger.error('performFraudCheckForCardSave: {0}', result.error);
            return result;
        }

        var opts = options || {};

        var customerEmail = (customer && customer.authenticated && customer.profile)
            ? customer.profile.email
            : null;

        var payload = JPMCPayloadBuilder.buildFraudCheckForCardSavePayload({
            cardData: cardData,
            currency: (session && session.currency && session.currency.currencyCode)
                ? session.currency.currencyCode
                : Site.getCurrent().getDefaultCurrency(),
            accountNumberType: opts.accountNumberType,
            deviceIPAddress: request.getHttpRemoteAddress() || jpmcConstants.FALLBACK_IP_ADDRESS,
            customerEmail: customerEmail,
            browserInformation: request.httpUserAgent || jpmcConstants.FALLBACK_USER_AGENT,
            kountSessionId: opts.kountSessionId
        });

        var requestId = 'fraud-' + UUID.createUUID().toString();

        var headers = {
            'merchant-id': config.merchantId,
            'request-id': requestId
        };

        if (config.platformId) {
            headers['platform-id'] = config.platformId;
        }

        var serviceResult = JPMCServiceHelper.callWithTokenGeneration({            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCFraudCheck',
            method: 'POST',
            data: payload,
            headers: headers
        });

        if (serviceResult.success && serviceResult.data) {
            var fraudData = serviceResult.data;
            result.data = fraudData;

            if (fraudData.responseStatus === 'SUCCESS' || fraudData.responseStatus === 'APPROVED') {
                result.success = true;
                result.riskDecision = fraudData.riskDecision || null;
                result.riskElement = fraudData.riskElement || 'LOW';

                Logger.info('performFraudCheckForCardSave: SUCCESS - RiskLevel: {0}', result.riskElement);
            } else {
                result.error = fraudData.responseMessage || 'Fraud check failed with status: ' + fraudData.responseStatus;
                result.riskDecision = fraudData.riskDecision || null;
                result.riskElement = fraudData.riskElement || 'UNKNOWN';

                Logger.warn('performFraudCheckForCardSave: FLAGGED - Status: {0}, Code: {1}',
                    fraudData.responseStatus, fraudData.responseCode);
            }
        } else {
            result.error = serviceResult.error || 'Fraud check service call failed';
            Logger.error('performFraudCheckForCardSave: SERVICE ERROR - Error: {0}', result.error);
        }

    } catch (e) {
        result.error = e.message || String(e);
        Logger.error('performFraudCheckForCardSave: EXCEPTION - Error: {0}', result.error);
    }

    return result;
}

/**
 * Verifies card details without placing a funds hold.
 * @param {Object} cardData
 * @param {Object} [options]
 * @returns {Object}
 */
function verifyPaymentInstrument(cardData, options) {
    var JPMCServiceHelper = require('*/cartridge/scripts/services/JPMCServiceHelper');
    var JPMCPayloadBuilder = require('*/cartridge/scripts/helpers/JPMCPayloadBuilder');
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var Site = require('dw/system/Site');

    var result = {
        success: false,
        verificationId: null,
        responseStatus: null,
        error: null,
        data: null
    };

    if (!cardData || !cardData.accountNumber) {
        result.error = 'Card account number is required';
        Logger.error('verifyPaymentInstrument: {0}', result.error);
        return result;
    }

    if (!cardData.expirationMonth || !cardData.expirationYear) {
        result.error = 'Card expiration month and year are required';
        Logger.error('verifyPaymentInstrument: {0}', result.error);
        return result;
    }

    try {
        var config = JPMCConfig.getConfig();
        if (!config || !config.merchantId) {
            result.error = 'Merchant ID not configured';
            Logger.error('verifyPaymentInstrument: {0}', result.error);
            return result;
        }

        var opts = options || {};
        var currency = opts.currency || Site.getCurrent().getDefaultCurrency();

        var payload = JPMCPayloadBuilder.buildVerificationPayload({
            cardData: cardData,
            currency: currency,
            accountNumberType: opts.accountNumberType || 'SAFETECH_PAGE_ENCRYPTION',
            billingAddress: opts.billingAddress,
            email: opts.email,
            authentication: opts.authentication,
            walletProvider: opts.walletProvider,
            accountOnFile: opts.accountOnFile,
            initiatorType: opts.initiatorType
        });

        var requestId = 'verify-' + UUID.createUUID().toString();

        var headers = {
            'merchant-id': config.merchantId,
            'request-id': requestId
        };

        if (config.platformId) {
            headers['platform-id'] = config.platformId;
        }

        var serviceResult = JPMCServiceHelper.callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCVerification',
            method: 'POST',
            data: payload,
            headers: headers
        });

        if (serviceResult.success && serviceResult.data) {
            var verificationData = serviceResult.data;

            if (verificationData.responseStatus === 'SUCCESS' || verificationData.responseStatus === 'APPROVED') {
                result.success = true;
                result.verificationId = verificationData.transactionId || null;
                result.responseStatus = verificationData.responseStatus;
                result.data = verificationData;
            } else {
                result.error = verificationData.responseMessage || 'Verification failed: ' + verificationData.responseStatus;
                result.responseStatus = verificationData.responseStatus;
                result.data = verificationData;
                Logger.warn('verifyPaymentInstrument: FAILED - Status: {0}, Code: {1}',
                    verificationData.responseStatus, verificationData.responseCode);
            }
        } else {
            result.error = serviceResult.error || 'Verification service call failed';
            Logger.error('verifyPaymentInstrument: SERVICE ERROR - {0}', result.error);
        }

    } catch (e) {
        result.error = e.message || String(e);
        Logger.error('verifyPaymentInstrument: EXCEPTION - {0}', result.error);
    }

    return result;
}

module.exports = {
    performFraudCheck: performFraudCheck,
    performFraudCheckForCardSave: performFraudCheckForCardSave,
    verifyPaymentInstrument: verifyPaymentInstrument
};
