'use strict';

var Transaction = require('dw/system/Transaction');

var baseCheckoutHelpers =
    module.superModule ||
    require('*/cartridge/scripts/checkout/checkoutHelpers');

/**
 * saves payment instrument to customers wallet
 * @param {Object} billingData
 * @param {dw.order.Basket} currentBasket
 * @param {dw.customer.Customer} customer
 * @returns {dw.customer.CustomerPaymentInstrument}
 */
baseCheckoutHelpers.savePaymentInstrumentToWallet = function savePaymentInstrumentToWallet(
    billingData,
    currentBasket,
    customer
) {
    var PaymentInstrument = require('dw/order/PaymentInstrument');
    var wallet = customer.getProfile().getWallet();

    return Transaction.wrap(function () {
        var verifiedCardToken = session.privacy.jpmcCardSafeTechToken;

        var storedPaymentInstrument = wallet.createPaymentInstrument(
            PaymentInstrument.METHOD_CREDIT_CARD
        );

        storedPaymentInstrument.setCreditCardNumber(
            billingData.paymentInformation.cardNumber.value
        );
        storedPaymentInstrument.setCreditCardType(
            billingData.paymentInformation.cardType.value
        );
        storedPaymentInstrument.setCreditCardExpirationMonth(
            billingData.paymentInformation.expirationMonth.value
        );
        storedPaymentInstrument.setCreditCardExpirationYear(
            billingData.paymentInformation.expirationYear.value
        );

        storedPaymentInstrument.setCreditCardToken(
            verifiedCardToken
        );
        delete session.privacy.jpmcCardSafeTechToken;
        return storedPaymentInstrument;
    });
};

module.exports = baseCheckoutHelpers;
