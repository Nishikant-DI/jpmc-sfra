'use strict';

var Transaction = require('dw/system/Transaction');
var OrderMgr = require('dw/order/OrderMgr');
var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');

/**
 * @param {dw.order.PaymentInstrument} paymentInstrument
 * @param {dw.order.PaymentTransaction} paymentTransaction
 * @returns {string|null}
 */
function resolveJpmcTransactionId(paymentInstrument, paymentTransaction) {
    if (paymentTransaction && paymentTransaction.custom && paymentTransaction.custom.jpmcAuthorizationId) {
        return paymentTransaction.custom.jpmcAuthorizationId;
    }
    if (paymentInstrument && paymentInstrument.custom && paymentInstrument.custom.jpmcTransactionId) {
        return paymentInstrument.custom.jpmcTransactionId;
    }
    if (paymentTransaction && paymentTransaction.getTransactionID()) {
        return paymentTransaction.getTransactionID();
    }
    return null;
}

/**
 * @param {Object} opts
 */
function persistAuthorizationData(opts) {
    var paymentInstrument = opts.paymentInstrument;
    var transactionId = opts.transactionId;
    var captureMethod = opts.captureMethod;
    var walletProvider = opts.walletProvider;
    var pt = paymentInstrument.paymentTransaction || paymentInstrument.getPaymentTransaction();

    if (paymentInstrument.custom) {
        paymentInstrument.custom.jpmcTransactionId = transactionId;
        if (walletProvider) {
            paymentInstrument.custom.jpmcWalletProvider = walletProvider;
        }
    }

    if (pt && pt.custom) {
        var custom = pt.custom;
        custom.jpmcAuthorizationId = transactionId;
        custom.jpmcCaptureMethod = captureMethod;
        custom.jpmcAuthTimestamp = new Date().toISOString();

        if (captureMethod === 'NOW') {
            custom.jpmcPaymentStatus = 'AC';
            custom.jpmcCapturedAmount = pt.amount.value;
            custom.jpmcRemainingAuthAmount = 0;
            custom.jpmcRemainingRefundableAmount = pt.amount.value;
        } else {
            custom.jpmcPaymentStatus = 'A';
            custom.jpmcRemainingAuthAmount = pt.amount.value;
            custom.jpmcRemainingRefundableAmount = 0;
        }
    }
}

/**
 * Authorizes a credit card payment via JPMC
 * @param {string} orderNumber
 * @param {dw.order.PaymentInstrument} paymentInstrument
 * @param {dw.order.PaymentProcessor} paymentProcessor
 * @returns {Object}
 */
function authorize(orderNumber, paymentInstrument, paymentProcessor) {
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
    var Resource = require('dw/web/Resource');
    var serverErrors = [];

    var order = OrderMgr.getOrder(orderNumber);

    try {
        if (!order) {
            return { error: true, serverErrors: [Resource.msg('error.payment.order.not.found', 'checkout', null)] };
        }

        var resolvedConfig = JPMCMerchantResolver.resolve();
        var creditCardToken = paymentInstrument.getCreditCardToken();
        var isStoredCard = !!(creditCardToken);
        var billingForm = session.forms.billing;
        var creditCardForm = billingForm && billingForm.creditCardFields;
        var isSaveCardChecked = creditCardForm && creditCardForm.saveCard && creditCardForm.saveCard.checked;
        var accountOnFile;
        if (isStoredCard) {
            accountOnFile = 'STORED';
        } else if (isSaveCardChecked) {
            accountOnFile = 'TO_BE_STORED';
        } else {
            accountOnFile = 'NOT_STORED';
        }
        var captureMethod = resolvedConfig.captureMethod || JPMCConfig.getCaptureMethod();
        var HookMgr = require('dw/system/HookMgr');
        var JPMCPaymentHelper = require('*/cartridge/scripts/helpers/JPMCPaymentHelper');
        
        var fraudRuleActionFromVerify = null;
        var fraudRuleActionFromAuth = null;
        if (paymentInstrument.custom && paymentInstrument.custom.jpmcFraudRuleAction) {
            fraudRuleActionFromVerify = paymentInstrument.custom.jpmcFraudRuleAction;
        }
        if ((resolvedConfig ? resolvedConfig.enableFraudCheckAtAuth === true : JPMCConfig.isFraudCheckEnabledAtAuth()) && HookMgr.hasHook('app.safetech.fraud.detection')) {
            var accountNumberType = isStoredCard
                ? (resolvedConfig ? resolvedConfig.tokenizationType : JPMCConfig.getConfig().accountNumberType)
                : jpmcConstants.ACCOUNT_NUMBER_TYPE_PIE;
            
            var fraudDetectionResult = HookMgr.callHook(
                'app.safetech.fraud.detection',
                'fraudDetection',
                order,
                paymentInstrument,
                { 
                    accountNumberType: accountNumberType,
                    orderNo: orderNumber
                }
            );
            if (fraudDetectionResult.fraudRuleAction) {
                fraudRuleActionFromAuth = fraudDetectionResult.fraudRuleAction;
            }
            if (fraudDetectionResult.status === 'fail') {
                return {
                    error: true,
                    serverErrors: [Resource.msg('error.fraud.declined', 'checkout', null)]
                };
            }
        }

        var orderNoteAdded = false;
        var originalCaptureMethod = captureMethod;
        
        var isFraudFlagged = (fraudRuleActionFromVerify === 'E' || fraudRuleActionFromVerify === 'R') ||
                             (fraudRuleActionFromAuth === 'E' || fraudRuleActionFromAuth === 'R');
        
        if (isFraudFlagged) {
            captureMethod = 'MANUAL';
            
            Transaction.wrap(function () {
                var existingNotes = order.getNotes();
                var noteExists = false;
                for (var i = 0; i < existingNotes.length; i++) {
                    if (existingNotes[i].subject === jpmcConstants.FRAUD_REVIEW_NOTE_SUBJECT || existingNotes[i].text.indexOf('Order marked for review') !== -1) {
                        noteExists = true;
                        break;
                    }
                }
                
                if (!noteExists) {
                    order.addNote(jpmcConstants.FRAUD_REVIEW_NOTE_SUBJECT, 'Order marked for review');
                    orderNoteAdded = true;
                }
            });
        }

        var ipAddress = null;
        try {
            ipAddress = (typeof request !== 'undefined' && request) ? request.getHttpRemoteAddress() : null;
        } catch (ipErr) {
        }

        var paymentResult = JPMCPaymentHelper.createPayment(order, {
            paymentInstrument: paymentInstrument,
            accountNumberType: isStoredCard
                ? (resolvedConfig ? resolvedConfig.tokenizationType : JPMCConfig.getConfig().accountNumberType)
                : jpmcConstants.ACCOUNT_NUMBER_TYPE_PIE,
            captureMethod: captureMethod,
            initiatorType: 'CARDHOLDER',
            accountOnFile: accountOnFile,
            isAmountFinal: true,
            IPAddress: ipAddress,
            resolvedConfig: resolvedConfig
        });

        if (!paymentResult.success) {
            return { error: true, serverErrors: [Resource.msg('error.payment.authorization.failed', 'checkout', null)] };
        }

        Transaction.wrap(function () {
            paymentInstrument.paymentTransaction.setTransactionID(paymentResult.transactionId || orderNumber);
            paymentInstrument.paymentTransaction.setPaymentProcessor(paymentProcessor);

            persistAuthorizationData({
                paymentInstrument: paymentInstrument,
                transactionId: paymentResult.transactionId,
                captureMethod: captureMethod
            });

            order.custom.jpmcMerchantId = resolvedConfig.merchantId;
        });

        return {
            error: false,
            serverErrors: serverErrors,
            transactionId: paymentResult.transactionId,
            captureMethod: captureMethod
        };

    } catch (e) {
        var errorMsg = e instanceof Error ? e.message : String(e);
        serverErrors.push(Resource.msg('error.technical', 'checkout', null));
        if (order) {
            try {
                OrderMgr.failOrder(order, true);
            } catch (failErr) {
            }
        }
        return { error: true, serverErrors: serverErrors };
    } finally {
        try {
            session.privacy.jpmcCvv = null;
            session.privacy.jpmcEncryptedCvv = null;
            session.privacy.jpmcEncryptedData = null;
        } catch (clearErr) {
        }
    }
}

/**
 * Authorizes a Google Pay payment
 * @param {string} orderNumber
 * @param {dw.order.PaymentInstrument} paymentInstrument
 * @param {dw.order.PaymentProcessor} paymentProcessor
 * @returns {Object}
 */
function authorizeGooglePay(orderNumber, paymentInstrument, paymentProcessor) {
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
    var Resource = require('dw/web/Resource');
    var serverErrors = [];

    var order = OrderMgr.getOrder(orderNumber);

    try {
        if (!order) {
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        var resolvedConfig = JPMCMerchantResolver.resolve();

        var googlePayTokenStr = session.privacy.jpmcGooglePayToken;
        if (!googlePayTokenStr) {
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        var googlePayToken;
        try {
            googlePayToken = JSON.parse(googlePayTokenStr);
        } catch (parseError) {
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        if (!googlePayToken.signedMessage || !googlePayToken.protocolVersion) {
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        var hasSignature = googlePayToken.signature
            || (googlePayToken.intermediateSigningKey
                && googlePayToken.intermediateSigningKey.signatures
                && googlePayToken.intermediateSigningKey.signatures.length > 0);
        if (!hasSignature) {
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        var captureMethod = resolvedConfig.captureMethod || JPMCConfig.getCaptureMethod();
        var merchantId = resolvedConfig.merchantId;
        var JPMCPayloadBuilder = require('*/cartridge/scripts/helpers/JPMCPayloadBuilder');
        var payload = JPMCPayloadBuilder.buildGooglePayPaymentPayload({
            order: order,
            paymentInstrument: paymentInstrument,
            captureMethod: captureMethod,
            googlePayToken: googlePayToken,
            initiatorType: 'CARDHOLDER',
            accountOnFile: 'NOT_STORED',
            isAmountFinal: true,
            resolvedConfig: resolvedConfig
        });
        var UUID = require('dw/util/UUIDUtils');
        var requestId = UUID.createUUID().toString();

        var headers = {
            'merchant-id': merchantId,
            'request-id': requestId
        };

        var JPMCServiceHelper = require('*/cartridge/scripts/services/JPMCServiceHelper');
        var serviceResult = JPMCServiceHelper.callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCPaymentService',
            method: 'POST',
            data: payload,
            headers: headers,
            resolvedConfig: resolvedConfig
        });

        if (!serviceResult.success || !serviceResult.data) {
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        var paymentData = serviceResult.data;

        if (paymentData.responseStatus !== 'SUCCESS') {
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        Transaction.wrap(function () {
            paymentInstrument.paymentTransaction.setTransactionID(paymentData.transactionId || orderNumber);
            paymentInstrument.paymentTransaction.setPaymentProcessor(paymentProcessor);

            persistAuthorizationData({
                paymentInstrument: paymentInstrument,
                transactionId: paymentData.transactionId,
                captureMethod: captureMethod,
                walletProvider: jpmcConstants.GOOGLE_PAY_WALLET_PROVIDER
            });
            order.addNote(jpmcConstants.NOTE_SUBJECT_GPAY_PAYMENT,
                'Transaction ID: ' + (paymentData.transactionId || '') +
                '\nCapture Method: ' + captureMethod +
                '\nAmount: ' + paymentInstrument.paymentTransaction.amount.value + ' ' + order.getCurrencyCode());

            order.custom.jpmcMerchantId = resolvedConfig.merchantId;
        });

        return {
            error: false,
            serverErrors: serverErrors,
            transactionId: paymentData.transactionId,
            captureMethod: captureMethod
        };

    } catch (e) {
        var errorMsg = e instanceof Error ? e.message : String(e);
        serverErrors.push(Resource.msg('error.technical', 'checkout', null));
        return { error: true, serverErrors: serverErrors };
    } finally {
        try {
            session.privacy.jpmcGooglePayToken = null;
        } catch (clearErr) {
        }
    }
}

/**
 * Voids the remaining uncaptured authorization for an order.
 * @param {dw.order.Order} order
 * @param {Object} [options]
 * @param {Object} [options.resolvedConfig]
 * @returns {Object}
 */
function voidPayment(order, options) {
    var JPMCServiceHelper = require('*/cartridge/scripts/services/JPMCServiceHelper');
    var JPMCPayloadBuilder = require('*/cartridge/scripts/helpers/JPMCPayloadBuilder');
    var UUID = require('dw/util/UUIDUtils');

    var result = { success: false, error: null, data: null };

    if (!order) {
        result.error = 'Order is required';
        return result;
    }

    try {
        var paymentInstruments = order.getPaymentInstruments();
        if (paymentInstruments.length === 0) {
            result.error = 'No payment instruments found on order';
            return result;
        }

        var paymentInstrument = paymentInstruments[0];
        var paymentTransaction = paymentInstrument.getPaymentTransaction();

        if (!paymentTransaction || !paymentTransaction.getTransactionID()) {
            result.error = 'No authorization transaction found';
            return result;
        }

        var jpmcTransactionId = resolveJpmcTransactionId(paymentInstrument, paymentTransaction);

        if (!jpmcTransactionId) {
            result.error = 'JPMC transaction ID not found';
            return result;
        }

        var voidPayload = JPMCPayloadBuilder.buildVoidPayload();

        var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
        var resolvedConfig = (options && options.resolvedConfig) || JPMCMerchantResolver.resolveForOrder(order);
        var merchantId = resolvedConfig.merchantId;

        if (!merchantId) {
            result.error = 'Merchant ID not configured';
            return result;
        }

        var requestId = UUID.createUUID().toString();

        var serviceResult = JPMCServiceHelper.callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCPaymentVoid',
            method: 'PATCH',
            data: voidPayload,
            headers: {
                'merchant-id': merchantId,
                'request-id': requestId
            },
            placeHolderId: jpmcTransactionId,
            resolvedConfig: resolvedConfig
        });

        if (serviceResult.success && serviceResult.data) {
            var voidData = serviceResult.data;

            if (voidData.responseStatus === 'SUCCESS' && voidData.transactionState === 'VOIDED') {
                Transaction.wrap(function () {
                    if (paymentTransaction.custom) {
                        paymentTransaction.custom.jpmcRemainingAuthAmount = 0;
                    }

                    var voidNote = 'JPMC Void Successful\n' +
                        'Transaction ID: ' + (voidData.transactionId || jpmcTransactionId) + '\n' +
                        'Transaction State: ' + voidData.transactionState + '\n' +
                        'User: ' + (session.userName || 'System');

                    if (voidData.approvalCode) {
                        voidNote += '\nApproval Code: ' + voidData.approvalCode;
                    }

                    order.addNote('JPMC Authorization Voided', voidNote);
                });

                result.success = true;
                result.data = voidData;
            } else {
                result.error = voidData.responseMessage || 'Void failed with status: ' + voidData.responseStatus;
                result.data = voidData;
            }
        } else {
            result.error = serviceResult.error || 'Void service call failed';
        }
    } catch (e) {
        result.error = e.message || String(e);
    }

    return result;
}

module.exports = {
    authorize: authorize,
    authorizeGooglePay: authorizeGooglePay,
    voidPayment: voidPayment,
    resolveJpmcTransactionId: resolveJpmcTransactionId,
    persistAuthorizationData: persistAuthorizationData
};