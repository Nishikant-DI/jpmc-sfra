'use strict';

var Logger = require('dw/system/Logger').getLogger('JPMC', 'jpmc_applepay');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var PaymentMgr = require('dw/order/PaymentMgr');
var Transaction = require('dw/system/Transaction');
var Status = require('dw/system/Status');

/**
 * Maps Apple Pay token paymentData to the JPMC encryptedPaymentBundle structure.
 * @param {Object} paymentData
 * @returns {Object}
 * @throws {Error}
 */
function buildEncryptedPaymentBundle(paymentData) {
    if (!paymentData || !paymentData.data || !paymentData.signature) {
        throw new Error('Invalid Apple Pay payment data');
    }
    if (!paymentData.header || !paymentData.header.ephemeralPublicKey
        || !paymentData.header.publicKeyHash || !paymentData.header.transactionId) {
        throw new Error('Invalid Apple Pay payment header');
    }

    var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');

    var bundle = {
        encryptedPayload: paymentData.data,
        signature: paymentData.signature,
        protocolVersion: paymentData.version || jpmcConstants.APPLE_PAY_PROTOCOL.EC_V1,
        encryptedPaymentHeader: {
            ephemeralPublicKey: paymentData.header.ephemeralPublicKey,
            publicKeyHash: paymentData.header.publicKeyHash,
            walletTransactionId: paymentData.header.transactionId
        }
    };

    if (paymentData.header.applicationData) {
        bundle.encryptedPaymentHeader.walletApplicationData = paymentData.header.applicationData;
    }

    return bundle;
}

/**
 * Persists JPMC authorization response data onto the payment instrument and
 * transaction, mirroring the CC and GPay patterns in jpmcTransactionHelpers
 * so BM extension capture/refund/void flows work for all payment methods.
 *
 * @param {dw.order.OrderPaymentInstrument} paymentInstrument
 * @param {Object} paymentResponse
 * @param {string} captureMethod
 * @returns {{ success: boolean, error: ?string }}
 */
function persistAuthorizationData(paymentInstrument, paymentResponse, captureMethod) {
    var PaymentTransaction = require('dw/order/PaymentTransaction');

    if (!paymentResponse || paymentResponse.responseStatus !== 'SUCCESS') {
        return {
            success: false,
            error: (paymentResponse && paymentResponse.responseMessage) || 'Payment failed'
        };
    }

    try {
        var isCaptureNow = (captureMethod === 'NOW');
        var txnHelpers = require('*/cartridge/scripts/helpers/jpmcTransactionHelpers');
        var jpmcConst = require('*/cartridge/scripts/helpers/jpmcConstants');

        Transaction.wrap(function () {
            var pt = paymentInstrument.getPaymentTransaction();

            pt.setType(isCaptureNow ? PaymentTransaction.TYPE_CAPTURE : PaymentTransaction.TYPE_AUTH);
            pt.setTransactionID(paymentResponse.transactionId || '');

            txnHelpers.persistAuthorizationData({
                paymentInstrument: paymentInstrument,
                transactionId: paymentResponse.transactionId,
                captureMethod: captureMethod,
                walletProvider: jpmcConst.APPLE_PAY_WALLET_PROVIDER
            });

            // Card metadata from JPMC response — system setters only
            if (paymentResponse.paymentMethodType && paymentResponse.paymentMethodType.card) {
                var cardInfo = paymentResponse.paymentMethodType.card;
                if (cardInfo.maskedAccountNumber) {
                    paymentInstrument.setCreditCardNumber(cardInfo.maskedAccountNumber);
                }
                if (cardInfo.cardType) {
                    paymentInstrument.setCreditCardType(cardInfo.cardType);
                }
            }
        });

        return { success: true, error: null };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Authorizes an Apple Pay order payment via the JPMC gateway.
 * Hook: dw.extensions.applepay.paymentAuthorized.authorizeOrderPayment
 *
 * @param {dw.order.Order} order
 * @param {Object} event
 * @returns {dw.system.Status|dw.extensions.applepay.ApplePayHookResult}
 */
function authorizeOrderPayment(order, event) {
    var ApplePayHookResult = require('dw/extensions/applepay/ApplePayHookResult');

    /**
     * Logs the error and returns an ApplePayHookResult with REASON_FAILURE.
     * @param {string} message
     * @returns {dw.extensions.applepay.ApplePayHookResult}
     */
    function errorResult(message) {
        Logger.error('Apple Pay auth failed - Order: {0} - {1}', order.getOrderNo(), message);
        return new ApplePayHookResult(
            new Status(Status.ERROR, ApplePayHookResult.REASON_FAILURE, message),
            null
        );
    }

    try {
        var paymentInstruments = order.getPaymentInstruments(PaymentInstrument.METHOD_DW_APPLE_PAY);
        if (paymentInstruments.empty) {
            return errorResult('Payment instrument not found');
        }
        var paymentInstrument = paymentInstruments[0];
        var paymentMethod = PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_DW_APPLE_PAY);
        var paymentProcessor = paymentMethod ? paymentMethod.getPaymentProcessor() : null;
        if (!paymentProcessor) {
            return errorResult('Payment processor not configured');
        }
        Transaction.wrap(function () {
            paymentInstrument.getPaymentTransaction().setPaymentProcessor(paymentProcessor);
        });
        var paymentToken = event.payment.token;
        if (!paymentToken || !paymentToken.paymentData) {
            return errorResult('Payment token missing');
        }
        var encryptedPaymentBundle;
        try {
            encryptedPaymentBundle = buildEncryptedPaymentBundle(paymentToken.paymentData);
        } catch (bundleEx) {
            return errorResult(bundleEx instanceof Error ? bundleEx.message : String(bundleEx));
        }
        var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
        var captureMethod = JPMCConfig.getCaptureMethod();

        var JPMCPayloadBuilder = require('*/cartridge/scripts/helpers/JPMCPayloadBuilder');
        var paymentPayload = JPMCPayloadBuilder.buildApplePayPaymentPayload({
            order: order,
            encryptedPaymentBundle: encryptedPaymentBundle,
            captureMethod: captureMethod
        });
        var UUID = require('dw/util/UUIDUtils');
        var config = JPMCConfig.getAccessTokenConfig();
        var requestId = ('AP-' + order.getOrderNo() + '-' + UUID.createUUID()).substring(0, 40);

        var JPMCServiceHelper = require('*/cartridge/scripts/services/JPMCServiceHelper');
        var serviceResult = JPMCServiceHelper.callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCPaymentService',
            method: 'POST',
            data: paymentPayload,
            headers: {
                'merchant-id': config.merchantId,
                'request-id': requestId
            }
        });

        if (!serviceResult.success) {
            return errorResult('Payment service error');
        }
        var persistResult = persistAuthorizationData(paymentInstrument, serviceResult.data, captureMethod);
        if (!persistResult.success) {
            return errorResult(persistResult.error || 'Failed to persist authorization data');
        }

        Logger.info('Apple Pay authorized - Order: {0}', order.getOrderNo());
        return new Status(Status.OK);

    } catch (e) {
        return errorResult(e instanceof Error ? e.message : String(e));
    }
}

exports.authorizeOrderPayment = authorizeOrderPayment;
