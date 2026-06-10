'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();

describe('JPMCClearExhaustedUpdateQueue', function () {
    var job;
    var LoggerMock;
    var CustomObjectMgrMock;
    var TransactionMock;
    var StatusMock;
    var constants;

    function makeStatusCtor() {
        function Status(code, key, msg) {
            this.code = code;
            this.key = key;
            this.msg = msg;
        }
        Status.OK = 0;
        Status.ERROR = 1;
        return Status;
    }

    beforeEach(function () {
        LoggerMock = require('../../../../../test/mocks/dw/system/Logger');
        CustomObjectMgrMock = require('../../../../../test/mocks/dw/object/CustomObjectMgr');
        TransactionMock = require('../../../../../test/mocks/dw/system/Transaction');

        LoggerMock.resetAllLoggers();
        CustomObjectMgrMock.resetAllCustomObjects();
        TransactionMock.reset();

        StatusMock = makeStatusCtor();
        constants = require('../../../../../cartridges/int_jpmc_core/cartridge/scripts/helpers/JPMCConstants');

        job = proxyquire(
            '../../../../../cartridges/int_jpmc_core/cartridge/scripts/jobs/JPMCClearExhaustedUpdateQueue',
            {
                'dw/system/Logger': LoggerMock,
                'dw/system/Status': StatusMock,
                'dw/system/Transaction': TransactionMock,
                'dw/object/CustomObjectMgr': CustomObjectMgrMock,
                '*/cartridge/scripts/helpers/JPMCConstants': constants
            }
        );
    });

    it('should return OK when no ERROR records exist', function () {
        var result = job.execute({}, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 0');
    });

    it('should remove ERROR records with retryCount >= default maxRetries (5)', function () {
        var co1 = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-1');
        co1.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co1.custom.retryCount = 5;

        var co2 = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-2');
        co2.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co2.custom.retryCount = 10;

        var result = job.execute({}, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 2');
        assert.isNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-1'));
        assert.isNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-2'));
    });

    it('should not remove ERROR records with retryCount below maxRetries', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-LOW');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co.custom.retryCount = 2;

        var result = job.execute({}, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 0');
        assert.isNotNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-LOW'));
    });

    it('should use custom maxRetries from parameters', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-CUST');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co.custom.retryCount = 3;

        var result = job.execute({ maxRetries: '3' }, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 1');
        assert.isNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-CUST'));
    });

    it('should fall back to default maxRetries when parameter is invalid', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-INV');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co.custom.retryCount = 4;

        var result = job.execute({ maxRetries: 'abc' }, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 0');
        assert.isNotNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-INV'));
    });

    it('should fall back to default maxRetries when parameters is null', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-NULL');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co.custom.retryCount = 5;

        var result = job.execute(null, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 1');
    });

    it('should not remove NEW records', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'NEW-1');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;
        co.custom.retryCount = 10;

        var result = job.execute({}, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 0');
        assert.isNotNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'NEW-1'));
    });

    it('should handle mixed records: remove only exhausted ERROR ones', function () {
        var exhausted = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-EX');
        exhausted.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        exhausted.custom.retryCount = 7;

        var retryable = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-RETRY');
        retryable.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        retryable.custom.retryCount = 2;

        var newCo = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'NEW-KEEP');
        newCo.custom.status = constants.ACCOUNT_UPDATER.STATUS_NEW;

        var result = job.execute({}, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 1');
        assert.isNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-EX'));
        assert.isNotNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-RETRY'));
        assert.isNotNull(CustomObjectMgrMock.getCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'NEW-KEEP'));
    });

    it('should return ERROR status when Transaction.wrap throws', function () {
        TransactionMock.wrap = function () { throw new Error('DB failure'); };

        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-TX');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co.custom.retryCount = 5;

        var result = job.execute({}, {});
        assert.equal(result.code, StatusMock.ERROR);
        assert.include(result.msg, 'DB failure');
    });

    it('should handle retryCount as string (parseInt)', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-STR');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co.custom.retryCount = '6';

        var result = job.execute({}, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 1');
    });

    it('should treat missing retryCount as 0', function () {
        var co = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-NORC');
        co.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;

        var result = job.execute({ maxRetries: '0' }, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 1');
    });

    it('should handle maxRetries of 0 (remove all ERROR records)', function () {
        var co1 = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-Z1');
        co1.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co1.custom.retryCount = 0;

        var co2 = CustomObjectMgrMock.createCustomObject(constants.ACCOUNT_UPDATER.QUEUE_CO_TYPE, 'ERR-Z2');
        co2.custom.status = constants.ACCOUNT_UPDATER.STATUS_ERROR;
        co2.custom.retryCount = 1;

        var result = job.execute({ maxRetries: '0' }, {});
        assert.equal(result.code, StatusMock.OK);
        assert.include(result.msg, 'Removed 2');
    });
});
