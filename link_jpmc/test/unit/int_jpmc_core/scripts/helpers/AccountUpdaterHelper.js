'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('accountUpdaterHelper', function () {
    var accountUpdaterHelper;
    var LoggerMock;
    var TransactionMock;

    beforeEach(function () {
        LoggerMock = require('../../../../../test/mocks/dw/system/Logger');
        TransactionMock = require('../../../../../test/mocks/dw/system/Transaction');

        LoggerMock.resetAllLoggers();
        TransactionMock.reset();

        accountUpdaterHelper = proxyquire(
            '../../../../../cartridges/int_jpmc_core/cartridge/scripts/helpers/AccountUpdaterHelper',
            {
                'dw/system/Logger': LoggerMock,
                'dw/system/Transaction': TransactionMock
            }
        );
    });

    // ─── handleRTAUResponse ──────────────────────────────────────────────────

    describe('handleRTAUResponse', function () {
        it('should return not updated when no accountUpdater block', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            var result = accountUpdaterHelper.handleRTAUResponse(pi, { paymentMethodType: { card: {} } });
            assert.isFalse(result.updated);
            assert.isNull(result.action);
        });

        it('should return not updated for MATCH_NO_UPDATE', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            var result = accountUpdaterHelper.handleRTAUResponse(pi, { accountUpdater: { accountUpdaterResponse: 'MATCH_NO_UPDATE' } });
            assert.isFalse(result.updated);
            assert.equal(result.action, 'MATCH_NO_UPDATE');
        });

        it('should return not updated for NO_MATCH_PARTICIPATING_BIN', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            assert.isFalse(accountUpdaterHelper.handleRTAUResponse(pi, { accountUpdater: { accountUpdaterResponse: 'NO_MATCH_PARTICIPATING_BIN' } }).updated);
        });

        it('should return not updated for NO_MATCH_NON_PARTICIPATING_BIN', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            assert.isFalse(accountUpdaterHelper.handleRTAUResponse(pi, { accountUpdater: { accountUpdaterResponse: 'NO_MATCH_NON_PARTICIPATING_BIN' } }).updated);
        });

        it('should update token and expiry via accountNumber field', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            pi.setCreditCardToken('old-token');
            var result = accountUpdaterHelper.handleRTAUResponse(pi, {
                accountUpdater: { accountUpdaterResponse: 'NEW_ACCOUNT_AND_EXPIRY', accountNumber: 'new-token-rtau', newAccountExpiry: { month: '3', year: '2030' } }
            });
            assert.isTrue(result.updated);
            assert.equal(pi.getCreditCardToken(), 'new-token-rtau');
            assert.equal(pi.getCreditCardExpirationMonth(), 3);
            assert.equal(pi.getCreditCardExpirationYear(), 2030);
        });

        it('should find token from paymentTokens SUCCESS entry', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            pi.setCreditCardToken('old-tok');
            var result = accountUpdaterHelper.handleRTAUResponse(pi, {
                accountUpdater: { accountUpdaterResponse: 'NEW_ACCOUNT_AND_EXPIRY', newAccountExpiry: { month: '5', year: '2031' } },
                paymentMethodType: {
                    card: {
                        paymentTokens: [
                            { tokenNumber: 'failed-token', responseStatus: 'FAILURE' },
                            { tokenNumber: 'success-token-123', responseStatus: 'SUCCESS' }
                        ]
                    }
                }
            });
            assert.isTrue(result.updated);
            assert.equal(pi.getCreditCardToken(), 'success-token-123');
        });

        it('should skip non-SUCCESS paymentTokens and still update expiry', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            pi.setCreditCardToken('orig-token');
            var result = accountUpdaterHelper.handleRTAUResponse(pi, {
                accountUpdater: { accountUpdaterResponse: 'NEW_ACCOUNT_AND_EXPIRY', newAccountExpiry: { month: '1', year: '2032' } },
                paymentMethodType: { card: { paymentTokens: [{ tokenNumber: 'bad-token', responseStatus: 'FAILURE' }] } }
            });
            assert.isTrue(result.updated);
            assert.equal(pi.getCreditCardToken(), 'orig-token');
            assert.equal(pi.getCreditCardExpirationMonth(), 1);
        });

        it('should return not updated when no newToken and no expiry', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            var result = accountUpdaterHelper.handleRTAUResponse(pi, { accountUpdater: { accountUpdaterResponse: 'SOME_OTHER_CODE' } });
            assert.isFalse(result.updated);
            assert.equal(result.action, 'SOME_OTHER_CODE');
        });

        it('should return not updated when paymentInstrument is null', function () {
            assert.isFalse(accountUpdaterHelper.handleRTAUResponse(null, {}).updated);
        });

        it('should return not updated when responseData is null', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            assert.isFalse(accountUpdaterHelper.handleRTAUResponse(pi, null).updated);
        });

        it('should update only expiry for NEW_EXPIRY', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            pi.setCreditCardToken('orig-token');
            var result = accountUpdaterHelper.handleRTAUResponse(pi, {
                accountUpdater: { accountUpdaterResponse: 'NEW_EXPIRY', newAccountExpiry: { month: '6', year: '2029' } }
            });
            assert.isTrue(result.updated);
            assert.equal(pi.getCreditCardToken(), 'orig-token');
            assert.equal(pi.getCreditCardExpirationMonth(), 6);
            assert.equal(pi.getCreditCardExpirationYear(), 2029);
        });

        it('should use card.accountUpdater when top-level accountUpdater is absent', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            var result = accountUpdaterHelper.handleRTAUResponse(pi, {
                paymentMethodType: { card: { accountUpdater: { accountUpdaterResponse: 'NEW_EXPIRY', newAccountExpiry: { month: '9', year: '2033' } } } }
            });
            assert.isTrue(result.updated);
            assert.equal(pi.getCreditCardExpirationMonth(), 9);
        });

        it('should log error and return updated=false when Transaction.wrap throws', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            TransactionMock.wrap = function () { throw new Error('RTAU Transaction failed'); };
            var result = accountUpdaterHelper.handleRTAUResponse(pi, {
                accountUpdater: { accountUpdaterResponse: 'NEW_EXPIRY', newAccountExpiry: { month: '2', year: '2030' } }
            });
            assert.isFalse(result.updated);
        });

        it('should return not updated when responseCode is null', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            var result = accountUpdaterHelper.handleRTAUResponse(pi, { accountUpdater: {} });
            assert.isFalse(result.updated);
            assert.isNull(result.action);
        });

        it('should use expiry fallback field when newAccountExpiry is absent', function () {
            var pi = new (require('../../../../../test/mocks/dw/order/PaymentInstrument'))();
            var result = accountUpdaterHelper.handleRTAUResponse(pi, {
                accountUpdater: { accountUpdaterResponse: 'NEW_EXPIRY', expiry: { month: '7', year: '2034' } }
            });
            assert.isTrue(result.updated);
            assert.equal(pi.getCreditCardExpirationMonth(), 7);
            assert.equal(pi.getCreditCardExpirationYear(), 2034);
        });
    });
});
