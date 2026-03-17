/**
 * JPMC CSC Helper — eligibility checks, history parsers, and display utilities.
 * @module controllers/JPMCPaymentCSCHelper
 */

'use strict';

var Resource = require('dw/web/Resource');
var Logger = require('dw/system/Logger').getLogger('JPMC', 'CSC-helper');

/** Payment status constants */
var PAYMENT_STATUS = {
    AUTHORIZED: 'A',
    AUTH_AND_CAPTURE: 'AC',
    CAPTURED: 'C',
    PARTIAL_CAPTURED: 'PC',
    REFUNDED: 'RF',
    PARTIAL_REFUNDED: 'PRF',
    VOIDED: 'V',
    PARTIAL_VOID: 'PV'
};

/** Human-readable labels for payment status codes */
var PAYMENT_STATUS_LABELS = {
    A:   Resource.msg('csc.status.authorized', 'jpmcbm', 'Authorized'),
    AC:  Resource.msg('csc.status.auth.and.capture', 'jpmcbm', 'Authorized & Captured'),
    C:   Resource.msg('csc.status.captured', 'jpmcbm', 'Captured'),
    PC:  Resource.msg('csc.status.partial.captured', 'jpmcbm', 'Partially Captured'),
    RF:  Resource.msg('csc.status.refunded', 'jpmcbm', 'Refunded'),
    PRF: Resource.msg('csc.status.partial.refunded', 'jpmcbm', 'Partially Refunded'),
    V:   Resource.msg('csc.status.voided', 'jpmcbm', 'Voided'),
    PV:  Resource.msg('csc.status.partial.void', 'jpmcbm', 'Partially Captured & Voided')
};

/** @type {RegExp} Validates dollar amount: positive, up to 2 decimal places */
var AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

/** Default DELAYED capture auto-window in minutes — configurable via `JPMCDelayedCaptureWindowMinutes` site preference (JPMC default is 120) */
var DELAYED_CAPTURE_WINDOW_MINUTES = (function () {
    try {
        var Site = require('dw/system/Site');
        var pref = Site.getCurrent().getPreferences().getCustom().JPMCDelayedCaptureWindowMinutes;
        if (pref !== null && pref !== undefined && !isNaN(Number(pref)) && Number(pref) > 0) {
            return Number(pref);
        }
    } catch (e) { /* fall through to default */ }
    return 120;
}());

/**
 * Check whether the authorization timestamp is within the DELAYED capture window.
 * @param {string|null} authTimestamp
 * @returns {boolean}
 */
function isWithinDelayedCaptureWindow(authTimestamp) {
    if (!authTimestamp) return false;
    try {
        var authDate = new Date(authTimestamp);
        var now = new Date();
        var elapsedMinutes = (now.getTime() - authDate.getTime()) / 60000;
        return elapsedMinutes < DELAYED_CAPTURE_WINDOW_MINUTES;
    } catch (e) {
        Logger.warn('isWithinDelayedCaptureWindow: Could not parse timestamp "{0}": {1}', authTimestamp, e.message);
        return false;
    }
}

/**
 * Compute minutes remaining in the DELAYED capture window.
 * @param {string|null} authTimestamp
 * @returns {number}
 */
function delayedWindowMinutesRemaining(authTimestamp) {
    if (!authTimestamp) return 0;
    try {
        var authDate = new Date(authTimestamp);
        var now = new Date();
        var remaining = DELAYED_CAPTURE_WINDOW_MINUTES - ((now.getTime() - authDate.getTime()) / 60000);
        return remaining > 0 ? Math.ceil(remaining) : 0;
    } catch (e) {
        return 0;
    }
}

/**
 * Determine whether capture is allowed from the CSC interface.
 * @param {Object} paymentDetails
 * @returns {{allowed: boolean, reason: string|null}}
 */
function canCapture(paymentDetails) {
    var status = paymentDetails.paymentStatus;
    var method = paymentDetails.captureMethod;
    var remaining = paymentDetails.amounts.remainingAuth;

    if (status !== PAYMENT_STATUS.AUTHORIZED && status !== PAYMENT_STATUS.PARTIAL_CAPTURED) {
        return { allowed: false, reason: null };
    }
    if (remaining <= 0) {
        return { allowed: false, reason: Resource.msg('csc.info.capture.nothing', 'jpmcbm', 'No remaining authorized amount to capture.') };
    }

    if (method === 'MANUAL') {
        return { allowed: true, reason: null };
    }

    if (method === 'DELAYED') {
        if (isWithinDelayedCaptureWindow(paymentDetails.authTimestamp)) {
            return { allowed: true, reason: null };
        }
        return { allowed: false, reason: Resource.msg('csc.info.capture.delayed.expired', 'jpmcbm', 'Delayed capture window (120 min) has expired. Capture has been/will be auto-processed.') };
    }

    return { allowed: false, reason: null };
}

/**
 * Determine whether void is allowed from the CSC interface.
 * @param {Object} paymentDetails
 * @returns {{allowed: boolean, reason: string|null}}
 */
function canVoid(paymentDetails) {
    var status = paymentDetails.paymentStatus;
    var method = paymentDetails.captureMethod;
    var remaining = paymentDetails.amounts.remainingAuth;

    if (status === PAYMENT_STATUS.VOIDED || status === PAYMENT_STATUS.PARTIAL_VOID) {
        return { allowed: false, reason: null };
    }
    if (remaining <= 0) {
        return { allowed: false, reason: null };
    }
    if (status !== PAYMENT_STATUS.AUTHORIZED && status !== PAYMENT_STATUS.PARTIAL_CAPTURED) {
        return { allowed: false, reason: null };
    }

    if (method === 'MANUAL') {
        return { allowed: true, reason: null };
    }

    if (method === 'DELAYED') {
        if (isWithinDelayedCaptureWindow(paymentDetails.authTimestamp)) {
            return { allowed: true, reason: null };
        }
        return { allowed: false, reason: Resource.msg('csc.info.void.delayed.expired', 'jpmcbm', 'Delayed capture window (120 min) has expired. Void is no longer available; use Refund instead.') };
    }

    return { allowed: false, reason: null };
}

/**
 * Determine whether refund is allowed from the CSC interface.
 * @param {Object} paymentDetails
 * @returns {{allowed: boolean, reason: string|null, delayedAutoCapture: boolean}}
 */
function canRefund(paymentDetails) {
    var status = paymentDetails.paymentStatus;
    var method = paymentDetails.captureMethod;
    var remaining = paymentDetails.amounts.remainingRefundable;

    if (method === 'DELAYED'
        && status === PAYMENT_STATUS.AUTHORIZED
        && !isWithinDelayedCaptureWindow(paymentDetails.authTimestamp)) {
        var authorizedAmount = paymentDetails.amounts.authorized;
        if (authorizedAmount > 0) {
            return { allowed: true, reason: null, delayedAutoCapture: true };
        }
        return { allowed: false, reason: Resource.msg('csc.info.refund.nothing', 'jpmcbm', 'No remaining refundable amount.') };
    }

    if (method === 'DELAYED'
        && status === PAYMENT_STATUS.AUTHORIZED
        && isWithinDelayedCaptureWindow(paymentDetails.authTimestamp)) {
        return { allowed: false, reason: Resource.msg('csc.info.refund.delayed.window.active', 'jpmcbm', 'Refund is not yet available. Use Capture or Void while the delayed window is open.') };
    }

    var refundableStatuses = [
        PAYMENT_STATUS.AUTH_AND_CAPTURE,
        PAYMENT_STATUS.CAPTURED,
        PAYMENT_STATUS.PARTIAL_CAPTURED,
        PAYMENT_STATUS.PARTIAL_REFUNDED,
        PAYMENT_STATUS.VOIDED,
        PAYMENT_STATUS.PARTIAL_VOID
    ];

    if (refundableStatuses.indexOf(status) === -1) {
        return { allowed: false, reason: null };
    }
    if (remaining <= 0) {
        return { allowed: false, reason: Resource.msg('csc.info.refund.nothing', 'jpmcbm', 'No remaining refundable amount.') };
    }

    return { allowed: true, reason: null };
}

/**
 * Get capture history from payment transaction
 * @param {dw.order.PaymentTransaction} paymentTransaction
 * @returns {Array}
 */
function getCaptureHistory(paymentTransaction) {
    if (!paymentTransaction || !paymentTransaction.custom || !paymentTransaction.custom.jpmcCaptureHistory) {
        return [];
    }
    try {
        return JSON.parse(paymentTransaction.custom.jpmcCaptureHistory);
    } catch (e) {
        Logger.error('getCaptureHistory: Failed to parse capture history - {0}', e.message);
        return [];
    }
}

/**
 * Get refund history from payment transaction
 * @param {dw.order.PaymentTransaction} paymentTransaction
 * @returns {Array}
 */
function getRefundHistory(paymentTransaction) {
    if (!paymentTransaction || !paymentTransaction.custom || !paymentTransaction.custom.jpmcRefundHistory) {
        return [];
    }
    try {
        return JSON.parse(paymentTransaction.custom.jpmcRefundHistory);
    } catch (e) {
        Logger.error('getRefundHistory: Failed to parse refund history - {0}', e.message);
        return [];
    }
}

/**
 * Get void history from payment transaction
 * @param {dw.order.PaymentTransaction} paymentTransaction
 * @returns {Array}
 */
function getVoidHistory(paymentTransaction) {
    if (!paymentTransaction || !paymentTransaction.custom || !paymentTransaction.custom.jpmcVoidHistory) {
        return [];
    }
    try {
        return JSON.parse(paymentTransaction.custom.jpmcVoidHistory);
    } catch (e) {
        Logger.error('getVoidHistory: Failed to parse void history - {0}', e.message);
        return [];
    }
}

/**
 * Mask card number - show only last 4 digits
 * @param {string} cardNumber
 * @returns {string}
 */
function maskCardNumber(cardNumber) {
    if (!cardNumber || cardNumber.length < 4) {
        return '****';
    }
    var lastFour = cardNumber.substring(cardNumber.length - 4);
    var masked = '';
    for (var i = 0; i < cardNumber.length - 4; i++) {
        masked += '*';
    }
    return masked + lastFour;
}

/**
 * Get payment method display name
 * @param {string} paymentMethod
 * @returns {string}
 */
function getPaymentMethodName(paymentMethod) {
    var constants = require('*/cartridge/scripts/helpers/jpmcConstants');
    if (!paymentMethod) return constants.PAYMENT_METHOD_DISPLAY_UNKNOWN;
    if (paymentMethod.indexOf('GOOGLE') !== -1) return constants.PAYMENT_METHOD_DISPLAY_GOOGLE_PAY;
    if (paymentMethod.indexOf('APPLE') !== -1) return constants.PAYMENT_METHOD_DISPLAY_APPLE_PAY;
    if (paymentMethod.indexOf('CREDIT') !== -1 || paymentMethod.indexOf('CARD') !== -1) return constants.PAYMENT_METHOD_DISPLAY_CREDIT_CARD;
    return paymentMethod;
}

/**
 * Check if payment method is supported
 * @param {string} paymentMethod
 * @returns {boolean}
 */
function isSupportedPaymentMethod(paymentMethod) {
    if (!paymentMethod) return false;
    var method = paymentMethod.toUpperCase();
    return (
        method.indexOf('CREDIT') !== -1 ||
        method.indexOf('CARD') !== -1 ||
        method.indexOf('GOOGLE') !== -1 ||
        method.indexOf('APPLE') !== -1
    );
}

module.exports = {
    PAYMENT_STATUS: PAYMENT_STATUS,
    PAYMENT_STATUS_LABELS: PAYMENT_STATUS_LABELS,
    AMOUNT_REGEX: AMOUNT_REGEX,
    DELAYED_CAPTURE_WINDOW_MINUTES: DELAYED_CAPTURE_WINDOW_MINUTES,
    isWithinDelayedCaptureWindow: isWithinDelayedCaptureWindow,
    delayedWindowMinutesRemaining: delayedWindowMinutesRemaining,
    canCapture: canCapture,
    canVoid: canVoid,
    canRefund: canRefund,
    getCaptureHistory: getCaptureHistory,
    getRefundHistory: getRefundHistory,
    getVoidHistory: getVoidHistory,
    maskCardNumber: maskCardNumber,
    getPaymentMethodName: getPaymentMethodName,
    isSupportedPaymentMethod: isSupportedPaymentMethod
};
