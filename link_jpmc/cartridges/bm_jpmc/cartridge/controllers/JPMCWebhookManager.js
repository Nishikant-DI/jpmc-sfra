'use strict';

/**
 * @module controllers/JPMCWebhookManager
 */

var ISML = require('dw/template/ISML');
var Site = require('dw/system/Site');
var csrfProtection = require('dw/web/CSRFProtection');
var Resource = require('dw/web/Resource');
var Logger = require('dw/system/Logger').getLogger('JPMC', 'webhook-manager');

var RESOURCE_BUNDLE = 'jpmcbm';
var CO_TYPE = 'JPMCMerchantConfig';

/**
 * buildCsrfBlock - Creates CSRF token block for template rendering
 * @returns {Object} Csrf token block for template rendering
 */
function buildCsrfBlock() {
    return {
        tokenName: csrfProtection.getTokenName(),
        token: csrfProtection.generateToken()
    };
}

/**
 * getMerchantResolver - Returns JPMCMerchantResolver module
 * @returns {Object} JPMCMerchantResolver module
 */
function getMerchantResolver() {
    return require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
}

/**
 * getAccountUpdaterHelper - Returns AccountUpdaterHelper module
 * @returns {Object} AccountUpdaterHelper module
 */
function getAccountUpdaterHelper() {
    return require('*/cartridge/scripts/helpers/AccountUpdaterHelper');
}

/**
 * buildMultiMerchantRows - Builds rows of merchant configurations for multi-merchant setup
 * @returns {Array} rows of merchant configurations for multi-merchant setup
 */
function buildMultiMerchantRows() {
    var CustomObjectMgr = require('dw/object/CustomObjectMgr');
    var rows = [];
    var cos = CustomObjectMgr.getAllCustomObjects(CO_TYPE);

    try {
        while (cos.hasNext()) {
            var co = cos.next();
            var configKey = co.custom.configKey || '';
            var locale = configKey.split('::')[1] || '';

            if (!locale || locale === 'default') {
                continue;
            }

            rows.push({
                locale: locale,
                configKey: configKey,
                merchantId: co.custom.merchantId || '',
                subscriptionId: co.custom.jpmcWebhookSubscriptionId || '',
                subscribed: !!co.custom.jpmcWebhookSubscriptionId
            });
        }
    } finally {
        cos.close();
    }

    return rows;
}

/**
 * buildSubscriptionRows - Builds rows of merchant configurations for template rendering
 * @returns {Array} rows of merchant configurations for template rendering
 */
function buildSubscriptionRows() {
    var Resolver = getMerchantResolver();
    var siteId = Site.getCurrent().getID();

    if (Resolver.isMultiMerchantEnabled()) {
        return buildMultiMerchantRows();
    }

    var prefs = Site.getCurrent().getPreferences().getCustom();
    return [{
        locale: 'default',
        configKey: siteId + '::default',
        merchantId: prefs.JPMC_MerchantCode || '',
        subscriptionId: prefs.jpmcWebhookSubscriptionId || '',
        subscribed: !!prefs.jpmcWebhookSubscriptionId
    }];
}

/**
 * renderList
 * @param {string} message - message to display
 * @param {string} error - error message to display
 */
function renderList(message, error) {
    ISML.renderTemplate('webhookmanager/list', {
        rows: buildSubscriptionRows(),
        siteId: Site.getCurrent().getID(),
        multiMerchantEnabled: getMerchantResolver().isMultiMerchantEnabled(),
        csrf: buildCsrfBlock(),
        message: message || null,
        error: error || null
    });
}

/**
 * renderSuccess
 * @param {string} messageKey - message key
 * @param {string} substitution - optional substitution for message
 */
function renderSuccess(messageKey, substitution) {
    var message = substitution
        ? Resource.msgf(messageKey, RESOURCE_BUNDLE, null, substitution)
        : Resource.msg(messageKey, RESOURCE_BUNDLE, null);
    renderList(message, null);
}

/**
 * renderFailure
 * @param {Object} result - result object containing error information
 */
function renderFailure(result) {
    var fallback = Resource.msg('webhook.error.generic', RESOURCE_BUNDLE, null);
    renderList(null, (result && result.error) || fallback);
}

/**
 * handleAction
 * @param {string} actionName - action name
 * @param {Function} onSuccess - on success callback
 */
function handleAction(actionName, onSuccess) {
    if (!csrfProtection.validateRequest()) {
        ISML.renderTemplate('csrfFail');
        return;
    }

    var configKey = request.httpParameterMap.configKey.stringValue || '';

    try {
        var result = getAccountUpdaterHelper()[actionName](configKey);
        if (result.success) {
            onSuccess(result);
        } else {
            renderFailure(result);
        }
    } catch (e) {
        Logger.error('{0}: {1}', actionName, e instanceof Error ? e.message : String(e));
        renderList(null, Resource.msg('webhook.error.generic', RESOURCE_BUNDLE, null));
    }
}

/**
 * JPMCWebhookManager-List : Displays Account Updater webhook subscription management page
 * @name JPMCWebhookManager-List
 * @function
 * @memberof JPMCWebhookManager
 */
exports.List = function () {
    renderList(null, null);
};
exports.List.public = true;

/**
 * JPMCWebhookManager-Subscribe : Creates new Account Updater webhook subscription
 * @name JPMCWebhookManager-Subscribe
 * @function
 * @memberof JPMCWebhookManager
 */
exports.Subscribe = function () {
    handleAction('subscribe', function (result) {
        renderSuccess('webhook.msg.subscribed', result.subscriptionId);
    });
};
exports.Subscribe.public = true;

/**
 * JPMCWebhookManager-Delete : Deletes existing Account Updater webhook subscription
 * @name JPMCWebhookManager-Delete
 * @function
 * @memberof JPMCWebhookManager
 */
exports.Delete = function () {
    handleAction('deleteSubscription', function () {
        renderSuccess('webhook.msg.deleted');
    });
};
exports.Delete.public = true;

/**
 * JPMCWebhookManager-Update : Updates existing Account Updater webhook subscription
 * @name JPMCWebhookManager-Update
 * @function
 * @memberof JPMCWebhookManager
 */
exports.Update = function () {
    handleAction('updateSubscription', function (result) {
        renderSuccess('webhook.msg.updated', result.subscriptionId);
    });
};
exports.Update.public = true;
