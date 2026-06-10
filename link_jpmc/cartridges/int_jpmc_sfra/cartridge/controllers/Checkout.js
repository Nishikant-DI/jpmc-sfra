'use strict';

var server = require('server');
server.extend(module.superModule);

/**
 * Checkout-Begin : JPMC extension to inject PIE encryption URLs and filter customer payment instruments by merchant ID
 * @name Checkout-Begin
 * @function
 * @memberof Checkout
 * @param {middleware} - server.append
 * @param {httpparameter} - req - HTTP request
 * @param {httpparameter} - res - HTTP response
 * @param {Function} next - next middleware function
 */
server.append('Begin', function (req, res, next) {
    var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
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

    var pieGetKeyUrl = resolvedConfig.pieGetKeyUrl || '';
    var pieEncryptionUrl = resolvedConfig.pieEncryptionUrl || '';
    var pieKey = resolvedConfig.pieKey || '';
    var jpmcPieGetKeyUrl = (pieGetKeyUrl && pieKey)
        ? pieGetKeyUrl + '/' + pieKey + '/getkey.js' : '';

    res.setViewData({
        customer: filteredCustomer,
        jpmcPieGetKeyUrl: jpmcPieGetKeyUrl,
        jpmcPieEncryptionUrl: pieEncryptionUrl
    });


    return next();
});

module.exports = server.exports();

