'use strict';

/**
 * AccountUpdater webhook endpoint. Receives notifications, filters actionable events, queues for processing.
 * @module controllers/AccountUpdater
 */

var server = require('server');
var Logger = require('dw/system/Logger').getLogger('AccountUpdater', 'controller');

/**
 * respondJson
 * @param {Object} res - response object
 * @param {number} statusCode - status code
 * @param {Object} body - response body
 */
function respondJson(res, statusCode, body) {
    res.setStatusCode(statusCode);
    res.json(body);
}

server.post('Notify', server.middleware.https, function (req, res, next) {
    var accountUpdaterHelper = require('*/cartridge/scripts/helpers/AccountUpdaterHelper');
    var constants = require('*/cartridge/scripts/helpers/JPMCConstants');
    var AU = constants.ACCOUNT_UPDATER;
    var notificationBody = req.httpParameterMap.requestBodyAsString || '';
    var authHeaderValue = req.httpHeaders ? req.httpHeaders.get('authorization') : null;
    Logger.debug('Notify: received webhook notification - body={0}, authHeader present={1}',
        notificationBody, !!authHeaderValue);
    if (!accountUpdaterHelper.authenticateWebhook(req, req.locale && req.locale.id)) {
        respondJson(res, 401, { error: 'Authentication failed' });
        return next();
    }

    var rawBody = notificationBody;
    if (!rawBody) {
        respondJson(res, 400, { error: 'Invalid request' });
        return next();
    }

    var webhookBody;
    try {
        webhookBody = JSON.parse(rawBody);
    } catch (parseError) {
        respondJson(res, 400, { error: 'Invalid request' });
        return next();
    }

    var notification = accountUpdaterHelper.parseWebhookNotification(webhookBody);
    if (!notification) {
        respondJson(res, 400, { error: 'Invalid request' });
        return next();
    }

    var notificationId = notification.notificationId;
    Logger.debug('Notify: processing notification - id={0}, reason={1}', notificationId, notification.reasonMessage);
    var reasonMessage = notification.reasonMessage;

    if (!AU.ACTIONABLE_REASONS[reasonMessage]) {
        respondJson(res, 200, { status: 'discarded' });
        return next();
    }

    var CustomObjectMgr = require('dw/object/CustomObjectMgr');
    try {
        var existing = CustomObjectMgr.getCustomObject(AU.QUEUE_CO_TYPE, notificationId);
        if (existing) {
            Logger.debug('Notify: duplicate notification - id={0}', notificationId);
            respondJson(res, 200, { status: 'duplicate' });
            return next();
        }
    } catch (lookupError) {
        Logger.error('Notify: idempotency lookup failed - id={0}, error={1}',
            notificationId, lookupError.message || String(lookupError));
        respondJson(res, 500, { error: 'Internal server error' });
        return next();
    }

    try {
        var Transaction = require('dw/system/Transaction');

        Transaction.wrap(function () {
            var co = CustomObjectMgr.createCustomObject(AU.QUEUE_CO_TYPE, notificationId);
            co.custom.transactionId = notification.transactionId;
            co.custom.merchantId = notification.merchantId;
            co.custom.reasonMessage = reasonMessage;
            co.custom.merchantRecordIdentifier = notification.merchantRecordIdentifier;
            co.custom.status = AU.STATUS_NEW;
            co.custom.retryCount = 0;
            co.custom.receivedTimestamp = new Date();
        });
        Logger.debug('Notify: queued notification for processing - id={0}', notificationId);
        respondJson(res, 200, { status: 'received' });
    } catch (persistError) {
        Logger.error('Notify: failed to persist - id={0}, error={1}',
            notificationId, persistError.message || String(persistError));
        respondJson(res, 500, { error: 'Internal server error' });
    }

    return next();
});

module.exports = server.exports();