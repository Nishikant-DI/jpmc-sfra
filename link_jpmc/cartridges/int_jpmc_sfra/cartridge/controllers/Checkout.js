'use strict';

var server = require('server');
server.extend(module.superModule);

server.append('Begin', function (req, res, next) {
    var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
    var Site = require('dw/system/Site');
    var AccountModel = require('*/cartridge/models/account');

    var resolvedConfig = JPMCMerchantResolver.resolve();
    var currentMerchantId = resolvedConfig ? resolvedConfig.merchantId : null;

    var viewData = res.getViewData();
    var filteredCustomer = viewData && viewData.customer;

    if (filteredCustomer && req.currentCustomer.raw.registered) {
        filteredCustomer = new AccountModel(
            req.currentCustomer,
            filteredCustomer.preferredAddress,
            null,
            currentMerchantId
        );
    }

    res.setViewData({
        customer: filteredCustomer,
        jpmcPieGetKeyUrl: resolvedConfig.pieGetKeyUrl || Site.getCurrent().getCustomPreferenceValue('JPMCGetKeyUrl') || '',
        jpmcPieEncryptionUrl: resolvedConfig.pieEncryptionUrl || Site.getCurrent().getCustomPreferenceValue('JPMCEncryptionUrl') || ''
    });

    return next();
});

module.exports = server.exports();

