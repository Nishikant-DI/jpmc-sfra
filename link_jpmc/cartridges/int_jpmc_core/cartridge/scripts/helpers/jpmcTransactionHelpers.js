'use strict';

var Transaction = require('dw/system/Transaction');
var OrderMgr = require('dw/order/OrderMgr');
var Logger = require('dw/system/Logger').getLogger('JPMC', 'transaction');
var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');

/**
 * Resolves the JPMC transaction ID from the 3-level fallback chain:
 * PaymentTransaction.custom.jpmcAuthorizationId → PaymentInstrument.custom.jpmcTransactionId → PaymentTransaction.transactionID
 *
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
 * Persists authorization/capture data onto the PaymentInstrument and
 * PaymentTransaction custom attributes after a successful JPMC authorization.
 *
 * MUST be called inside a Transaction.wrap block.
 *
 * @param {Object} opts
 * @param {dw.order.PaymentInstrument} opts.paymentInstrument
 * @param {string} opts.transactionId
 * @param {string} opts.captureMethod
 * @param {string} [opts.walletProvider] - e.g. 'GOOGLE_PAY', 'APPLE_PAY'
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
    var Resource = require('dw/web/Resource');
    var serverErrors = [];

    var order = OrderMgr.getOrder(orderNumber);

    try {
        if (!order) {
            Logger.error('Order not found: {0}', orderNumber);
            return { error: true, serverErrors: [Resource.msg('error.payment.order.not.found', 'checkout', null)] };
        }

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
        var captureMethod = JPMCConfig.getCaptureMethod();
        var HookMgr = require('dw/system/HookMgr');
        var JPMCPaymentHelper = require('*/cartridge/scripts/helpers/JPMCPaymentHelper');
        
        var fraudRuleActionFromVerify = null;
        var fraudRuleActionFromAuth = null;
        if (paymentInstrument.custom && paymentInstrument.custom.jpmcFraudRuleAction) {
            fraudRuleActionFromVerify = paymentInstrument.custom.jpmcFraudRuleAction;
        }
        if (JPMCConfig.isFraudCheckEnabledAtAuth() && HookMgr.hasHook('app.safetech.fraud.detection')) {
            var accountNumberType = isStoredCard ? JPMCConfig.getConfig().accountNumberType : jpmcConstants.ACCOUNT_NUMBER_TYPE_PIE;
            
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
        
        // Fraud flag overrides capture method to MANUAL, forcing CSC review before funds are settled.
        var isFraudFlagged = (fraudRuleActionFromVerify === 'E' || fraudRuleActionFromVerify === 'R') ||
                             (fraudRuleActionFromAuth === 'E' || fraudRuleActionFromAuth === 'R');
        
        if (isFraudFlagged) {
            captureMethod = 'MANUAL';
            Logger.info('Authorization: Due to fraud check review needed, capture method is marked as Manual (Original: {0}, Fraud from Verify: {1}, Fraud from Auth: {2})',
                originalCaptureMethod, fraudRuleActionFromVerify || 'N/A', fraudRuleActionFromAuth || 'N/A');
            
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
                    Logger.info('Authorization: Order note added - Order marked for review (Order: {0})', orderNumber);
                }
            });
        }

        // Guard: IP address unavailable in headless/scheduler contexts
        var ipAddress = null;
        try {
            ipAddress = (typeof request !== 'undefined' && request) ? request.getHttpRemoteAddress() : null;
        } catch (ipErr) {
            Logger.warn('authorize: Could not get IP address: {0}', ipErr instanceof Error ? ipErr.message : String(ipErr));
        }

        var paymentResult = JPMCPaymentHelper.createPayment(order, {
            paymentInstrument: paymentInstrument,
            accountNumberType: isStoredCard ? JPMCConfig.getConfig().accountNumberType : jpmcConstants.ACCOUNT_NUMBER_TYPE_PIE,
            captureMethod: captureMethod,
            initiatorType: 'CARDHOLDER',
            accountOnFile: accountOnFile,
            isAmountFinal: true,
            IPAddress: ipAddress
        });

        if (!paymentResult.success) {
            Logger.error('createPayment failed - Order: {0}, Error: {1}', orderNumber, paymentResult.error);
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
        });

        Logger.info('Payment authorized - Order: {0}, TxnId: {1}, CaptureMethod: {2}',
            orderNumber, paymentResult.transactionId, captureMethod);

        return {
            error: false,
            serverErrors: serverErrors,
            transactionId: paymentResult.transactionId,
            captureMethod: captureMethod
        };

    } catch (e) {
        var errorMsg = e instanceof Error ? e.message : String(e);
        Logger.error('Authorization failed - Order: {0}, Error: {1}', orderNumber, errorMsg);
        serverErrors.push(Resource.msg('error.technical', 'checkout', null));
        if (order) {
            try {
                OrderMgr.failOrder(order, true);
            } catch (failErr) {
                Logger.error('Failed to fail order {0}: {1}', orderNumber, failErr instanceof Error ? failErr.message : String(failErr));
            }
        }
        return { error: true, serverErrors: serverErrors };
    } finally {
        // Clear sensitive session data on every exit path.
        try {
            session.privacy.jpmcCvv = null;
            session.privacy.jpmcEncryptedCvv = null;
            session.privacy.jpmcEncryptedData = null;
        } catch (clearErr) {
            Logger.error('authorize: Failed to clear session privacy - {0}', clearErr instanceof Error ? clearErr.message : String(clearErr));
        }
    }
}

/**
 * Authorizes a Google Pay payment via JPMC
 * @param {string} orderNumber
 * @param {dw.order.PaymentInstrument} paymentInstrument
 * @param {dw.order.PaymentProcessor} paymentProcessor
 * @returns {Object}
 */
function authorizeGooglePay(orderNumber, paymentInstrument, paymentProcessor) {
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var Resource = require('dw/web/Resource');
    var serverErrors = [];

    var order = OrderMgr.getOrder(orderNumber);

    try {
        if (!order) {
            Logger.error('authorizeGooglePay: Order not found: {0}', orderNumber);
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        // Google Pay token stored in session.privacy (memory-only, never DB-persisted).
        // Written by jpmc_googlepay.Handle(); cleared in the finally block below.
        var googlePayTokenStr = session.privacy.jpmcGooglePayToken;
        if (!googlePayTokenStr) {
            Logger.error('authorizeGooglePay: Google Pay token not found in session');
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        var googlePayToken;
        try {
            googlePayToken = JSON.parse(googlePayTokenStr);
        } catch (parseError) {
            Logger.error('authorizeGooglePay: Failed to parse Google Pay token: {0}', parseError instanceof Error ? parseError.message : String(parseError));
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        if (!googlePayToken.signedMessage || !googlePayToken.protocolVersion) {
            Logger.error('authorizeGooglePay: Incomplete Google Pay token data - missing signedMessage or protocolVersion');
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        // ECv1 uses top-level signature; ECv2 uses intermediateSigningKey.signatures[]
        var hasSignature = googlePayToken.signature
            || (googlePayToken.intermediateSigningKey
                && googlePayToken.intermediateSigningKey.signatures
                && googlePayToken.intermediateSigningKey.signatures.length > 0);
        if (!hasSignature) {
            Logger.error('authorizeGooglePay: No signature found in Google Pay token (ECv1 or ECv2)');
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        var captureMethod = JPMCConfig.getCaptureMethod();
        var merchantId = JPMCConfig.getPreference('JPMC_MerchantCode', false);
        var JPMCPayloadBuilder = require('*/cartridge/scripts/helpers/JPMCPayloadBuilder');
        var payload = JPMCPayloadBuilder.buildGooglePayPaymentPayload({
            order: order,
            paymentInstrument: paymentInstrument,
            captureMethod: captureMethod,
            googlePayToken: googlePayToken,
            initiatorType: 'CARDHOLDER',
            accountOnFile: 'NOT_STORED',
            isAmountFinal: true
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
            headers: headers
        });

        if (!serviceResult.success || !serviceResult.data) {
            Logger.error('authorizeGooglePay: Service call failed - {0}', serviceResult.error || 'Unknown error');
            serverErrors.push(Resource.msg('error.technical', 'checkout', null));
            return { error: true, serverErrors: serverErrors };
        }

        var paymentData = serviceResult.data;

        if (paymentData.responseStatus !== 'SUCCESS') {
            Logger.error('authorizeGooglePay: Payment failed - Status: {0}, Code: {1}, Message: {2}',
                paymentData.responseStatus, paymentData.responseCode, paymentData.responseMessage);
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
        });

        Logger.info('Google Pay authorized - Order: {0}, TxnId: {1}, CaptureMethod: {2}',
            orderNumber, paymentData.transactionId, captureMethod);

        return {
            error: false,
            serverErrors: serverErrors,
            transactionId: paymentData.transactionId,
            captureMethod: captureMethod
        };

    } catch (e) {
        var errorMsg = e instanceof Error ? e.message : String(e);
        Logger.error('authorizeGooglePay failed - Order: {0}, Error: {1}', orderNumber, errorMsg);
        serverErrors.push(Resource.msg('error.technical', 'checkout', null));
        return { error: true, serverErrors: serverErrors };
    } finally {
        // Clear Google Pay token from session (memory-only cleanup).
        try {
            session.privacy.jpmcGooglePayToken = null;
        } catch (clearErr) {
            Logger.error('authorizeGooglePay: Failed to clear session token - {0}', clearErr instanceof Error ? clearErr.message : String(clearErr));
        }
    }
}

/**
 * Voids the remaining uncaptured authorization for an order.
 * Calls JPMC PATCH /payments/{id} with {"isVoid": true}.
 * @param {dw.order.Order} order
 * @returns {Object}
 */
function voidPayment(order) {
    var JPMCServiceHelper = require('*/cartridge/scripts/services/JPMCServiceHelper');
    var JPMCPayloadBuilder = require('*/cartridge/scripts/helpers/JPMCPayloadBuilder');
    var UUID = require('dw/util/UUIDUtils');

    var result = { success: false, error: null, data: null };

    if (!order) {
        result.error = 'Order is required';
        Logger.error('voidPayment: {0}', result.error);
        return result;
    }

    try {
        var paymentInstruments = order.getPaymentInstruments();
        if (paymentInstruments.length === 0) {
            result.error = 'No payment instruments found on order';
            Logger.error('voidPayment: Order {0} - {1}', order.orderNo, result.error);
            return result;
        }

        var paymentInstrument = paymentInstruments[0];
        var paymentTransaction = paymentInstrument.getPaymentTransaction();

        if (!paymentTransaction || !paymentTransaction.getTransactionID()) {
            result.error = 'No authorization transaction found';
            Logger.error('voidPayment: Order {0} - {1}', order.orderNo, result.error);
            return result;
        }

        var jpmcTransactionId = resolveJpmcTransactionId(paymentInstrument, paymentTransaction);

        if (!jpmcTransactionId) {
            result.error = 'JPMC transaction ID not found';
            Logger.error('voidPayment: Order {0} - {1}', order.orderNo, result.error);
            return result;
        }

        var voidPayload = JPMCPayloadBuilder.buildVoidPayload();

        var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
        var config = JPMCConfig.getAccessTokenConfig();
        var merchantId = config.merchantId;

        if (!merchantId) {
            result.error = 'Merchant ID not configured';
            Logger.error('voidPayment: {0}', result.error);
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
            placeHolderId: jpmcTransactionId
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
                Logger.info('voidPayment: SUCCESS - Order {0}, TxnID: {1}, State: {2}',
                    order.orderNo, jpmcTransactionId, voidData.transactionState);
            } else {
                result.error = voidData.responseMessage || 'Void failed with status: ' + voidData.responseStatus;
                result.data = voidData;
                Logger.error('voidPayment: FAILED - Order {0}, Status: {1}, Code: {2}, Message: {3}',
                    order.orderNo, voidData.responseStatus, voidData.responseCode, voidData.responseMessage);
            }
        } else {
            result.error = serviceResult.error || 'Void service call failed';
            Logger.error('voidPayment: SERVICE ERROR - Order {0}, Error: {1}',
                order.orderNo, result.error);
        }
    } catch (e) {
        result.error = e.message || String(e);
        Logger.error('voidPayment: EXCEPTION - Order {0}, Error: {1}',
            order.orderNo, result.error);
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