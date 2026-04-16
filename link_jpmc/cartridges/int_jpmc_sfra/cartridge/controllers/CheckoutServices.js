'use strict';

var server = require('server');
server.extend(module.superModule);

server.append('SubmitPayment', function (req, res, next) {
    this.on('route:BeforeComplete', function (req, res) { // eslint-disable-line no-shadow
        var viewData = res.getViewData();
        if (viewData.error) {
            return;
        }

        var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
        var AccountModel = require('*/cartridge/models/account');
        var renderTemplateHelper = require('*/cartridge/scripts/renderTemplateHelper');

        var resolvedConfig = JPMCMerchantResolver.resolve();
        var currentMerchantId = resolvedConfig ? resolvedConfig.merchantId : null;

        if (!currentMerchantId) {
            return;
        }

        var filteredModel = new AccountModel(req.currentCustomer, null, null, currentMerchantId);
        viewData.customer = filteredModel;

        if (req.currentCustomer.raw.registered) {
            viewData.renderedPaymentInstruments = filteredModel.customerPaymentInstruments.length > 0
                ? renderTemplateHelper.getRenderedHtml(
                    { customer: filteredModel },
                    'checkout/billing/storedPaymentInstruments'
                )
                : null;
        }
    });

    return next();
});

module.exports = server.exports();

