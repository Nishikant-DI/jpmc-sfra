'use strict';

var base = require('base/paymentInstruments/paymentInstruments');
var cleave = require('base/components/cleave');
var formValidation = require('base/components/formValidation');
var jpmcPie = require('../jpmc/jpmcPie');

/**
 * Encrypts card data before form submission
 * @returns {boolean} True if encryption was successful
 */
function encryptCardData() {
    return jpmcPie.encryptAndStore('#cardNumber', '#securityCode', '#encryptedData');
}

/**
 * Overrides submitPayment to add PIE encryption before form submission
 */
base.submitPayment = function () {
    $('form.payment-form').submit(function (e) {
        e.preventDefault();
        var $form = $(this);

        // Clear any previous error messages
        $('.card-body').find('.alert-danger').remove();

        // Encrypt card data before submission
        if (!encryptCardData()) {
            // Show error if encryption fails
            var errorHtml = '<div class="alert alert-danger" role="alert">' +
                'Unable to encrypt card data. Please ensure all card details are entered correctly.' +
                '</div>';
            $('.card-body').prepend(errorHtml);
            return false;
        }

        $form.spinner().start();
        $('form.payment-form').trigger('payment:submit', e);

        var formData = cleave.serializeData($form);

        $.ajax({
            url: $form.attr('action'),
            type: 'post',
            dataType: 'json',
            data: formData,
            success: function (data) {
                $form.spinner().stop();
                if (!data.success) {
                    formValidation($form, data);
                } else {
                    window.location.href = data.redirectUrl;
                }
            },
            error: function (err) {
                $form.spinner().stop();
                if (err.responseJSON && err.responseJSON.redirectUrl) {
                    window.location.href = err.responseJSON.redirectUrl;
                }
            }
        });
        return false;
    });
};

module.exports = base;
