'use strict';

var Logger = require('dw/system/Logger').getLogger('AccountUpdater', 'job');
var Status = require('dw/system/Status');

/**
 * resolveMaxRetries
 * @param {Object} parameters - job parameters
 * @returns {number} max retries
 */
function resolveMaxRetries(parameters) {
    var parsed = parseInt(parameters && parameters.maxRetries, 10);

    return (!isNaN(parsed) && parsed >= 0) ? parsed : 5;
}

exports.execute = function (parameters, stepExecution) { // eslint-disable-line no-unused-vars
    var CustomObjectMgr = require('dw/object/CustomObjectMgr');
    var Transaction = require('dw/system/Transaction');
    var constants = require('*/cartridge/scripts/helpers/JPMCConstants');
    var AU = constants.ACCOUNT_UPDATER;
    var maxRetries = resolveMaxRetries(parameters);
    var iterator = null;
    var removedCount = 0;

    try {
        iterator = CustomObjectMgr.queryCustomObjects(
            AU.QUEUE_CO_TYPE,
            'custom.status = {0}',
            'creationDate asc',
            AU.STATUS_ERROR
        );

        while (iterator && iterator.hasNext()) {
            var co = iterator.next();
            var retryCount = parseInt(co.custom.retryCount, 10) || 0;

            if (retryCount >= maxRetries) {
                Transaction.wrap(function () {
                    CustomObjectMgr.remove(co);
                });
                removedCount++;
            }
        }

        Logger.info('JPMCClearExhaustedUpdateQueue: completed - removed={0}, maxRetries={1}',
            removedCount, maxRetries);

        return new Status(Status.OK, 'OK',
            'Removed ' + removedCount + ' exhausted queue record(s) with retryCount >= ' + maxRetries);
    } catch (e) {
        Logger.error('JPMCClearExhaustedUpdateQueue: failed - {0}', e.message || String(e));
        return new Status(Status.ERROR, 'ERROR', e.message || String(e));
    } finally {
        if (iterator) {
            try {
                iterator.close();
            } catch (closeError) {
                Logger.warn('JPMCClearExhaustedUpdateQueue: iterator close failed - {0}',
                    closeError.message || String(closeError));
            }
        }
    }
};
