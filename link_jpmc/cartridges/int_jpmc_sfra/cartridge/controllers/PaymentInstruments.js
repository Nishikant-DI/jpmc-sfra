'use strict';

var server = require('server');
server.extend(module.superModule);


server.append('List', function (req, res, next) {
    var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
    var CustomerMgr = require('dw/customer/CustomerMgr');

    var resolvedConfig = JPMCMerchantResolver.resolve();
    var currentMerchantId = resolvedConfig && resolvedConfig.merchantId;

    if (!currentMerchantId) {
        return next();
    }

    var viewData = res.getViewData();
    if (!viewData.paymentInstruments || !viewData.paymentInstruments.length) {
        return next();
    }

    var customer = CustomerMgr.getCustomerByCustomerNumber(req.currentCustomer.profile.customerNo);
    if (!customer) {
        return next();
    }

    var rawPIs = customer.getProfile().getWallet().getPaymentInstruments().toArray();
    var merchantById = {};
    for (var i = 0; i < rawPIs.length; i++) {
        merchantById[rawPIs[i].UUID] = rawPIs[i].custom.jpmcMerchantId || null;
    }

    viewData.paymentInstruments = viewData.paymentInstruments.filter(function (pi) {
        var piMid = merchantById[pi.UUID];
        return !piMid || piMid === currentMerchantId;
    });
    viewData.noSavedPayments = viewData.paymentInstruments.length === 0;
    res.setViewData(viewData);

    return next();
});

server.append('SavePayment', function (req, res, next) {
    this.on('route:BeforeComplete', function () {
        var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
        var CustomerMgr = require('dw/customer/CustomerMgr');
        var Transaction = require('dw/system/Transaction');

        var resolvedConfig = JPMCMerchantResolver.resolve();
        if (!resolvedConfig || !resolvedConfig.merchantId) {
            return;
        }

        var customer = CustomerMgr.getCustomerByCustomerNumber(req.currentCustomer.profile.customerNo);
        if (!customer) { return; }

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

server.append('AddPayment', function (req, res, next) {
    var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
    var Site = require('dw/system/Site');

    var resolvedConfig = JPMCMerchantResolver.resolve();
    res.setViewData({
        jpmcPieGetKeyUrl: resolvedConfig.pieGetKeyUrl || Site.getCurrent().getCustomPreferenceValue('JPMCGetKeyUrl') || '',
        jpmcPieEncryptionUrl: resolvedConfig.pieEncryptionUrl || Site.getCurrent().getCustomPreferenceValue('JPMCEncryptionUrl') || ''
    });

    return next();
});

module.exports = server.exports();
