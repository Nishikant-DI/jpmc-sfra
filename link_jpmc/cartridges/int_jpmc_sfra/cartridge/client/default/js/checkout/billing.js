'use strict';

var base = require('base/checkout/billing');
var jpmcPie = require('../jpmc/jpmcPie');
var kount = require('../jpmc/kount');

/**
 * Encrypts card data using JPMC PIE and stores in hidden field
 */
function encryptCardData() {
    jpmcPie.encryptAndStore('.cardNumber', '.securityCode', '.encryptedData');
}

// Override santitizeForm to add encryption before serialization
var baseSanitizeForm = base.santitizeForm;
base.santitizeForm = function () {
    $('body').on('checkout:serializeBilling', function (e, data) {
        if (data.form && data.form.filter('.cardNumber').length) {
            encryptCardData();
        }
    });
    
    if (baseSanitizeForm) {
        baseSanitizeForm();
    }
};

/**
 * Updates the payment information in checkout, based on the supplied order model
 * Extended to support Google Pay
 * @param {Object} order - checkout model to use as basis of new truth
 */
function updatePaymentInformation(order) {
    var $paymentSummary = $('.payment-details');
    var htmlToAppend = '';

    if (order.billing.payment && order.billing.payment.selectedPaymentInstruments
        && order.billing.payment.selectedPaymentInstruments.length > 0) {
        var instrument = order.billing.payment.selectedPaymentInstruments[0];

        if (instrument.paymentMethod === 'JPMC_GOOGLE_PAY') {
            // Google Pay display
            htmlToAppend += '<div class="google-pay-type"><span>Google Pay</span></div>';
        } else {
            // Credit card display (default)
            htmlToAppend += '<span>' + order.resources.cardType + ' '
                + instrument.type
                + '</span><div>'
                + instrument.maskedCreditCardNumber
                + '</div><div><span>'
                + order.resources.cardEnding + ' '
                + instrument.expirationMonth
                + '/' + instrument.expirationYear
                + '</span></div>';
        }
    }

    $paymentSummary.empty().append(htmlToAppend);
}

// Override the method in base
base.methods.updatePaymentInformation = updatePaymentInformation;

/**
 * Initialize Kount fraud detection on checkout page load
 * Only if fraud check is enabled via site preference
 */
$(document).ready(function () {
    // Check if fraud check is enabled before initializing Kount
    if (window.jpmcFraudCheckEnabled === true) {
        kount.init();
    }
});

/**
 * Re-initialize Kount when returning to payment stage (editing payment)
 * This fires when user clicks edit button from order review/place order stage
 * Only if fraud check is enabled
 */
$('body').on('click', '.payment-summary .edit-button', function () {
    if (window.jpmcFraudCheckEnabled === true) {
        // Small delay to ensure DOM is updated before initializing
        setTimeout(function () {
            kount.refresh();
        }, 100);
    }
});

/**
 * Re-initialize Kount when checkout view updates (AJAX navigation)
 * This catches stage transitions that update the payment form
 * Only if fraud check is enabled
 */
$('body').on('checkout:updateCheckoutView', function (e, data) {
    if (window.jpmcFraudCheckEnabled === true) {
        // Only refresh if we're on the payment stage
        var currentStage = $('.data-checkout-stage').attr('data-checkout-stage');
        if (currentStage === 'payment' && $('.payment-form').is(':visible')) {
            kount.refresh();
        }
    }
});

module.exports = base;
