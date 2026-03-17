'use strict';

var ISML = require('dw/template/ISML');
var Transaction = require('dw/system/Transaction');
var Resource = require('dw/web/Resource');
var OrderMgr = require('dw/order/OrderMgr');
var PaymentTransaction = require('dw/order/PaymentTransaction');
var csrfProtection = require('dw/web/CSRFProtection');
var Logger = require('dw/system/Logger').getLogger('JPMC', 'CSC');

var CSCHelper = require('./JPMCPaymentCSCHelper');

var PAYMENT_STATUS = CSCHelper.PAYMENT_STATUS;
var PAYMENT_STATUS_LABELS = CSCHelper.PAYMENT_STATUS_LABELS;
var AMOUNT_REGEX = CSCHelper.AMOUNT_REGEX;
var DELAYED_CAPTURE_WINDOW_MINUTES = CSCHelper.DELAYED_CAPTURE_WINDOW_MINUTES;

var isWithinDelayedCaptureWindow = CSCHelper.isWithinDelayedCaptureWindow;
var delayedWindowMinutesRemaining = CSCHelper.delayedWindowMinutesRemaining;
var canCapture = CSCHelper.canCapture;
var canVoid = CSCHelper.canVoid;
var canRefund = CSCHelper.canRefund;
var getCaptureHistory = CSCHelper.getCaptureHistory;
var getRefundHistory = CSCHelper.getRefundHistory;
var getVoidHistory = CSCHelper.getVoidHistory;
var maskCardNumber = CSCHelper.maskCardNumber;
var getPaymentMethodName = CSCHelper.getPaymentMethodName;
var isSupportedPaymentMethod = CSCHelper.isSupportedPaymentMethod;

/**
 * Get order payment details
 * @param {dw.order.Order} order
 * @returns {Object}
 */
function getOrderPaymentDetails(order) {
    var paymentInstruments = order.getPaymentInstruments();
    var paymentInstrument = null;
    for (var i = 0; i < paymentInstruments.length; i++) {
        var pi = paymentInstruments[i];
        if (isSupportedPaymentMethod(pi.paymentMethod)) {
            paymentInstrument = pi;
            break;
        }
    }
    
    if (!paymentInstrument) {
        return {
            found: false,
            error: Resource.msg('csc.error.no.jpmc.instrument', 'jpmcbm', null)
        };
    }
    
    var paymentTransaction = paymentInstrument.getPaymentTransaction();
    var custom = paymentTransaction.custom;
    var authorizedAmount = paymentTransaction.amount.value;
    var capturedAmount = custom.jpmcCapturedAmount || 0;
    var refundedAmount = custom.jpmcRefundedAmount || 0;

    // Backwards compatibility: orders created before the cents-to-dollars migration
    // will have custom attribute values ~100× larger than the authorized dollar amount.
    // Detect and convert them so the UI shows correct dollar values.
    if (capturedAmount > authorizedAmount * 2 && authorizedAmount > 0) {
        capturedAmount = capturedAmount / 100;
    }
    if (refundedAmount > authorizedAmount * 2 && authorizedAmount > 0) {
        refundedAmount = refundedAmount / 100;
    }
    
    // Remaining amounts: prefer gateway-tracked values, fall back to simple arithmetic.
    // After void, jpmcRemainingAuthAmount is explicitly set to 0 — we must honour that
    // rather than falling back to (authorized – captured) which re-shows voided funds.
    var storedRemainingAuth = custom.jpmcRemainingAuthAmount;
    var remainingAuthAmount;
    if (storedRemainingAuth !== null && storedRemainingAuth !== undefined && !isNaN(storedRemainingAuth)) {
        remainingAuthAmount = Number(storedRemainingAuth);
    } else {
        remainingAuthAmount = Math.max(authorizedAmount - capturedAmount, 0);
    }

    // Always compute remaining refundable from cumulative totals (captured - refunded).
    // The stored jpmcRemainingRefundableAmount may have been corrupted by per-capture API
    // values from JPMC. Computing fresh from totals is always correct.
    var remainingRefundableAmount = Math.max(capturedAmount - refundedAmount, 0);

    // Same backwards-compat guard for remaining amounts
    if (remainingAuthAmount > authorizedAmount * 2 && authorizedAmount > 0) {
        remainingAuthAmount = remainingAuthAmount / 100;
    }
    if (remainingRefundableAmount > authorizedAmount * 2 && authorizedAmount > 0) {
        remainingRefundableAmount = remainingRefundableAmount / 100;
    }
    
    // Get payment status — must be explicitly set on the order's transaction
    var paymentStatus = custom.jpmcPaymentStatus;

    if (!paymentStatus) {
        // Derive status from this order's actual financial data (never from site preferences)
        if (refundedAmount > 0 && refundedAmount >= capturedAmount) {
            paymentStatus = PAYMENT_STATUS.REFUNDED;          // 'RF'
        } else if (refundedAmount > 0) {
            paymentStatus = PAYMENT_STATUS.PARTIAL_REFUNDED;  // 'PRF'
        } else if (capturedAmount > 0 && capturedAmount >= authorizedAmount) {
            paymentStatus = PAYMENT_STATUS.CAPTURED;          // 'C'
        } else if (capturedAmount > 0) {
            paymentStatus = PAYMENT_STATUS.PARTIAL_CAPTURED;  // 'PC'
        } else if (authorizedAmount > 0) {
            // Check transaction type — AUTH_CAPTURE means sale (capture at auth time)
            var txType = paymentTransaction.type ? paymentTransaction.type.value : null;
            if (txType === PaymentTransaction.TYPE_CAPTURE) {
                paymentStatus = PAYMENT_STATUS.AUTH_AND_CAPTURE;  // 'AC'
                // Ensure amounts reflect the immediate capture
                if (capturedAmount === 0) {
                    capturedAmount = authorizedAmount;
                    remainingAuthAmount = 0;
                    remainingRefundableAmount = authorizedAmount;
                }
            } else {
                paymentStatus = PAYMENT_STATUS.AUTHORIZED;  // 'A'
            }
        } else {
            paymentStatus = PAYMENT_STATUS.AUTHORIZED;  // 'A' — safe default
        }
    }

    // Safety net: if the order has been voided (full or partial), remaining auth must be 0.
    // This catches any stale/incorrect stored values or arithmetic fallback drift.
    if (paymentStatus === PAYMENT_STATUS.VOIDED || paymentStatus === PAYMENT_STATUS.PARTIAL_VOID) {
        remainingAuthAmount = 0;
    }

    // DELAYED auto-capture inference: when capture method is DELAYED, the window has expired,
    // and SFCC still shows AUTHORIZED (no callback from JPMC), the gateway has auto-captured
    // the full authorized amount. Reflect that in the amounts so the UI shows correct values.
    var delayedAutoCapture = false;
    var captureMethodValue = custom.jpmcCaptureMethod || null;
    if (captureMethodValue === 'DELAYED'
        && paymentStatus === PAYMENT_STATUS.AUTHORIZED
        && !isWithinDelayedCaptureWindow(custom.jpmcAuthTimestamp)) {
        delayedAutoCapture = true;
        capturedAmount = authorizedAmount;
        remainingAuthAmount = 0;
        remainingRefundableAmount = Math.max(authorizedAmount - refundedAmount, 0);
    }
    var authorizationId = custom.jpmcAuthorizationId 
        || (paymentInstrument.custom && paymentInstrument.custom.jpmcTransactionId)
        || paymentTransaction.transactionID;
    var captureHistory = getCaptureHistory(paymentTransaction);
    var refundHistory = getRefundHistory(paymentTransaction);
    var voidHistory = getVoidHistory(paymentTransaction);

    // Enrich each capture history entry with per-capture remaining refundable amount.
    // This is used by the template to show a refund button per capture row.
    if (captureHistory.length > 0 && refundHistory) {
        // Build map of total refunded (in cents) per captureId
        var refundedPerCapture = {};
        for (var ri = 0; ri < refundHistory.length; ri++) {
            var rh = refundHistory[ri];
            if (rh.captureId) {
                refundedPerCapture[rh.captureId] = (refundedPerCapture[rh.captureId] || 0) + (rh.amount || 0);
            }
        }
        for (var ci = 0; ci < captureHistory.length; ci++) {
            var cap = captureHistory[ci];
            var capCents = cap.amount || 0;           // stored in cents
            var refCents = refundedPerCapture[cap.transactionId] || 0;
            var remainCents = Math.max(capCents - refCents, 0);
            cap.refundedCents = refCents;
            cap.remainingRefundableCents = remainCents;
            cap.remainingRefundableDollars = remainCents / 100;
        }
    }
    
    return {
        found: true,
        paymentInstrument: paymentInstrument,
        paymentTransaction: paymentTransaction,
        paymentMethod: getPaymentMethodName(paymentInstrument.paymentMethod),
        paymentStatus: paymentStatus,
        captureMethod: captureMethodValue,
        authTimestamp: custom.jpmcAuthTimestamp || null,
        delayedAutoCapture: delayedAutoCapture,
        transactionId: paymentTransaction.transactionID,
        jpmcTransactionId: authorizationId,
        cardNumber: paymentInstrument.creditCardNumber ? maskCardNumber(paymentInstrument.creditCardNumber) : null,
        cardType: paymentInstrument.creditCardType,
        captureHistory: captureHistory,
        refundHistory: refundHistory,
        voidHistory: voidHistory,
        amounts: {
            authorized: authorizedAmount,
            captured: capturedAmount,
            refunded: refundedAmount,
            total: authorizedAmount,
            remainingAuth: remainingAuthAmount,
            remainingRefundable: remainingRefundableAmount,
            currency: order.getCurrencyCode()
        }
    };
}

/**
 * Main CSC entry point - display order payment details and handle actions.
 * Called from the CSC tab on the order detail page.
 * @returns {void}
 */
exports.ManagePayment = function () {
    var orderId = request.httpParameterMap.orderNo.stringValue || '';
    var captureAction = request.httpParameterMap.capture.stringValue || null;
    var refundAction = request.httpParameterMap.refund.stringValue || null;
    var voidAction = request.httpParameterMap.voidAuth.stringValue || null;
    var amountParam = request.httpParameterMap.amountIntroduced.stringValue || null;
    var finalCaptureParam = request.httpParameterMap.isFinalCapture.stringValue || null;
    var refundCaptureId = request.httpParameterMap.refundCaptureId.stringValue || null;
    if (request.httpMethod !== 'GET') {
        var validateRequest = csrfProtection.validateRequest();
        if (!validateRequest) {
            ISML.renderTemplate('csrfFail');
            return; // eslint-disable-line consistent-return
        }
    }
    
    var error = {
        isError: false,
        message: ''
    };
    
    var successMessage = null;
    
    if (!orderId) {
        error.isError = true;
        error.message = Resource.msg('error.order.notfound', 'jpmcbm', 'Order not found');
        ISML.renderTemplate('csc/order', {
            error: error,
            orderId: orderId,
            csrf: {
                tokenName: csrfProtection.getTokenName(),
                token: csrfProtection.generateToken()
            }
        });
        return; // eslint-disable-line consistent-return
    }
    
    var order = OrderMgr.getOrder(orderId);
    if (!order) {
        error.isError = true;
        error.message = Resource.msg('error.order.notfound', 'jpmcbm', 'Order ' + orderId + ' not found');
        ISML.renderTemplate('csc/order', {
            error: error,
            orderId: orderId,
            csrf: {
                tokenName: csrfProtection.getTokenName(),
                token: csrfProtection.generateToken()
            }
        });
        return; // eslint-disable-line consistent-return
    }
    
    var paymentDetails = getOrderPaymentDetails(order);
    if (!paymentDetails.found) {
        error.isError = true;
        error.message = paymentDetails.error;
        ISML.renderTemplate('csc/order', {
            error: error,
            orderId: orderId,
            order: order,
            csrf: {
                tokenName: csrfProtection.getTokenName(),
                token: csrfProtection.generateToken()
            }
        });
        return; // eslint-disable-line consistent-return
    }
    var JPMCPaymentHelper;
    try {
        if (captureAction) {
            JPMCPaymentHelper = require('*/cartridge/scripts/helpers/JPMCPaymentHelper');
            var captureEligibility = canCapture(paymentDetails);
            if (!captureEligibility.allowed) {
                error.isError = true;
                error.message = captureEligibility.reason
                    || Resource.msg('csc.error.capture.notmanual', 'jpmcbm', 'Capture is not available for this order.');
            }
            var captureAmount;
            if (!error.isError) {
                if (amountParam) {
                    if (!AMOUNT_REGEX.test(amountParam)) {
                        error.isError = true;
                        error.message = Resource.msg('csc.error.amount.format', 'jpmcbm', 'Enter a valid dollar amount (e.g. 10.00).');
                    } else {
                        captureAmount = parseFloat(amountParam);
                    }
                } else {
                    captureAmount = paymentDetails.amounts.remainingAuth;
                }
            }

            if (!error.isError) {
                if (!captureAmount || captureAmount <= 0) {
                    error.isError = true;
                    error.message = Resource.msg('csc.error.amount.positive', 'jpmcbm', 'Amount must be greater than 0.');
                } else if (captureAmount > paymentDetails.amounts.remainingAuth) {
                    error.isError = true;
                    error.message = Resource.msgf('csc.error.capture.exceeds', 'jpmcbm', null,
                        captureAmount.toFixed(2), paymentDetails.amounts.remainingAuth.toFixed(2));
                } else {
                    // Determine multi-capture sequence from existing capture history
                    var existingCaptures = paymentDetails.captureHistory || [];
                    var sequenceNumber = existingCaptures.length + 1;
                    // Final if: amount equals remaining, OR user explicitly checked "final capture"
                    var isFinalCapture = captureAmount >= paymentDetails.amounts.remainingAuth
                        || finalCaptureParam === 'true';

                    var captureResult = JPMCPaymentHelper.capturePayment(order, {
                        amount: captureAmount,
                        isFinal: isFinalCapture,
                        multiCapture: {
                            sequenceNumber: sequenceNumber,
                            isFinal: isFinalCapture
                        }
                    });

                    if (captureResult.success) {
                        Transaction.wrap(function () {
                            var pi = paymentDetails.paymentInstrument;
                            var custom = pi.paymentTransaction.custom;
                            if (isFinalCapture) {
                                custom.jpmcPaymentStatus = PAYMENT_STATUS.CAPTURED;
                                // Final capture — no more auth to capture
                                custom.jpmcRemainingAuthAmount = 0;
                            } else {
                                custom.jpmcPaymentStatus = PAYMENT_STATUS.PARTIAL_CAPTURED;
                            }
                        });

                        successMessage = Resource.msgf('csc.success.capture', 'jpmcbm', null, captureAmount.toFixed(2));
                        Logger.info('CSC: Capture successful - Order: {0}, Amount: {1}', orderId, captureAmount);
                        paymentDetails = getOrderPaymentDetails(order);
                    } else {
                        error.isError = true;
                        Logger.error('CSC: Capture failed - Order: {0}, Gateway: {1}', orderId, captureResult.error);
                        error.message = Resource.msg('csc.error.capture.failed', 'jpmcbm',
                            'Capture could not be completed. Please retry or contact payment support.');
                    }
                }
            }
        } else if (refundAction) {
            JPMCPaymentHelper = require('*/cartridge/scripts/helpers/JPMCPaymentHelper');
            var refundEligibility = canRefund(paymentDetails);
            if (!refundEligibility.allowed) {
                error.isError = true;
                error.message = refundEligibility.reason
                    || Resource.msg('csc.info.refund.nothing', 'jpmcbm', 'No remaining refundable amount.');
            }

            // DELAYED auto-capture: the gateway captured the full auth amount but SFCC
            // doesn't know yet. Sync SFCC financial data before processing the refund so
            // the helper's validation (captured − refunded) gives the correct ceiling.
            if (!error.isError && refundEligibility.delayedAutoCapture) {
                try {
                    Transaction.wrap(function () {
                        var pi = paymentDetails.paymentInstrument;
                        var txCustom = pi.paymentTransaction.custom;
                        txCustom.jpmcCapturedAmount = paymentDetails.amounts.authorized;
                        txCustom.jpmcRemainingAuthAmount = 0;
                        txCustom.jpmcPaymentStatus = PAYMENT_STATUS.CAPTURED;
                    });
                    Logger.info('CSC: Synced DELAYED auto-capture for order {0} — set captured = {1}',
                        orderId, paymentDetails.amounts.authorized);
                    // Refresh after sync so downstream amounts are current
                    paymentDetails = getOrderPaymentDetails(order);
                } catch (syncErr) {
                    error.isError = true;
                    Logger.error('CSC: DELAYED auto-capture sync failed - Order: {0}: {1}', orderId, syncErr.message || String(syncErr));
                    error.message = Resource.msg('csc.error.sync.auto.capture', 'jpmcbm',
                        'An internal error occurred while syncing the payment record. Please retry.');
                }
            }
            var refundAmount;
            // Per-capture ceiling: when a specific captureId is targeted, validate
            // against that capture's remaining refundable amount (not the global total).
            var perCaptureMax = 0;
            var targetCapture = null;
            if (!error.isError && refundCaptureId && paymentDetails.captureHistory) {
                for (var ci = 0; ci < paymentDetails.captureHistory.length; ci++) {
                    if (paymentDetails.captureHistory[ci].transactionId === refundCaptureId) {
                        targetCapture = paymentDetails.captureHistory[ci];
                        break;
                    }
                }
                if (!targetCapture) {
                    error.isError = true;
                    error.message = Resource.msg('csc.error.capture.id.not.found', 'jpmcbm', null) + ': ' + refundCaptureId;
                    Logger.error('CSC: Refund target capture not found - Order: {0}, CaptureId: {1}', orderId, refundCaptureId);
                } else {
                    perCaptureMax = targetCapture.remainingRefundableDollars || 0;
                    if (perCaptureMax <= 0) {
                        error.isError = true;
                        error.message = Resource.msg('csc.info.refund.nothing', 'jpmcbm', 'No remaining refundable amount.');
                    }
                }
            }
            var effectiveMax = (refundCaptureId && perCaptureMax > 0) ? perCaptureMax : paymentDetails.amounts.remainingRefundable;

            if (!error.isError) {
                if (amountParam) {
                    if (!AMOUNT_REGEX.test(amountParam)) {
                        error.isError = true;
                        error.message = Resource.msg('csc.error.amount.format', 'jpmcbm', 'Enter a valid dollar amount (e.g. 10.00).');
                    } else {
                        refundAmount = parseFloat(amountParam);
                    }
                } else {
                    refundAmount = effectiveMax;
                }
            }

            if (!error.isError) {
                if (!refundAmount || refundAmount <= 0) {
                    error.isError = true;
                    error.message = Resource.msg('csc.error.amount.positive', 'jpmcbm', 'Amount must be greater than 0.');
                } else if (refundAmount > effectiveMax + 0.001) {
                    error.isError = true;
                    error.message = Resource.msgf('csc.error.refund.exceeds', 'jpmcbm', null,
                        refundAmount.toFixed(2), effectiveMax.toFixed(2));
                } else {
                    var refundOpts = { amount: refundAmount };
                    if (refundCaptureId) {
                        refundOpts.captureId = refundCaptureId;
                    }
                    var refundResult = JPMCPaymentHelper.refundPayment(order, refundOpts);

                    if (refundResult.success) {
                        Transaction.wrap(function () {
                            var pi = paymentDetails.paymentInstrument;
                            var custom = pi.paymentTransaction.custom;
                            if (refundAmount >= paymentDetails.amounts.remainingRefundable) {
                                custom.jpmcPaymentStatus = PAYMENT_STATUS.REFUNDED;
                            } else {
                                custom.jpmcPaymentStatus = PAYMENT_STATUS.PARTIAL_REFUNDED;
                            }
                        });

                        successMessage = Resource.msgf('csc.success.refund', 'jpmcbm', null, refundAmount.toFixed(2));
                        Logger.info('CSC: Refund successful - Order: {0}, Amount: {1}', orderId, refundAmount);
                        paymentDetails = getOrderPaymentDetails(order);
                    } else {
                        error.isError = true;
                        Logger.error('CSC: Refund failed - Order: {0}, Gateway: {1}', orderId, refundResult.error);
                        error.message = Resource.msg('csc.error.refund.failed', 'jpmcbm',
                            'Refund could not be completed. Please retry or contact payment support.');
                    }
                }
            }
        } else if (voidAction) {
            JPMCPaymentHelper = require('*/cartridge/scripts/helpers/JPMCPaymentHelper');
            var voidEligibility = canVoid(paymentDetails);

            if (!voidEligibility.allowed) {
                error.isError = true;
                error.message = voidEligibility.reason
                    || Resource.msg('csc.error.void.notallowed', 'jpmcbm',
                        'Void not available — authorization already fully captured or voided.');
            } else {
                var voidResult = JPMCPaymentHelper.voidPayment(order);

                if (voidResult.success) {
                    // Update payment status, zero out remaining auth, and record void history
                    var hadCaptures = paymentDetails.amounts.captured > 0;
                    var voidedAmount = paymentDetails.amounts.remainingAuth;
                    Transaction.wrap(function () {
                        var pi = paymentDetails.paymentInstrument;
                        var custom = pi.paymentTransaction.custom;
                        // If some amount was already captured, this is a partial void
                        custom.jpmcPaymentStatus = hadCaptures
                            ? PAYMENT_STATUS.PARTIAL_VOID
                            : PAYMENT_STATUS.VOIDED;
                        // Zero out remaining auth — voided amount is no longer capturable
                        custom.jpmcRemainingAuthAmount = 0;

                        // Record void history entry
                        var existingVoidHistory = [];
                        if (custom.jpmcVoidHistory) {
                            try {
                                existingVoidHistory = JSON.parse(custom.jpmcVoidHistory);
                            } catch (parseErr) {
                                Logger.warn('CSC: Could not parse existing void history: {0}', parseErr.message);
                            }
                        }
                        existingVoidHistory.push({
                            amount: voidedAmount,
                            amountDisplay: voidedAmount.toFixed(2),
                            currency: paymentDetails.amounts.currency,
                            timestamp: new Date().toISOString(),
                            status: 'SUCCESS',
                            type: hadCaptures ? 'PARTIAL_VOID' : 'FULL_VOID',
                            userId: session.userName || 'System'
                        });
                        custom.jpmcVoidHistory = JSON.stringify(existingVoidHistory);
                    });

                    successMessage = Resource.msg('csc.success.void', 'jpmcbm', 'Authorization voided successfully.');
                    Logger.info('CSC: Void successful - Order: {0}', orderId);
                    paymentDetails = getOrderPaymentDetails(order);
                } else {
                    error.isError = true;
                    Logger.error('CSC: Void failed - Order: {0}, Gateway: {1}', orderId, voidResult.error);
                    error.message = Resource.msg('csc.error.void.failed', 'jpmcbm',
                        'Void could not be completed. Please retry or contact payment support.');
                }
            }
        }
    } catch (e) {
        error.isError = true;
        Logger.error('CSC: Exception processing action - Order: {0}: {1}', orderId, e instanceof Error ? e.message : String(e));
        error.message = Resource.msg('csc.error.unexpected', 'jpmcbm',
            'An unexpected error occurred. Please refresh and try again.');
    }
    var captureInfo = paymentDetails ? canCapture(paymentDetails) : { allowed: false, reason: null };
    var voidInfo = paymentDetails ? canVoid(paymentDetails) : { allowed: false, reason: null };
    var refundInfo = paymentDetails ? canRefund(paymentDetails) : { allowed: false, reason: null };
    var delayedWindowRemaining = 0;
    if (paymentDetails && paymentDetails.captureMethod === 'DELAYED' && paymentDetails.authTimestamp) {
        delayedWindowRemaining = delayedWindowMinutesRemaining(paymentDetails.authTimestamp);
    }
    ISML.renderTemplate('csc/order', {
        error: error,
        successMessage: successMessage,
        orderId: orderId,
        order: order,
        paymentDetails: paymentDetails,
        PAYMENT_STATUS: PAYMENT_STATUS,
        PAYMENT_STATUS_LABELS: PAYMENT_STATUS_LABELS,
        captureInfo: captureInfo,
        voidInfo: voidInfo,
        refundInfo: refundInfo,
        delayedWindowRemaining: delayedWindowRemaining,
        delayedWindowMinutes: DELAYED_CAPTURE_WINDOW_MINUTES,
        csrf: {
            tokenName: csrfProtection.getTokenName(),
            token: csrfProtection.generateToken()
        }
    });
};
exports.ManagePayment.public = true;
