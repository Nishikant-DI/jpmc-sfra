'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();

describe('processUpdateQueue chunk job', function () {
    var processUpdateQueue;
    var LoggerMock;
    var CustomObjectMgrMock;
    var accountUpdaterHelperMock;
    var constants;

    function makeItemsList(items) {
        return {
            empty: !items || items.length === 0,
            iterator: function () {
                var idx = 0;
                return {
                    hasNext: function () { return idx < items.length; },
                    next: function () { return items[idx++]; }
                };
            }
        };
    }

    beforeEach(function () {
        LoggerMock = require('../../../../../test/mocks/dw/system/Logger');
        CustomObjectMgrMock = require('../../../../../test/mocks/dw/object/CustomObjectMgr');

        LoggerMock.resetAllLoggers();
        CustomObjectMgrMock.resetAllCustomObjects();

        constants = require('../../../../../cartridges/int_jpmc_core/cartridge/scripts/helpers/JPMCConstants');

        accountUpdaterHelperMock = {
            fetchAccountUpdate: function () {
                return {
                    success: true,
                    data: {
                        requestId: 'REQ-001',
                        merchantRecordIdentifier: 'pi-uuid-CN-CUST001',
                        resultsMessage: {
                            oldAccountInformation: { cardNumber: 'old-token' },
                            newAccountInformation: {
                                cardNumber: 'new-token',
                                paymentMethodChanged: true,
                                expiry: { month: '12', year: '2028' }
                            }
                        }
                    }
                };
            },
            parseAccountUpdaterPayload: function () {
                return {
                    merchantRecordIdentifier: 'pi-uuid-CN-CUST001',
                    oldCardToken: 'old-token',
                    newCardToken: 'new-token',
                    newExpiryMonth: 12,
                    newExpiryYear: 2028,
                    isCardNumberChanged: true
                };
            },
            updateCustomerWallet: function () {
                return { success: true, customerNo: 'CUST001' };
            }
        };

        processUpdateQueue = proxyquire(
            '../../../../../cartridges/int_jpmc_core/cartridge/scripts/jobs/ProcessUpdateQueue',
            {
                'dw/system/Logger': LoggerMock,
                'dw/system/Transaction': require('../../../../../test/mocks/dw/system/Transaction'),
                'dw/object/CustomObjectMgr': CustomObjectMgrMock,
                '*/cartridge/scripts/helpers/AccountUpdaterHelper': accountUpdaterHelperMock,
                '*/cartridge/scripts/helpers/JPMCConstants': constants
            }
        );
    });

    // ─── beforeStep / getTotalCount / read ───────────────────────────────────

    it('should set total count in beforeStep and iterate records through read', function () {
        var co1 = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-001');
        co1.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co1.custom.transactionId = 'T-1';

        var co2 = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-002');
        co2.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co2.custom.transactionId = 'T-2';

        processUpdateQueue.beforeStep({}, {});

        assert.equal(processUpdateQueue.getTotalCount(), 2);
        assert.equal(processUpdateQueue.read().keyValue, 'TXN-001');
        assert.equal(processUpdateQueue.read().keyValue, 'TXN-002');
        assert.isNull(processUpdateQueue.read());

        processUpdateQueue.afterStep(true, {}, {});
    });

    it('should return 0 totalCount when queue is empty', function () {
        processUpdateQueue.beforeStep({}, {});
        assert.equal(processUpdateQueue.getTotalCount(), 0);
        assert.isNull(processUpdateQueue.read());
        processUpdateQueue.afterStep(true, {}, {});
    });

    it('should include ERROR records alongside NEW records', function () {
        var newCo = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-NEW');
        newCo.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        newCo.custom.transactionId = 'T-NEW';

        var errCo = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-ERR');
        errCo.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        errCo.custom.retryCount = 1;
        errCo.custom.transactionId = 'T-ERR';

        processUpdateQueue.beforeStep({}, {});

        assert.equal(processUpdateQueue.getTotalCount(), 2);
        processUpdateQueue.afterStep(true, {}, {});
    });

    // ─── process ─────────────────────────────────────────────────────────────

    it('should return null from process when input is null', function () {
        assert.isNull(processUpdateQueue.process(null));
    });

    it('should return error when transactionId is missing', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-MISSING');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;

        var item = processUpdateQueue.process(co);
        assert.equal(item.co.keyValue, 'TXN-MISSING');
        assert.include(item.error, 'Missing transactionId');
    });

    it('should return error when fetchAccountUpdate fails', function () {
        accountUpdaterHelperMock.fetchAccountUpdate = function () {
            return { success: false, error: 'Service timeout' };
        };

        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-ERR');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.transactionId = 'BAD-TXN';

        var item = processUpdateQueue.process(co);
        assert.include(item.error, 'GET /account-updates failed');
        assert.include(item.error, 'Service timeout');
    });

    it('should return error when fetchAccountUpdate returns no data', function () {
        accountUpdaterHelperMock.fetchAccountUpdate = function () {
            return { success: true, data: null };
        };

        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-NODATA');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.transactionId = 'TXN-NODATA';

        var item = processUpdateQueue.process(co);
        assert.include(item.error, 'GET /account-updates failed');
    });

    it('should return error when parsed payload is missing merchantRecordIdentifier', function () {
        accountUpdaterHelperMock.parseAccountUpdaterPayload = function () {
            return { merchantRecordIdentifier: '' };
        };

        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-PARSE');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.transactionId = 'TXN-PARSE';

        var item = processUpdateQueue.process(co);
        assert.include(item.error, 'missing merchantRecordIdentifier');
    });

    it('should return error when parseAccountUpdaterPayload returns null', function () {
        accountUpdaterHelperMock.parseAccountUpdaterPayload = function () { return null; };

        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-NULL');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.transactionId = 'TXN-NULL';

        var item = processUpdateQueue.process(co);
        assert.include(item.error, 'Failed to parse');
    });

    it('should return parsedData on successful process', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-OK');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.transactionId = 'TXN-OK';
        co.custom.merchantId = 'MID-1';

        var item = processUpdateQueue.process(co);
        assert.isNull(item.error);
        assert.equal(item.parsedData.merchantRecordIdentifier, 'pi-uuid-CN-CUST001');
        assert.equal(item.co.keyValue, 'TXN-OK');
    });

    // ─── write ───────────────────────────────────────────────────────────────

    it('should do nothing when items list is empty', function () {
        processUpdateQueue.write(makeItemsList([]));
        // no error thrown
    });

    it('should do nothing when items is null', function () {
        processUpdateQueue.write(null);
    });

    it('should skip items with null co', function () {
        var items = makeItemsList([{ co: null, parsedData: null }, null]);
        processUpdateQueue.write(items);
    });

    it('should remove CO on successful wallet update', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-SUCCESS');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.notificationID = 'TXN-SUCCESS';

        var items = makeItemsList([{ co: co, parsedData: { merchantRecordIdentifier: 'pi-uuid-CN-CUST001' } }]);
        processUpdateQueue.write(items);

        assert.isNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-SUCCESS'));
    });

    it('should mark CO as ERROR when item carries process error', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-WRITE-ERR');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.retryCount = 0;
        co.custom.notificationID = 'TXN-WRITE-ERR';

        var items = makeItemsList([{ co: co, error: 'Missing transactionId on queue record' }]);
        processUpdateQueue.write(items);

        var saved = CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-WRITE-ERR');
        assert.equal(saved.custom.status, constants.ACCOUNT_UPDATER.STATUS_ERROR);
        assert.include(saved.custom.lastError, 'Missing transactionId');
        assert.equal(saved.custom.retryCount, 1);
    });

    it('should mark CO as ERROR when wallet update fails', function () {
        accountUpdaterHelperMock.updateCustomerWallet = function () {
            return { success: false, error: 'PaymentInstrument not found for mri=abc' };
        };

        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-UPD-FAIL');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.retryCount = 2;
        co.custom.notificationID = 'TXN-UPD-FAIL';

        var items = makeItemsList([{ co: co, parsedData: { merchantRecordIdentifier: 'abc' } }]);
        processUpdateQueue.write(items);

        var saved = CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-UPD-FAIL');
        assert.equal(saved.custom.status, constants.ACCOUNT_UPDATER.STATUS_ERROR);
        assert.include(saved.custom.lastError, 'PaymentInstrument not found');
        assert.equal(saved.custom.retryCount, 3);
    });

    it('should truncate lastError when message exceeds 4000 chars', function () {
        var longError = new Array(5000).join('X');

        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-LONG');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.retryCount = 0;

        var items = makeItemsList([{ co: co, error: longError }]);
        processUpdateQueue.write(items);

        var saved = CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-LONG');
        assert.equal(saved.custom.lastError.length, 4000);
    });

    it('should use fallback notificationId when co.custom.notificationID throws', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-KEYERR');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.retryCount = 0;

        Object.defineProperty(co.custom, 'notificationID', {
            get: function () { throw new Error('Key not found'); },
            configurable: true
        });

        var items = makeItemsList([{ co: co, error: 'Some error' }]);
        processUpdateQueue.write(items);

        var saved = CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-KEYERR');
        assert.equal(saved.custom.status, constants.ACCOUNT_UPDATER.STATUS_ERROR);
    });

    it('should process mixed success and error items in one chunk', function () {
        var co1 = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-MIX-OK');
        co1.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co1.custom.notificationID = 'TXN-MIX-OK';

        var co2 = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-MIX-ERR');
        co2.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co2.custom.retryCount = 0;
        co2.custom.notificationID = 'TXN-MIX-ERR';

        var items = makeItemsList([
            { co: co1, parsedData: { merchantRecordIdentifier: 'pi-uuid-CN-CUST001' } },
            { co: co2, error: 'fetch failed' }
        ]);
        processUpdateQueue.write(items);

        assert.isNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-MIX-OK'));
        var errSaved = CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'TXN-MIX-ERR');
        assert.equal(errSaved.custom.status, constants.ACCOUNT_UPDATER.STATUS_ERROR);
    });

    // ─── afterStep ───────────────────────────────────────────────────────────

    it('should close iterator in afterStep', function () {
        var closed = false;
        var originalQuery = CustomObjectMgrMock.queryCustomObjects;

        CustomObjectMgrMock.queryCustomObjects = function () {
            return {
                count: 0,
                hasNext: function () { return false; },
                next: function () { return null; },
                close: function () { closed = true; }
            };
        };

        processUpdateQueue.beforeStep({}, {});
        processUpdateQueue.afterStep(true, {}, {});

        assert.isTrue(closed);
        CustomObjectMgrMock.queryCustomObjects = originalQuery;
    });

    it('should handle iterator.close throwing in afterStep', function () {
        var originalQuery = CustomObjectMgrMock.queryCustomObjects;

        CustomObjectMgrMock.queryCustomObjects = function () {
            return {
                count: 0,
                hasNext: function () { return false; },
                next: function () { return null; },
                close: function () { throw new Error('Close failed'); }
            };
        };

        processUpdateQueue.beforeStep({}, {});
        // should not throw
        processUpdateQueue.afterStep(false, {}, {});

        CustomObjectMgrMock.queryCustomObjects = originalQuery;
    });

    it('should handle afterStep when no iterator exists', function () {
        processUpdateQueue.afterStep(true, {}, {});
        // should not throw
    });
});
