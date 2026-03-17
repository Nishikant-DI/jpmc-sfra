'use strict';

var GPAY_SCRIPT_URL = 'https://pay.google.com/gp/p/js/pay.js';
var API_VERSION = { apiVersion: 2, apiVersionMinor: 0 };

var gpayConfig = null;
var paymentsClient = null;

function baseCardPaymentMethod() {
    return {
        type: 'CARD',
        parameters: {
            allowedAuthMethods: gpayConfig.allowedAuthMethods,
            allowedCardNetworks: gpayConfig.allowedCardNetworks
        }
    };
}

function tokenizedCardPaymentMethod() {
    return Object.assign({}, baseCardPaymentMethod(), {
        tokenizationSpecification: {
            type: 'PAYMENT_GATEWAY',
            parameters: {
                gateway: gpayConfig.gateway,
                gatewayMerchantId: gpayConfig.gatewayMerchantId
            }
        }
    });
}

function buildPaymentDataRequest() {
    var request = Object.assign({}, API_VERSION, {
        allowedPaymentMethods: [tokenizedCardPaymentMethod()],
        transactionInfo: {
            totalPriceStatus: 'FINAL',
            totalPrice: gpayConfig.totalPrice,
            currencyCode: gpayConfig.currencyCode
        },
        merchantInfo: {
            merchantName: gpayConfig.merchantName
        },
        callbackIntents: ['PAYMENT_AUTHORIZATION']
    });

    if (gpayConfig.environment === 'PRODUCTION' && gpayConfig.googlePayMerchantId) {
        request.merchantInfo.merchantId = gpayConfig.googlePayMerchantId;
    }

    return request;
}

function getPaymentsClient() {
    if (!paymentsClient) {
        paymentsClient = new google.payments.api.PaymentsClient({
            environment: gpayConfig.environment,
            paymentDataCallbacks: {
                onPaymentAuthorized: onPaymentAuthorized
            }
        });
    }
    return paymentsClient;
}

function showStatus(state) {
    var $status = $('#googlepay-status');
    var $error = $('#googlepay-error');
    var $message = $('.googlepay-message');
    var $buttonWrapper = $('#googlepay-button-wrapper');

    if (state === 'authorized') {
        $status.removeClass('d-none');
        $error.addClass('d-none');
        $message.addClass('d-none');
        $buttonWrapper.addClass('d-none');
    } else if (state === 'error') {
        $status.addClass('d-none');
        $error.removeClass('d-none');
        $message.addClass('d-none');
    } else {
        $status.addClass('d-none');
        $error.addClass('d-none');
        $message.removeClass('d-none');
        $buttonWrapper.removeClass('d-none');
    }
}

/**
 * Posts the GPay token to the server (session.privacy), then auto-advances checkout.
 */
function storeTokenOnServer(token) {
    var $wrapper = $('#googlepay-button-wrapper');
    $.ajax({
        url: $wrapper.data('store-url'),
        type: 'POST',
        dataType: 'json',
        data: { token: token, csrf_token: $('input[name="csrf_token"]').val() },
        success: function (data) {
            if (data.error) { showStatus('error'); return; }
            showStatus('authorized');
            $.spinner().start();
            $('button.submit-payment').trigger('click');
        },
        error: function () { showStatus('error'); }
    });
}

function onPaymentAuthorized(paymentData) {
    return new Promise(function (resolve) {
        try {
            var token = paymentData.paymentMethodData.tokenizationData.token;
            if (!token) {
                resolve({ transactionState: 'ERROR', error: { intent: 'PAYMENT_AUTHORIZATION', message: 'No payment token received', reason: 'PAYMENT_DATA_INVALID' } });
                return;
            }
            storeTokenOnServer(token);
            resolve({ transactionState: 'SUCCESS' });
        } catch (e) {
            resolve({ transactionState: 'ERROR', error: { intent: 'PAYMENT_AUTHORIZATION', message: 'Payment processing error', reason: 'PAYMENT_DATA_INVALID' } });
        }
    });
}

function onGooglePayButtonClicked() {
    showStatus('none');
    // Use totalPrice from gpayConfig (set during init, refreshed on basket updates).
    // loadPaymentData must be called synchronously within the user-gesture.
    getPaymentsClient().loadPaymentData(buildPaymentDataRequest()).catch(function (err) {
        if (err.statusCode !== 'CANCELED') { showStatus('error'); }
    });
}

/**
 * Clears client state and tells the server to drop any stored session token.
 * Only fires the server call if GPay was actually initialised (paymentsClient set).
 */
function clearGooglePayState() {
    if (!paymentsClient) return;
    paymentsClient = null;
    showStatus('none');
    var $wrapper = $('#googlepay-button-wrapper');
    var clearUrl = $wrapper.data('clear-url');
    if (clearUrl) {
        $.ajax({ url: clearUrl, type: 'POST', dataType: 'json', data: { csrf_token: $('input[name="csrf_token"]').val() } });
    }
}

function renderButton() {
    var button = getPaymentsClient().createButton({
        onClick: onGooglePayButtonClicked,
        allowedPaymentMethods: [baseCardPaymentMethod()]
    });
    $('#googlepay-button-wrapper').empty().append(button);
}

function loadScript(callback) {
    if (typeof google !== 'undefined' && google.payments) { callback(); return; }
    var script = document.createElement('script');
    script.src = GPAY_SCRIPT_URL;
    script.async = true;
    script.onload = callback;
    script.onerror = function () { /* graceful — button won't appear */ };
    document.head.appendChild(script);
}

function initGooglePay() {
    var $wrapper = $('#googlepay-button-wrapper');
    if (!$wrapper.length) return;

    var configUrl = $wrapper.data('config-url');
    if (!configUrl) return;

    paymentsClient = null;
    showStatus('none');

    $.ajax({
        url: configUrl,
        type: 'GET',
        dataType: 'json',
        success: function (data) {
            if (data.error || !data.enabled) return;

            // gpayConfig is set from this response; totalPrice is already current.
            gpayConfig = data;

            loadScript(function () {
                getPaymentsClient()
                    .isReadyToPay(Object.assign({}, API_VERSION, { allowedPaymentMethods: [baseCardPaymentMethod()] }))
                    .then(function (response) {
                        if (response.result) { renderButton(); }
                    })
                    .catch(function () { /* graceful */ });
            });
        }
    });
}

/**
 * Re-fetches basket total into gpayConfig. Called when the basket changes after
 * the button is already rendered (e.g. coupon applied, shipping updated).
 */
function refreshBasketTotal() {
    var configUrl = $('#googlepay-button-wrapper').data('config-url');
    if (!configUrl || !gpayConfig) return;
    $.ajax({
        url: configUrl,
        type: 'GET',
        dataType: 'json',
        success: function (data) {
            if (!data.error && data.enabled && data.totalPrice) {
                gpayConfig.totalPrice = data.totalPrice;
                gpayConfig.currencyCode = data.currencyCode;
            }
        }
    });
}

function setupEventListeners() {
    // Payment tab activated — init GPay or clear it, toggle submit button.
    $('body').on('click', '.payment-options .nav-item', function () {
        if ($(this).data('method-id') === 'JPMC_GOOGLE_PAY') {
            initGooglePay();
            $('button.submit-payment').hide();
        } else {
            clearGooglePayState();
            $('button.submit-payment').show();
        }
    });

    // Stage back-navigation — discard stale token.
    $('body').on('click', '.customer-summary .edit-button, .shipping-summary .edit-button', function () {
        clearGooglePayState();
    });

    // Payment stage re-entered from order review.
    $('body').on('click', '.payment-summary .edit-button', function () {
        clearGooglePayState();
        if ($('.googlepay-tab').hasClass('active')) {
            initGooglePay();
            $('button.submit-payment').hide();
        }
    });

    // Browser back/forward.
    $(window).on('popstate', function () { clearGooglePayState(); });

    // Checkout view re-rendered (stage transition, basket update).
    $('body').on('checkout:updateCheckoutView', function () {
        // If GPay triggered submit-payment and the view has now moved to placeOrder,
        // the spinner started in storeTokenOnServer must be stopped here.
        $.spinner().stop();

        var $wrapper = $('#googlepay-button-wrapper');
        if (!$wrapper.length) return;
        if (!$wrapper.children().length) {
            initGooglePay();
        } else if (gpayConfig) {
            refreshBasketTotal();
        }
    });
}

module.exports = {
    init: function () {
        initGooglePay();
        setupEventListeners();
    }
};
