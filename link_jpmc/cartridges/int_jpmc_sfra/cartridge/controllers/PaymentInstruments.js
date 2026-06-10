'use strict';

var server = require('server');

server.extend(module.superModule);

var AU_LOGGER_NAME = 'PaymentInstrumentsController';

/**
 * getLogger - Returns the Account Updater logger instance
 * @returns {dw.system.Logger} logger instance
 */
function getLogger() {
    return require('dw/system/Logger').getLogger('AccountUpdater', AU_LOGGER_NAME);
}

/**
 * getAuthenticatedCustomer
 * @param {Object} req - request object
 * @returns {dw.customer.Customer|null} customer
 */
function getAuthenticatedCustomer(req) {
    if (!req.currentCustomer.raw.authenticated || !req.currentCustomer.raw.registered) {
        return null;
    }
    var CustomerMgr = require('dw/customer/CustomerMgr');
    var customer = CustomerMgr.getCustomerByCustomerNumber(req.currentCustomer.profile.customerNo);
    return (customer && customer.getProfile()) ? customer : null;
}

/**
 * getCreditCardInstruments
 * @param {dw.customer.Customer} customer - customer
 * @returns {dw.util.Collection} payment instruments
 */
function getCreditCardInstruments(customer) {
    var PaymentInstrument = require('dw/order/PaymentInstrument');
    var wallet = customer.getProfile().getWallet();
    return wallet ? wallet.getPaymentInstruments(PaymentInstrument.METHOD_CREDIT_CARD) : null;
}

/**
 * PaymentInstruments-SavePayment : Registers the most recently saved card with Account Updater when notifications are enabled
 * @name PaymentInstruments-SavePayment
 * @function
 * @memberof PaymentInstruments
 * @param {middleware} - server.append
 */
server.append('SavePayment', function (req, res, next) {
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');

    if (!JPMCConfig.isAccountUpdaterNotificationsEnabled()) {
        return next();
    }

    var existingUUIDs = {};
    var preCustomer = getAuthenticatedCustomer(req);
    if (preCustomer) {
        var existingPIs = getCreditCardInstruments(preCustomer);
        if (existingPIs) {
            var preIter = existingPIs.iterator();
            while (preIter.hasNext()) {
                existingUUIDs[preIter.next().getUUID()] = true;
            }
        }
    }

    this.on('route:BeforeComplete', function (/* req, res */) {
        var viewData = res.getViewData();
        if (!viewData || !viewData.success) {
            return;
        }

        var customer = getAuthenticatedCustomer(req);
        if (!customer) {
            return;
        }

        try {
            var paymentInstruments = getCreditCardInstruments(customer);
            if (!paymentInstruments || paymentInstruments.length === 0) {
                return;
            }

            var newPI = null;
            var iter = paymentInstruments.iterator();
            while (iter.hasNext()) {
                var pi = iter.next();
                if (!existingUUIDs[pi.getUUID()]) {
                    newPI = pi;
                    break;
                }
            }

            if (!newPI || !newPI.getCreditCardToken()) {
                return;
            }

            var Transaction = require('dw/system/Transaction');
            var accountUpdaterHelper = require('*/cartridge/scripts/helpers/AccountUpdaterHelper');
            var mri = newPI.getUUID() + '-CN-' + req.currentCustomer.profile.customerNo;

            Transaction.wrap(function () {
                newPI.custom.jpmcMerchantRecordIdentifier = mri;
            });

            var registerResult = accountUpdaterHelper.registerCard(
                newPI.getCreditCardToken(),
                newPI.getCreditCardExpirationMonth(),
                newPI.getCreditCardExpirationYear(),
                mri
            );

            if (!registerResult.success) {
                getLogger().info('SavePayment: Registration failed - {0}', registerResult.error);
            }
        } catch (e) {
            getLogger().error('SavePayment: {0}', e.message || String(e));
        }
    });

    return next();
});

/**
 * PaymentInstruments-List : Filters payment instruments to show only those belonging to the current merchant ID
 * @name PaymentInstruments-List
 * @function
 * @memberof PaymentInstruments
 * @param {middleware} - server.append
 */
server.append('List', function (req, res, next) {
    var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
    var resolvedConfig = JPMCMerchantResolver.resolve();
    var currentMerchantId = resolvedConfig && resolvedConfig.merchantId;

    if (!currentMerchantId) {
        return next();
    }

    var viewData = res.getViewData();
    if (!viewData.paymentInstruments || !viewData.paymentInstruments.length) {
        return next();
    }

    var CustomerMgr = require('dw/customer/CustomerMgr');
    var customer = CustomerMgr.getCustomerByCustomerNumber(req.currentCustomer.profile.customerNo);
    if (!customer) {
        return next();
    }

    var rawPIs = customer.getProfile().getWallet().getPaymentInstruments().toArray();
    var merchantByUUID = {};
    for (var i = 0; i < rawPIs.length; i++) {
        merchantByUUID[rawPIs[i].UUID] = rawPIs[i].custom.jpmcMerchantId || null;
    }

    viewData.paymentInstruments = viewData.paymentInstruments.filter(function (pi) {
        var piMid = merchantByUUID[pi.UUID];
        return !piMid || piMid === currentMerchantId;
    });
    viewData.noSavedPayments = viewData.paymentInstruments.length === 0;
    res.setViewData(viewData);

    return next();
});

/**
 * Stamps newly saved PIs with the active merchantId.
 */
server.append('SavePayment', function (req, res, next) {
    this.on('route:BeforeComplete', function () {
        var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
        var resolvedConfig = JPMCMerchantResolver.resolve();
        if (!resolvedConfig || !resolvedConfig.merchantId) {
            return;
        }

        var CustomerMgr = require('dw/customer/CustomerMgr');
        var customer = CustomerMgr.getCustomerByCustomerNumber(req.currentCustomer.profile.customerNo);
        if (!customer) {
            return;
        }

        var Transaction = require('dw/system/Transaction');
        var rawPIs = customer.getProfile().getWallet().getPaymentInstruments().toArray();

        Transaction.wrap(function () {
            for (var i = 0; i < rawPIs.length; i++) {
                if (!rawPIs[i].custom.jpmcMerchantId) {
                    rawPIs[i].custom.jpmcMerchantId = resolvedConfig.merchantId;
                }
            }
        });
    });

    return next();
});

/**
 * Exposes PIE URLs on the Add Payment view.
 */
server.append('AddPayment', function (req, res, next) {
    var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
    var resolvedConfig = JPMCMerchantResolver.resolve();

    var pieGetKeyUrl = resolvedConfig.pieGetKeyUrl || '';
    var pieEncryptionUrl = resolvedConfig.pieEncryptionUrl || '';
    var pieKey = resolvedConfig.pieKey || '';
    var jpmcPieGetKeyUrl = (pieGetKeyUrl && pieKey)
        ? pieGetKeyUrl + '/' + pieKey + '/getkey.js' : '';

    res.setViewData({
        jpmcPieGetKeyUrl: jpmcPieGetKeyUrl,
        jpmcPieEncryptionUrl: pieEncryptionUrl
    });

    return next();
});

/**
 * Unregisters the card from Account Updater before it is deleted from the wallet.
 */
server.prepend('DeletePayment', function (req, res, next) {
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');

    if (!JPMCConfig.isAccountUpdaterNotificationsEnabled()) {
        return next();
    }

    var UUID = req.querystring.UUID;
    if (!UUID) {
        return next();
    }

    var customer = getAuthenticatedCustomer(req);
    if (!customer) {
        return next();
    }

    try {
        var paymentInstruments = getCreditCardInstruments(customer);
        if (!paymentInstruments) {
            return next();
        }

        var iterator = paymentInstruments.iterator();
        var cardToken = null;

        while (iterator.hasNext()) {
            var pi = iterator.next();
            if (pi.getUUID() === UUID && pi.getCreditCardToken()) {
                cardToken = pi.getCreditCardToken();
                break;
            }
        }

        if (cardToken) {
            var accountUpdaterHelper = require('*/cartridge/scripts/helpers/AccountUpdaterHelper');
            var unregisterResult = accountUpdaterHelper.unregisterCard(cardToken);
            if (!unregisterResult.success) {
                getLogger().warn('DeletePayment: Unregistration failed - {0}', unregisterResult.error);
            }
        }
    } catch (e) {
        getLogger().error('DeletePayment: {0}', e.message || String(e));
    }

    return next();
});

module.exports = server.exports();
