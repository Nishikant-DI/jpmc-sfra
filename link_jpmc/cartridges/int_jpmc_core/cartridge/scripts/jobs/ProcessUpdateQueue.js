'use strict';

/**
 * @module scripts/jobs/ProcessUpdateQueue
 */

var Logger = require('dw/system/Logger').getLogger('AccountUpdater', 'job');

var iterator = null;
var totalCount = 0;

/**
 * beforeStep
 * @param {Object} parameters - job parameters
 * @param {dw.job.JobStepExecution} stepExecution - step execution
 */
function beforeStep(parameters, stepExecution) { // eslint-disable-line no-unused-vars
    var CustomObjectMgr = require('dw/object/CustomObjectMgr');
    var constants = require('*/cartridge/scripts/helpers/JPMCConstants');
    var AU = constants.ACCOUNT_UPDATER;

    iterator = CustomObjectMgr.queryCustomObjects(
        AU.QUEUE_CO_TYPE,
        'custom.status = {0} OR custom.status = {1}',
        'creationDate asc',
        AU.STATUS_NEW,
        AU.STATUS_ERROR
    );

    totalCount = (iterator && typeof iterator.count === 'number') ? iterator.count : 0;
    Logger.info('JPMCProcessUpdateQueue: beforeStep - queued count={0}', totalCount);
}

/**
 * getTotalCount
 * @returns {number} total count
 */
function getTotalCount() {
    return totalCount;
}

/**
 * read
 * @returns {dw.object.CustomObject|null} next item
 */
function read() {
    if (iterator && iterator.hasNext()) {
        return iterator.next();
    }
    return null;
}

/**
 * process
 * @param {dw.object.CustomObject} co - custom object
 * @returns {Object|null} processed item
 */
function process(co) {
    if (!co) {
        return null;
    }

    var item = { co: co, parsedData: null, error: null };
    var transactionId = co.custom.transactionId;
    var merchantId = co.custom.merchantId;

    if (!transactionId) {
        item.error = 'Missing transactionId on queue record';
        return item;
    }

    var accountUpdaterHelper = require('*/cartridge/scripts/helpers/AccountUpdaterHelper');

    var fetchResult = accountUpdaterHelper.fetchAccountUpdate(transactionId, merchantId);
    if (!fetchResult.success || !fetchResult.data) {
        item.error = 'GET /account-updates failed: ' + (fetchResult.error || 'unknown error');
        return item;
    }

    var parsed = accountUpdaterHelper.parseAccountUpdaterPayload(fetchResult.data);
    if (!parsed || !parsed.merchantRecordIdentifier) {
        item.error = 'Failed to parse GET response or missing merchantRecordIdentifier';
        return item;
    }

    item.parsedData = parsed;
    return item;
}

/**
 * truncateError
 * @param {string} message - error message
 * @returns {string} truncated message
 */
function truncateError(message) {
    var safe = message ? String(message) : 'Unknown error';
    return safe.length > 4000 ? safe.substring(0, 4000) : safe;
}

/**
 * write
 * @param {dw.util.Collection} items - items to write
 */
function write(items) {
    if (!items || items.empty) {
        return;
    }

    var CustomObjectMgr = require('dw/object/CustomObjectMgr');
    var Transaction = require('dw/system/Transaction');
    var accountUpdaterHelper = require('*/cartridge/scripts/helpers/AccountUpdaterHelper');
    var constants = require('*/cartridge/scripts/helpers/JPMCConstants');
    var AU = constants.ACCOUNT_UPDATER;

    var iter = items.iterator();
    var successCount = 0;
    var errorCount = 0;

    while (iter.hasNext()) {
        var item = iter.next();
        if (!item || !item.co) {
            continue;
        }

        var co = item.co;
        var notificationId;
        try {
            notificationId = co.custom.notificationID || '';
        } catch (idErr) {
            notificationId = '<unknown>';
        }

        try {
            if (item.error) {
                Transaction.wrap(function () {
                    co.custom.status = AU.STATUS_ERROR;
                    co.custom.lastError = truncateError(item.error);
                    co.custom.retryCount = (co.custom.retryCount || 0) + 1;
                });
                errorCount++;
                Logger.error('JPMCProcessUpdateQueue: marked ERROR - id={0}, reason={1}',
                    notificationId, item.error);
                continue;
            }

            var updateResult;
            var merchantId = co.custom.merchantId || null;
            Transaction.wrap(function () {
                updateResult = accountUpdaterHelper.updateCustomerWallet(item.parsedData, merchantId);
                if (updateResult.success) {
                    CustomObjectMgr.remove(co);
                } else {
                    co.custom.status = AU.STATUS_ERROR;
                    co.custom.lastError = truncateError(updateResult.error);
                    co.custom.retryCount = (co.custom.retryCount || 0) + 1;
                }
            });
            if (updateResult.success) {
                successCount++;
            } else {
                errorCount++;
                Logger.error('JPMCProcessUpdateQueue: wallet update failed - id={0}, error={1}',
                    notificationId, updateResult.error);
            }
        } catch (txErr) {
            errorCount++;
            Logger.error('JPMCProcessUpdateQueue: transaction failed - id={0}, error={1}',
                notificationId, txErr.message || String(txErr));
        }
    }

    Logger.info('JPMCProcessUpdateQueue: chunk written - success={0}, error={1}',
        successCount, errorCount);
}

/**
 * afterStep
 * @param {boolean} success - whether step succeeded
 * @param {Object} parameters - job parameters
 * @param {dw.job.JobStepExecution} stepExecution - step execution
 */
function afterStep(success, parameters, stepExecution) { // eslint-disable-line no-unused-vars
    if (iterator) {
        try {
            iterator.close();
        } catch (closeError) {
            Logger.warn('JPMCProcessUpdateQueue: iterator close failed - {0}',
                closeError.message || String(closeError));
        }
        iterator = null;
    }
}

exports.beforeStep = beforeStep;
exports.getTotalCount = getTotalCount;
exports.read = read;
exports.process = process;
exports.write = write;
exports.afterStep = afterStep;
