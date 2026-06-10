'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockPI(uuid, token) {
    return {
        _uuid: uuid, _token: token, _month: null, _year: null,
        _holder: 'Test User', _type: 'Visa', _number: '4111111111111111',
        custom: {},
        getUUID: function () { return this._uuid; },
        getCreditCardToken: function () { return this._token; },
        setCreditCardToken: function (t) { this._token = t; },
        setCreditCardExpirationMonth: function (m) { this._month = m; },
        setCreditCardExpirationYear: function (y) { this._year = y; },
        getCreditCardExpirationMonth: function () { return this._month; },
        getCreditCardExpirationYear: function () { return this._year; },
        getCreditCardHolder: function () { return this._holder; },
        setCreditCardHolder: function (h) { this._holder = h; },
        getCreditCardType: function () { return this._type; },
        setCreditCardType: function (t) { this._type = t; },
        getCreditCardNumber: function () { return this._number; },
        setCreditCardNumber: function (n) { this._number = n; }
    };
}

function makeMockWallet(pis) {
    return {
        _pis: pis,
        getPaymentInstruments: function () {
            var items = this._pis;
            return {
                iterator: function () {
                    var idx = 0;
                    return {
                        hasNext: function () { return idx < items.length; },
                        next: function () { return items[idx++]; }
                    };
                }
            };
        },
        createPaymentInstrument: function () {
            var newPI = makeMockPI('new-uuid', null);
            this._pis.push(newPI);
            return newPI;
        },
        removePaymentInstrument: function (pi) {
            for (var i = 0; i < this._pis.length; i++) {
                if (this._pis[i] === pi) {
                    this._pis.splice(i, 1);
                    break;
                }
            }
        }
    };
}

function makeMockCustomer(wallet) {
    return {
        getProfile: function () {
            return { getWallet: function () { return wallet; } };
        }
    };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('accountUpdaterHelper', function () {
    var accountUpdaterHelper;
    var LoggerMock;
    var TransactionMock;
    var CustomObjectMgrMock;
    var JPMCServiceHelperMock;
    var JPMCMerchantResolverMock;
    var CustomerMgrMock;
    var UUIDMock;
    var constants;

    beforeEach(function () {
        LoggerMock = require('../../../../../test/mocks/dw/system/Logger');
        TransactionMock = require('../../../../../test/mocks/dw/system/Transaction');
        CustomObjectMgrMock = require('../../../../../test/mocks/dw/object/CustomObjectMgr');

        LoggerMock.resetAllLoggers();
        TransactionMock.reset();
        CustomObjectMgrMock.resetAllCustomObjects();

        constants = require('../../../../../cartridges/int_jpmc_core/cartridge/scripts/helpers/JPMCConstants');

        JPMCServiceHelperMock = {
            callWithTokenGeneration: function () {
                return { success: true, data: { requestStatus: 'REGISTERED' } };
            }
        };

        JPMCMerchantResolverMock = {
            resolve: function () {
                return {
                    merchantId: 'test-merchant',
                    tokenizationType: 'SAFETECH_TOKEN',
                    accountUpdaterMode: 'NOTIFICATIONS',
                    accountUpdaterWebhookUser: 'test-webhook-user',
                    accountUpdaterWebhookSecret: 'test-webhook-secret',
                    jpmcWebhookSubscriptionId: 'sub-123',
                    configKey: 'TestSite::en_US'
                };
            },
            saveWebhookSubscriptionId: function () { return true; },
            clearWebhookSubscriptionId: function () { return true; }
        };

        CustomerMgrMock = {
            getCustomerByCustomerNumber: function () { return null; }
        };

        UUIDMock = {
            createUUID: function () { return { toString: function () { return 'mock-uuid-1234'; } }; }
        };

        accountUpdaterHelper = proxyquire(
            '../../../../../cartridges/int_jpmc_core/cartridge/scripts/helpers/AccountUpdaterHelper',
            {
                'dw/system/Logger': LoggerMock,
                'dw/system/Transaction': TransactionMock,
                'dw/object/CustomObjectMgr': CustomObjectMgrMock,
                'dw/customer/CustomerMgr': CustomerMgrMock,
                'dw/order/PaymentInstrument': { METHOD_CREDIT_CARD: 'credit_card' },
                'dw/crypto/Mac': function () {
                    this.digest = function (val) { return val; };
                    this.HMAC_SHA_256 = 'HmacSHA256';
                },
                'dw/crypto/Encoding': {
                    toHex: function (val) { return String(val); },
                    toBase64: function (bytesObj) { return bytesObj._b64; }
                },
                'dw/util/Bytes': function (str) {
                    this._b64 = Buffer.from(str).toString('base64');
                },
                'dw/util/UUIDUtils': UUIDMock,
                'dw/system/Site': {
                    getCurrent: function () {
                        return {
                            getID: function () { return 'RefArch'; },
                            getHttpsHostName: function () { return 'mmm01.dx.commercecloud.salesforce.com'; }
                        };
                    }
                },
                '*/cartridge/scripts/services/JPMCServiceHelper': JPMCServiceHelperMock,
                '*/cartridge/scripts/helpers/JPMCMerchantResolver': JPMCMerchantResolverMock,
                '*/cartridge/scripts/helpers/JPMCConstants': constants
            }
        );
    });

    // ─── registerCard ────────────────────────────────────────────────────────

    describe('registerCard', function () {
        it('should return success when registration succeeds', function () {
            var result = accountUpdaterHelper.registerCard('token123', 12, 2027, 'pi-uuid-CN-CUST001');
            assert.isTrue(result.success);
            assert.equal(result.requestStatus, 'REGISTERED');
        });

        it('should return error when creditCardToken is missing', function () {
            var result = accountUpdaterHelper.registerCard(null, 12, 2027, 'mri');
            assert.isFalse(result.success);
            assert.include(result.error, 'Missing required parameters');
        });

        it('should return error when expirationMonth is missing', function () {
            var result = accountUpdaterHelper.registerCard('token123', null, 2027, 'mri');
            assert.isFalse(result.success);
            assert.include(result.error, 'Missing required parameters');
        });

        it('should return error when expirationYear is missing', function () {
            var result = accountUpdaterHelper.registerCard('token123', 12, null, 'mri');
            assert.isFalse(result.success);
            assert.include(result.error, 'Missing required parameters');
        });

        it('should handle CLOSED_ACCOUNT reason and auto-unregister', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return {
                    success: true,
                    data: { requestStatus: 'DECLINED', reasonMessage: 'CLOSED_ACCOUNT', responseMessage: 'Account is closed' }
                };
            };
            var result = accountUpdaterHelper.registerCard('token123', 12, 2027, 'mri');
            assert.isFalse(result.success);
            assert.include(result.error, 'CLOSED_ACCOUNT');
        });

        it('should handle CONTACT_CARDHOLDER reason', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return {
                    success: true,
                    data: { requestStatus: 'DECLINED', reasonMessage: 'CONTACT_CARDHOLDER' }
                };
            };
            var result = accountUpdaterHelper.registerCard('token123', 12, 2027, 'mri');
            assert.isFalse(result.success);
            assert.include(result.error, 'CONTACT_CARDHOLDER');
        });

        it('should handle service failure', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: false, error: 'Service timeout' };
            };
            var result = accountUpdaterHelper.registerCard('token123', 12, 2027, 'mri');
            assert.isFalse(result.success);
            assert.include(result.error, 'Service timeout');
        });

        it('should handle service failure with no error message', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: false };
            };
            var result = accountUpdaterHelper.registerCard('token123', 12, 2027, 'mri');
            assert.isFalse(result.success);
            assert.isString(result.error);
        });

        it('should handle REGISTRATION_PENDING status', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, data: { requestStatus: 'REGISTRATION_PENDING' } };
            };
            var result = accountUpdaterHelper.registerCard('token123', 12, 2027, 'mri');
            assert.isTrue(result.success);
            assert.equal(result.requestStatus, 'REGISTRATION_PENDING');
        });

        it('should return error for unknown status with responseMessage', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, data: { requestStatus: 'UNKNOWN', responseMessage: 'Something went wrong' } };
            };
            var result = accountUpdaterHelper.registerCard('token123', 12, 2027, 'mri');
            assert.isFalse(result.success);
            assert.include(result.error, 'Something went wrong');
        });

        it('should fallback error when no responseMessage and unknown status', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, data: { requestStatus: 'UNKNOWN_XYZ' } };
            };
            var result = accountUpdaterHelper.registerCard('token123', 12, 2027, 'mri');
            assert.isFalse(result.success);
            assert.include(result.error, 'UNKNOWN_XYZ');
        });

        it('should handle service exception', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                throw new Error('Unexpected exception');
            };
            var result = accountUpdaterHelper.registerCard('token123', 12, 2027, 'mri');
            assert.isFalse(result.success);
            assert.include(result.error, 'Unexpected exception');
        });
    });

    // ─── unregisterCard ──────────────────────────────────────────────────────

    describe('unregisterCard', function () {
        it('should return success when unregistration succeeds', function () {
            var result = accountUpdaterHelper.unregisterCard('token123');
            assert.isTrue(result.success);
        });

        it('should return error when token is missing', function () {
            var result = accountUpdaterHelper.unregisterCard(null);
            assert.isFalse(result.success);
            assert.include(result.error, 'Missing creditCardToken');
        });

        it('should return error when service call fails', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: false, error: 'Service call failed' };
            };
            var result = accountUpdaterHelper.unregisterCard('token123');
            assert.isFalse(result.success);
            assert.include(result.error, 'Service call failed');
        });

        it('should return fallback error when service fails without error message', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: false };
            };
            var result = accountUpdaterHelper.unregisterCard('token123');
            assert.isFalse(result.success);
            assert.equal(result.error, 'Service call failed');
        });

        it('should handle exception during unregistration', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                throw new Error('Connection reset');
            };
            var result = accountUpdaterHelper.unregisterCard('token123');
            assert.isFalse(result.success);
            assert.include(result.error, 'Connection reset');
        });
    });

    // ─── parseAccountUpdaterPayload ──────────────────────────────────────────

    describe('parseAccountUpdaterPayload', function () {
        it('should parse a valid payload with resultsMessage', function () {
            var payload = {
                requestId: 'REQ-001', responseId: 'RESP-001', requestStatus: 'UPDATED',
                merchantRecordIdentifier: 'pi-uuid-CN-CUST001',
                resultsMessage: {
                    reasonMessage: 'NEW_EXPIRY', networkResponseCode: '00',
                    oldAccountInformation: { cardNumber: 'old-token-123', cardTypeName: 'VISA' },
                    newAccountInformation: { cardNumber: 'old-token-123', cardTypeName: 'VISA', paymentMethodChanged: false, expiry: { month: '12', year: '2028' } }
                }
            };
            var result = accountUpdaterHelper.parseAccountUpdaterPayload(payload);
            assert.isNotNull(result);
            assert.equal(result.notificationId, 'RESP-001');
            assert.equal(result.oldCardToken, 'old-token-123');
            assert.equal(result.newExpiryMonth, 12);
            assert.equal(result.newExpiryYear, 2028);
            assert.isFalse(result.isCardNumberChanged);
        });

        it('should handle NEW_ACCOUNT_AND_EXPIRY with changed card number', function () {
            var payload = {
                requestId: 'REQ-002', merchantRecordIdentifier: 'pi-uuid-CN-CUST002',
                resultsMessage: {
                    reasonMessage: 'NEW_ACCOUNT_AND_EXPIRY',
                    oldAccountInformation: { cardNumber: 'old-token-123' },
                    newAccountInformation: { cardNumber: 'new-token-456', paymentMethodChanged: true, expiry: { month: '6', year: '2030' } }
                }
            };
            var result = accountUpdaterHelper.parseAccountUpdaterPayload(payload);
            assert.isNotNull(result);
            assert.equal(result.newCardToken, 'new-token-456');
            assert.isTrue(result.isCardNumberChanged);
        });

        it('should return null for missing requestId', function () {
            assert.isNull(accountUpdaterHelper.parseAccountUpdaterPayload({}));
            assert.isNull(accountUpdaterHelper.parseAccountUpdaterPayload(null));
        });

        it('should return parsed object without resultsMessage', function () {
            var result = accountUpdaterHelper.parseAccountUpdaterPayload({ requestId: 'REQ-003', merchantRecordIdentifier: 'mri' });
            assert.isNotNull(result);
            assert.equal(result.oldCardToken, '');
        });

        it('should use requestId as notificationId when responseId is missing', function () {
            var result = accountUpdaterHelper.parseAccountUpdaterPayload({ requestId: 'REQ-004' });
            assert.equal(result.notificationId, 'REQ-004');
        });

        it('should handle resultsMessage without oldAccountInformation', function () {
            var payload = {
                requestId: 'REQ-005',
                resultsMessage: { newAccountInformation: { cardNumber: 'new-token', paymentMethodChanged: false, expiry: { month: '1', year: '2031' } } }
            };
            var result = accountUpdaterHelper.parseAccountUpdaterPayload(payload);
            assert.equal(result.oldCardToken, '');
            assert.equal(result.newCardToken, 'new-token');
        });

        it('should handle newAccountInformation without expiry', function () {
            var payload = {
                requestId: 'REQ-006',
                resultsMessage: { newAccountInformation: { cardNumber: 'token', paymentMethodChanged: false } }
            };
            var result = accountUpdaterHelper.parseAccountUpdaterPayload(payload);
            assert.isNull(result.newExpiryMonth);
        });
    });


    describe('parseWebhookNotification', function () {
        it('should parse valid nested webhook payload', function () {
            var payload = {
                notificationId: 'N-001',
                merchantId: 'MID-001',
                accountUpdateNotification: {
                    accountUpdaterStatus: {
                        transactionId: 'TXN-001',
                        reasonMessage: 'NEW_EXPIRY',
                        merchantRecordIdentifier: 'pi-uuid-CN-CUST001'
                    }
                }
            };

            var result = accountUpdaterHelper.parseWebhookNotification(payload);
            assert.equal(result.notificationId, 'N-001');
            assert.equal(result.merchantId, 'MID-001');
            assert.equal(result.transactionId, 'TXN-001');
            assert.equal(result.reasonMessage, 'NEW_EXPIRY');
            assert.equal(result.merchantRecordIdentifier, 'pi-uuid-CN-CUST001');
        });

        it('should return null when required fields are missing', function () {
            assert.isNull(accountUpdaterHelper.parseWebhookNotification(null));
            assert.isNull(accountUpdaterHelper.parseWebhookNotification({ notificationId: 'N-1' }));
            assert.isNull(accountUpdaterHelper.parseWebhookNotification({
                notificationId: 'N-1',
                accountUpdateNotification: { accountUpdaterStatus: {} }
            }));
        });

        it('should return empty merchantId when not provided', function () {
            var payload = {
                notificationId: 'N-002',
                accountUpdateNotification: {
                    accountUpdaterStatus: {
                        transactionId: 'TXN-002',
                        reasonMessage: 'NEW_EXPIRY',
                        merchantRecordIdentifier: 'mri-val'
                    }
                }
            };
            var result = accountUpdaterHelper.parseWebhookNotification(payload);
            assert.equal(result.merchantId, '');
        });

        it('should return empty reasonMessage when not provided', function () {
            var payload = {
                notificationId: 'N-003',
                accountUpdateNotification: {
                    accountUpdaterStatus: {
                        transactionId: 'TXN-003'
                    }
                }
            };
            var result = accountUpdaterHelper.parseWebhookNotification(payload);
            assert.equal(result.reasonMessage, '');
            assert.equal(result.merchantRecordIdentifier, '');
        });
    });

    describe('fetchAccountUpdate', function () {
        it('should return error when transactionId is missing', function () {
            var result = accountUpdaterHelper.fetchAccountUpdate('', 'MID-1');
            assert.isFalse(result.success);
            assert.include(result.error, 'transactionId is required');
        });

        it('should resolve by merchantId when provided and return service data', function () {
            var resolveByMerchantIdCalled = false;

            JPMCMerchantResolverMock.resolveByMerchantId = function (merchantId) {
                resolveByMerchantIdCalled = true;
                return {
                    merchantId: merchantId,
                    configKey: 'RefArch::en_US'
                };
            };

            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return {
                    success: true,
                    statusCode: 200,
                    data: { requestId: 'REQ-GET-1' }
                };
            };

            var result = accountUpdaterHelper.fetchAccountUpdate('TXN-123', 'MID-123');
            assert.isTrue(resolveByMerchantIdCalled);
            assert.isTrue(result.success);
            assert.equal(result.data.requestId, 'REQ-GET-1');
            assert.equal(result.statusCode, 200);
        });

        it('should return error when resolver cannot produce merchant config', function () {
            JPMCMerchantResolverMock.resolve = function () {
                return { merchantId: '' };
            };

            var result = accountUpdaterHelper.fetchAccountUpdate('TXN-404', '');
            assert.isFalse(result.success);
            assert.include(result.error, 'Unable to resolve merchant config');
        });

        it('should fall back to resolve() when merchantId is empty', function () {
            var resolveCalled = false;
            JPMCMerchantResolverMock.resolve = function () {
                resolveCalled = true;
                return { merchantId: 'test-merchant', configKey: 'RefArch::en_US' };
            };

            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, statusCode: 200, data: { requestId: 'REQ-FALLBACK' } };
            };

            var result = accountUpdaterHelper.fetchAccountUpdate('TXN-FB', '');
            assert.isTrue(resolveCalled);
            assert.isTrue(result.success);
        });

        it('should return error when service returns success but no data', function () {
            JPMCMerchantResolverMock.resolveByMerchantId = function () {
                return { merchantId: 'mid', configKey: 'RefArch::en_US' };
            };

            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, statusCode: 200, data: null };
            };

            var result = accountUpdaterHelper.fetchAccountUpdate('TXN-NODATA', 'MID-1');
            assert.isFalse(result.success);
            assert.isString(result.error);
        });

        it('should return error when service throws exception', function () {
            JPMCMerchantResolverMock.resolveByMerchantId = function () {
                return { merchantId: 'mid', configKey: 'RefArch::en_US' };
            };

            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                throw new Error('Connection reset');
            };

            var result = accountUpdaterHelper.fetchAccountUpdate('TXN-THROW', 'MID-1');
            assert.isFalse(result.success);
            assert.include(result.error, 'Connection reset');
        });

        it('should return error with fallback message when service fails without error string', function () {
            JPMCMerchantResolverMock.resolveByMerchantId = function () {
                return { merchantId: 'mid', configKey: 'RefArch::en_US' };
            };

            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: false, statusCode: 500 };
            };

            var result = accountUpdaterHelper.fetchAccountUpdate('TXN-NOERR', 'MID-1');
            assert.isFalse(result.success);
            assert.isString(result.error);
        });
    });

    describe('updateCustomerWallet', function () {
        it('should create replacement PI and remove old PI', function () {
            var oldPI = makeMockPI('pi-uuid-exact', 'old-token');
            oldPI.setCreditCardExpirationMonth(10);
            oldPI.setCreditCardExpirationYear(2027);

            var wallet = makeMockWallet([oldPI]);
            CustomerMgrMock.getCustomerByCustomerNumber = function () {
                return makeMockCustomer(wallet);
            };

            var result = accountUpdaterHelper.updateCustomerWallet({
                merchantRecordIdentifier: 'pi-uuid-exact-CN-CUST001',
                oldCardToken: 'old-token',
                newCardToken: 'new-token',
                newExpiryMonth: 8,
                newExpiryYear: 2029
            });

            assert.isTrue(result.success);
            assert.equal(result.customerNo, 'CUST001');
            assert.equal(wallet._pis.length, 1);
            assert.equal(wallet._pis[0].getCreditCardToken(), 'new-token');
            assert.equal(wallet._pis[0].getCreditCardExpirationMonth(), 8);
            assert.equal(wallet._pis[0].getCreditCardExpirationYear(), 2029);
        });

        it('should return error when merchantRecordIdentifier is invalid', function () {
            var result = accountUpdaterHelper.updateCustomerWallet({
                merchantRecordIdentifier: 'invalid-mri',
                oldCardToken: 'old-token'
            });

            assert.isFalse(result.success);
            assert.include(result.error, 'Invalid merchantRecordIdentifier format');
        });

        it('should return error when PI cannot be found', function () {
            CustomerMgrMock.getCustomerByCustomerNumber = function () { return null; };

            var result = accountUpdaterHelper.updateCustomerWallet({
                merchantRecordIdentifier: 'pi-uuid-CN-CUST999',
                oldCardToken: 'missing-token'
            });

            assert.isFalse(result.success);
            assert.include(result.error, 'PaymentInstrument not found');
        });

        it('should preserve old token when new token is missing', function () {
            var oldPI = makeMockPI('pi-uuid-token', 'old-token-keep');
            oldPI.setCreditCardExpirationMonth(2);
            oldPI.setCreditCardExpirationYear(2030);

            var wallet = makeMockWallet([oldPI]);
            CustomerMgrMock.getCustomerByCustomerNumber = function () {
                return makeMockCustomer(wallet);
            };

            var result = accountUpdaterHelper.updateCustomerWallet({
                merchantRecordIdentifier: 'pi-uuid-token-CN-CUST010',
                oldCardToken: 'old-token-keep',
                newCardToken: '',
                newExpiryMonth: null,
                newExpiryYear: null
            });

            assert.isTrue(result.success);
            assert.equal(wallet._pis[0].getCreditCardToken(), 'old-token-keep');
            assert.equal(wallet._pis[0].getCreditCardExpirationMonth(), 2);
            assert.equal(wallet._pis[0].getCreditCardExpirationYear(), 2030);
        });

        it('should return error when parsedGetData is null', function () {
            var result = accountUpdaterHelper.updateCustomerWallet(null);
            assert.isFalse(result.success);
            assert.include(result.error, 'missing merchantRecordIdentifier');
        });

        it('should return error when parsedGetData has no merchantRecordIdentifier', function () {
            var result = accountUpdaterHelper.updateCustomerWallet({ oldCardToken: 'tok' });
            assert.isFalse(result.success);
            assert.include(result.error, 'missing merchantRecordIdentifier');
        });

        it('should return error when customer profile is null after PI lookup', function () {
            var oldPI = makeMockPI('pi-uuid-noprofile', 'old-token');
            var wallet = makeMockWallet([oldPI]);

            var callCount = 0;
            CustomerMgrMock.getCustomerByCustomerNumber = function () {
                callCount++;
                if (callCount === 1) {
                    return makeMockCustomer(wallet);
                }
                return { getProfile: function () { return null; } };
            };

            var result = accountUpdaterHelper.updateCustomerWallet({
                merchantRecordIdentifier: 'pi-uuid-noprofile-CN-CUST050',
                oldCardToken: 'old-token',
                newCardToken: 'new-token'
            });

            assert.isFalse(result.success);
            assert.include(result.error, 'Customer or profile not found');
        });

        it('should return error when wallet is null', function () {
            var oldPI = makeMockPI('pi-uuid-nowallet', 'old-token');
            var wallet = makeMockWallet([oldPI]);

            var callCount = 0;
            CustomerMgrMock.getCustomerByCustomerNumber = function () {
                callCount++;
                if (callCount === 1) {
                    return makeMockCustomer(wallet);
                }
                return {
                    getProfile: function () {
                        return { getWallet: function () { return null; } };
                    }
                };
            };

            var result = accountUpdaterHelper.updateCustomerWallet({
                merchantRecordIdentifier: 'pi-uuid-nowallet-CN-CUST060',
                oldCardToken: 'old-token',
                newCardToken: 'new-token'
            });

            assert.isFalse(result.success);
            assert.include(result.error, 'Wallet not found');
        });

        it('should return error when no card token is available', function () {
            var oldPI = makeMockPI('pi-uuid-notok', 'old-token');
            var wallet = makeMockWallet([oldPI]);
            CustomerMgrMock.getCustomerByCustomerNumber = function () {
                return makeMockCustomer(wallet);
            };

            var result = accountUpdaterHelper.updateCustomerWallet({
                merchantRecordIdentifier: 'pi-uuid-notok-CN-CUST070',
                oldCardToken: 'old-token',
                newCardToken: '',
                newExpiryMonth: 12,
                newExpiryYear: 2030
            });

            assert.isTrue(result.success);
        });

        it('should return error when both old and new tokens are empty', function () {
            var oldPI = makeMockPI('pi-uuid-empty', '');
            var wallet = makeMockWallet([oldPI]);
            CustomerMgrMock.getCustomerByCustomerNumber = function () {
                return makeMockCustomer(wallet);
            };

            var result = accountUpdaterHelper.updateCustomerWallet({
                merchantRecordIdentifier: 'pi-uuid-empty-CN-CUST080',
                oldCardToken: '',
                newCardToken: ''
            });

            assert.isFalse(result.success);
            assert.include(result.error, 'No card token available');
        });

        it('should return error when wallet operation throws', function () {
            var oldPI = makeMockPI('pi-uuid-throw', 'old-token');
            var wallet = makeMockWallet([oldPI]);
            wallet.createPaymentInstrument = function () { throw new Error('DB write failed'); };

            CustomerMgrMock.getCustomerByCustomerNumber = function () {
                return makeMockCustomer(wallet);
            };

            var result = accountUpdaterHelper.updateCustomerWallet({
                merchantRecordIdentifier: 'pi-uuid-throw-CN-CUST090',
                oldCardToken: 'old-token',
                newCardToken: 'new-token'
            });

            assert.isFalse(result.success);
            assert.include(result.error, 'DB write failed');
        });
    });

    // ─── authenticateWebhook ─────────────────────────────────────────────────

    describe('authenticateWebhook', function () {
        it('should return false when request is null', function () {
            assert.isFalse(accountUpdaterHelper.authenticateWebhook(null));
        });

        it('should return false when request has no httpHeaders', function () {
            assert.isFalse(accountUpdaterHelper.authenticateWebhook({}));
        });

        it('should return false when webhook secret is not configured', function () {
            JPMCMerchantResolverMock.resolve = function () { return { accountUpdaterWebhookSecret: '' }; };
            assert.isFalse(accountUpdaterHelper.authenticateWebhook({ httpHeaders: { get: function () { return 'Basic abc'; } } }));
        });

        it('should return false when Authorization header is missing', function () {
            assert.isFalse(accountUpdaterHelper.authenticateWebhook({ httpHeaders: { get: function () { return null; } } }));
        });

        it('should return false when Authorization header is empty string', function () {
            assert.isFalse(accountUpdaterHelper.authenticateWebhook({ httpHeaders: { get: function () { return ''; } } }));
        });

        it('should return false when Authorization header uses non-Basic scheme', function () {
            assert.isFalse(accountUpdaterHelper.authenticateWebhook({ httpHeaders: { get: function () { return 'Bearer some-token'; } } }));
        });

        it('should return false when Authorization Basic does not match', function () {
            assert.isFalse(accountUpdaterHelper.authenticateWebhook({ httpHeaders: { get: function () { return 'Basic d3Jvbmc='; } } }));
        });

        it('should return true when Authorization Basic header matches', function () {
            var basicValue = 'Basic ' + Buffer.from('test-webhook-user:test-webhook-secret').toString('base64');
            assert.isTrue(accountUpdaterHelper.authenticateWebhook({ httpHeaders: { get: function () { return basicValue; } } }));
        });

        it('should return true when no username configured (secret-only credentials)', function () {
            JPMCMerchantResolverMock.resolve = function () {
                return { accountUpdaterWebhookUser: '', accountUpdaterWebhookSecret: 'test-webhook-secret' };
            };
            var basicValue = 'Basic ' + Buffer.from(':test-webhook-secret').toString('base64');
            assert.isTrue(accountUpdaterHelper.authenticateWebhook({ httpHeaders: { get: function () { return basicValue; } } }));
        });

        it('should return false and log when resolver throws', function () {
            JPMCMerchantResolverMock.resolve = function () { throw new Error('Resolver failure'); };
            assert.isFalse(accountUpdaterHelper.authenticateWebhook({ httpHeaders: { get: function () { return 'Basic abc'; } } }));
        });
    });

    // ─── subscribe ───────────────────────────────────────────────────────────

    describe('subscribe', function () {
        it('should return success with subscriptionId from subscriptionId field', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, data: { subscriptionId: 'SUB-NEW-123' } };
            };
            var result = accountUpdaterHelper.subscribe('TestSite::en_US');
            assert.isTrue(result.success);
            assert.equal(result.subscriptionId, 'SUB-NEW-123');
        });

        it('should return success with subscriptionId from data.id field', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, data: { id: 'SUB-BY-ID-456' } };
            };
            var result = accountUpdaterHelper.subscribe('TestSite::en_US');
            assert.isTrue(result.success);
            assert.equal(result.subscriptionId, 'SUB-BY-ID-456');
        });

        it('should return success with subscriptionId from data.subscription.id', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, data: { subscription: { id: 'SUB-NESTED-789' } } };
            };
            var result = accountUpdaterHelper.subscribe('TestSite::en_US');
            assert.isTrue(result.success);
            assert.equal(result.subscriptionId, 'SUB-NESTED-789');
        });

        it('should return error when merchantId is not configured', function () {
            JPMCMerchantResolverMock.resolve = function () { return { merchantId: '', accountUpdaterWebhookUser: 'u', accountUpdaterWebhookSecret: 'secret' }; };
            assert.include(accountUpdaterHelper.subscribe().error, 'Merchant ID');
        });

        it('should return error when webhook secret is missing', function () {
            JPMCMerchantResolverMock.resolve = function () { return { merchantId: 'mid', accountUpdaterMode: 'NOTIFICATIONS', accountUpdaterWebhookUser: 'u', accountUpdaterWebhookSecret: '' }; };
            assert.include(accountUpdaterHelper.subscribe().error, 'Webhook secret');
        });

        it('should return error when webhook username is missing', function () {
            JPMCMerchantResolverMock.resolve = function () { return { merchantId: 'mid', accountUpdaterMode: 'NOTIFICATIONS', accountUpdaterWebhookUser: '', accountUpdaterWebhookSecret: 'secret' }; };
            assert.include(accountUpdaterHelper.subscribe().error, 'Webhook username');
        });

        it('should return error when service call fails', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: false, error: 'Connection timeout' };
            };
            assert.include(accountUpdaterHelper.subscribe('TestSite::en_US').error, 'Connection timeout');
        });

        it('should return fallback error when service fails without message', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () { return { success: false }; };
            assert.include(accountUpdaterHelper.subscribe('TestSite::en_US').error, 'Subscription request failed');
        });

        it('should return error when no subscriptionId returned', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () { return { success: true, data: {} }; };
            assert.include(accountUpdaterHelper.subscribe('TestSite::en_US').error, 'No subscriptionId');
        });

        it('should return error when persist fails', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, data: { subscriptionId: 'SUB-1' } };
            };
            JPMCMerchantResolverMock.saveWebhookSubscriptionId = function () { return false; };
            assert.include(accountUpdaterHelper.subscribe('TestSite::en_US').error, 'failed to persist');
        });

        it('should handle exception during subscribe', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () { throw new Error('Subscribe boom'); };
            assert.include(accountUpdaterHelper.subscribe('TestSite::en_US').error, 'Subscribe boom');
        });

        it('should build a locale-aware callbackURL using site ID and configKey locale', function () {
            var capturedPayload;
            JPMCServiceHelperMock.callWithTokenGeneration = function (opts) {
                capturedPayload = opts.data;
                return { success: true, data: { subscriptionId: 'SUB-LOCALE-TEST' } };
            };
            accountUpdaterHelper.subscribe('TestSite::en_US');
            assert.equal(
                capturedPayload.callbackURL,
                'https://mmm01.dx.commercecloud.salesforce.com/on/demandware.store/Sites-RefArch-Site/en_US/AccountUpdater-Notify'
            );
        });

        it('should fall back to "default" locale in callbackURL when no configKey locale', function () {
            var capturedPayload;
            JPMCServiceHelperMock.callWithTokenGeneration = function (opts) {
                capturedPayload = opts.data;
                return { success: true, data: { subscriptionId: 'SUB-DEFAULT-LOCALE' } };
            };
            accountUpdaterHelper.subscribe(null);
            assert.equal(
                capturedPayload.callbackURL,
                'https://mmm01.dx.commercecloud.salesforce.com/on/demandware.store/Sites-RefArch-Site/default/AccountUpdater-Notify'
            );
        });
    });

    // ─── deleteSubscription ──────────────────────────────────────────────────

    describe('deleteSubscription', function () {
        it('should return success on successful delete', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () { return { success: true }; };
            assert.isTrue(accountUpdaterHelper.deleteSubscription('TestSite::en_US').success);
        });

        it('should return error when no subscriptionId on file', function () {
            JPMCMerchantResolverMock.resolve = function () {
                return { merchantId: 'mid', jpmcWebhookSubscriptionId: '', accountUpdaterWebhookSecret: 's', configKey: 'k' };
            };
            assert.include(accountUpdaterHelper.deleteSubscription().error, 'No subscriptionId');
        });

        it('should return error when merchantId is not configured', function () {
            JPMCMerchantResolverMock.resolve = function () {
                return { merchantId: '', jpmcWebhookSubscriptionId: 'sub-exists', accountUpdaterWebhookSecret: 's', configKey: 'k' };
            };
            assert.include(accountUpdaterHelper.deleteSubscription().error, 'Merchant ID');
        });

        it('should succeed when service returns 404', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () { return { success: false, statusCode: 404 }; };
            assert.isTrue(accountUpdaterHelper.deleteSubscription('TestSite::en_US').success);
        });

        it('should return error when service fails with non-404 status', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: false, statusCode: 500, error: 'Internal server error' };
            };
            assert.include(accountUpdaterHelper.deleteSubscription('TestSite::en_US').error, 'Internal server error');
        });

        it('should return fallback error when service fails non-404 without message', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: false, statusCode: 503 };
            };
            assert.include(accountUpdaterHelper.deleteSubscription('TestSite::en_US').error, 'Delete subscription failed');
        });

        it('should handle exception during delete', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () { throw new Error('Delete blew up'); };
            assert.include(accountUpdaterHelper.deleteSubscription('TestSite::en_US').error, 'Delete blew up');
        });
    });

    // ─── updateSubscription ──────────────────────────────────────────────────

    describe('updateSubscription', function () {
        it('should update subscription via PUT when subscriptionId exists', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, data: { subscriptionId: 'SUB-UPDATED' } };
            };
            var result = accountUpdaterHelper.updateSubscription('TestSite::en_US');
            assert.isTrue(result.success);
            assert.equal(result.subscriptionId, 'SUB-UPDATED');
        });

        it('should fall back to subscribe when no subscriptionId exists', function () {
            JPMCMerchantResolverMock.resolve = function () {
                return { merchantId: 'mid', jpmcWebhookSubscriptionId: '', accountUpdaterMode: 'NOTIFICATIONS', accountUpdaterWebhookUser: 'u', accountUpdaterWebhookSecret: 'secret', configKey: 'TestSite::en_US' };
            };
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: true, data: { subscriptionId: 'SUB-NEW' } };
            };
            var result = accountUpdaterHelper.updateSubscription('TestSite::en_US');
            assert.isTrue(result.success);
            assert.equal(result.subscriptionId, 'SUB-NEW');
        });

        it('should propagate error when PUT update fails', function () {
            JPMCServiceHelperMock.callWithTokenGeneration = function () {
                return { success: false, statusCode: 500, error: 'Gateway timeout' };
            };
            var result = accountUpdaterHelper.updateSubscription('TestSite::en_US');
            assert.isFalse(result.success);
            assert.include(result.error, 'Gateway timeout');
        });
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
