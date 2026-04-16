'use strict';

var processInclude = require('base/util');

$(document).ready(function () {
    processInclude(require('base/checkout/checkout'));
    processInclude(require('./checkout/billing'));
    processInclude(require('./jpmc/googlePay'));
    if (window.dw
        && window.dw.applepay
        && window.ApplePaySession
        && window.ApplePaySession.canMakePayments()) {
        $('body').addClass('apple-pay-enabled');
    }
});
