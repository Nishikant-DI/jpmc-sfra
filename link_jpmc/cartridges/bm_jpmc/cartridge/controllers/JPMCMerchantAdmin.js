'use strict';

var ISML = require('dw/template/ISML');
var Transaction = require('dw/system/Transaction');
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Site = require('dw/system/Site');
var csrfProtection = require('dw/web/CSRFProtection');
var Resource = require('dw/web/Resource');
var Logger = require('dw/system/Logger').getLogger('JPMC', 'merchant-admin');

var CO_TYPE = 'JPMCMerchantConfig';
var RESOURCE_BUNDLE = 'jpmcbm';

/**
 * Returns true when the JPMCEnableMultiMerchant site preference is enabled.
 * @returns {boolean}
 */
function isMultiMerchantEnabled() {
    var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
    return JPMCMerchantResolver.isMultiMerchantEnabled();
}

/**
 * Renders the list template with a feature-disabled notice and halts further processing.
 */
function renderDisabled() {
    ISML.renderTemplate('merchantadmin/list', {
        configs: [],
        siteId: Site.getCurrent().getID(),
        csrf: buildCsrfBlock(),
        multiMerchantEnabled: false
    });
}

function getAllowedLocales() {
    var locales = [];
    var allowedLocales = Site.getCurrent().getAllowedLocales();

    for (var i = 0; i < allowedLocales.size(); i++) {
        var locale = String(allowedLocales.get(i));
        if (locale !== 'default') {
            locales.push(locale);
        }
    }
    return locales;
}

function buildCsrfBlock() {
    return {
        tokenName: csrfProtection.getTokenName(),
        token: csrfProtection.generateToken()
    };
}

function buildEditPdict(config, isNew, error) {
    var pdict = {
        config: config,
        isNew: isNew,
        csrf: buildCsrfBlock(),
        availableLocales: getAllowedLocales(),
        siteId: Site.getCurrent().getID()
    };
    if (error) {
        pdict.error = error;
    }
    return pdict;
}

function getCustomObject(configKey) {
    return CustomObjectMgr.getCustomObject(CO_TYPE, configKey);
}

function renderListError(error) {
    ISML.renderTemplate('merchantadmin/list', {
        error: error,
        configs: [],
        siteId: Site.getCurrent().getID(),
        csrf: buildCsrfBlock()
    });
}

exports.List = function () {
    var multiMerchantEnabled = isMultiMerchantEnabled();
    var siteId = Site.getCurrent().getID();
    var configs = [];

    if (!multiMerchantEnabled) {
        renderDisabled();
        return;
    }

    var cos = CustomObjectMgr.getAllCustomObjects(CO_TYPE);

    try {
        while (cos.hasNext()) {
            var co = cos.next();
            var configKey = co.custom.configKey || '';
            var parts = configKey.split('::');
            var locale = parts.length > 1 ? parts[1] : '';

            if (locale && locale !== 'default') {
                configs.push({
                    configKey: configKey,
                    locale: locale,
                    merchantId: co.custom.merchantId || '',
                    enabled: co.custom.enabled !== false
                });
            }
        }
    } finally {
        cos.close();
    }

    ISML.renderTemplate('merchantadmin/list', {
        configs: configs,
        siteId: siteId,
        csrf: buildCsrfBlock(),
        multiMerchantEnabled: true
    });
};
exports.List.public = true;

exports.Edit = function () {
    if (!isMultiMerchantEnabled()) { renderDisabled(); return; }

    var configKey = request.httpParameterMap.configKey.stringValue || '';

    if (!configKey) {
        renderListError(Resource.msg('error.config.notfound', RESOURCE_BUNDLE, null));
        return;
    }

    var co = getCustomObject(configKey);
    if (!co) {
        renderListError(Resource.msg('error.config.notfound', RESOURCE_BUNDLE, null));
        return;
    }

    var MerchantConfigHelper = require('~/cartridge/scripts/helpers/MerchantConfigHelper');
    var config = MerchantConfigHelper.buildEditConfig(co, true);
    ISML.renderTemplate('merchantadmin/edit', buildEditPdict(config, false, null));
};
exports.Edit.public = true;

exports.New = function () {
    if (!isMultiMerchantEnabled()) { renderDisabled(); return; }

    var MerchantConfigHelper = require('~/cartridge/scripts/helpers/MerchantConfigHelper');
    var config = MerchantConfigHelper.getDefaultConfig();
    config.configKey = '';
    config.locale = '';

    ISML.renderTemplate('merchantadmin/edit', buildEditPdict(config, true, null));
};
exports.New.public = true;

exports.GetLocaleConfig = function () {
    if (!isMultiMerchantEnabled()) {
        response.setStatus(403);
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ error: Resource.msg('error.multimerchant.disabled', RESOURCE_BUNDLE, null) }));
        return;
    }

    if (!csrfProtection.validateRequest()) {
        response.setStatus(403);
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ error: 'CSRF validation failed' }));
        return;
    }

    var MerchantConfigHelper = require('~/cartridge/scripts/helpers/MerchantConfigHelper');
    var locale = request.httpParameterMap.locale.stringValue || '';
    var siteId = Site.getCurrent().getID();

    if (!locale) {
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ configKey: '', data: MerchantConfigHelper.getDefaultConfig() }));
        return;
    }

    var configKey = siteId + '::' + locale;
    var co = getCustomObject(configKey);

    var result = {
        configKey: configKey,
        data: MerchantConfigHelper.getDefaultConfig()
    };

    if (co) {
        result.data = MerchantConfigHelper.buildEditConfig(co, true);
    }

    response.setContentType('application/json');
    response.writer.print(JSON.stringify(result));
};
exports.GetLocaleConfig.public = true;

exports.Save = function () {
    if (!isMultiMerchantEnabled()) { renderDisabled(); return; }

    if (!csrfProtection.validateRequest()) {
        ISML.renderTemplate('csrfFail');
        return;
    }

    var MerchantConfigHelper = require('~/cartridge/scripts/helpers/MerchantConfigHelper');
    var params = request.httpParameterMap;
    var siteId = Site.getCurrent().getID();
    var locale = params.locale.stringValue || '';
    var isNew = params.configKey.stringValue === '';

    if (!locale) {
        var config = MerchantConfigHelper.buildFromParams(params);
        ISML.renderTemplate('merchantadmin/edit', buildEditPdict(
            config,
            isNew,
            Resource.msg('error.locale.required', RESOURCE_BUNDLE, null)
        ));
        return;
    }

    var allowedLocales = getAllowedLocales();
    if (allowedLocales.indexOf(locale) === -1) {
        var safeConfig = MerchantConfigHelper.buildFromParams(params);
        ISML.renderTemplate('merchantadmin/edit', buildEditPdict(
            safeConfig,
            true,
            Resource.msg('error.locale.required', RESOURCE_BUNDLE, null)
        ));
        return;
    }

    var configKey = siteId + '::' + locale;
    var merchantId = params.merchantId.stringValue || '';

    if (!merchantId) {
        var valConfig = MerchantConfigHelper.buildFromParams(params);
        valConfig.locale = locale;
        ISML.renderTemplate('merchantadmin/edit', buildEditPdict(
            valConfig,
            isNew,
            Resource.msg('error.merchantid.required', RESOURCE_BUNDLE, null)
        ));
        return;
    }

    var wasNew = false;

    try {
        Transaction.wrap(function () {
            var co = getCustomObject(configKey);
            if (!co) {
                co = CustomObjectMgr.createCustomObject(CO_TYPE, configKey);
                wasNew = true;
            }

            var config = MerchantConfigHelper.buildFromParams(params);
            config.configKey = configKey;
            MerchantConfigHelper.assignToCustomObject(co, config);
        });

        var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
        JPMCMerchantResolver.invalidateCache(configKey, merchantId);

        exports.List();
    } catch (e) {
        Logger.error('Failed to save merchant config {0}: {1}', configKey, String(e));
        var config = MerchantConfigHelper.buildFromParams(params);
        config.locale = locale;
        ISML.renderTemplate('merchantadmin/edit', buildEditPdict(
            config,
            wasNew,
            Resource.msg('error.save.failed', RESOURCE_BUNDLE, null)
        ));
    }
};
exports.Save.public = true;

exports.InvalidateCache = function () {
    if (!isMultiMerchantEnabled()) { renderDisabled(); return; }

    if (!csrfProtection.validateRequest()) {
        ISML.renderTemplate('csrfFail');
        return;
    }

    var configKey = request.httpParameterMap.configKey.stringValue || '';

    try {
        var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
        if (configKey) {
            JPMCMerchantResolver.invalidateCache(configKey);
        } else {
            var siteId = Site.getCurrent().getID();
            var cos = CustomObjectMgr.getAllCustomObjects(CO_TYPE);
            try {
                while (cos.hasNext()) {
                    var co = cos.next();
                    JPMCMerchantResolver.invalidateCache(co.custom.configKey, co.custom.merchantId);
                }
            } finally {
                cos.close();
            }
        }
    } catch (e) {
        Logger.error('Failed to invalidate cache: {0}', String(e));
        renderListError(Resource.msg('error.save.failed', RESOURCE_BUNDLE, null));
        return;
    }

    exports.List();
};
exports.InvalidateCache.public = true;

exports.Delete = function () {
    if (!isMultiMerchantEnabled()) { renderDisabled(); return; }

    if (!csrfProtection.validateRequest()) {
        ISML.renderTemplate('csrfFail');
        return;
    }

    var configKey = request.httpParameterMap.configKey.stringValue || '';

    if (!configKey) {
        exports.List();
        return;
    }

    try {
        Transaction.wrap(function () {
            var co = getCustomObject(configKey);
            if (co) {
                CustomObjectMgr.remove(co);
            }
        });

        var JPMCMerchantResolver = require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
        JPMCMerchantResolver.invalidateCache(configKey);
    } catch (e) {
        Logger.error('Failed to delete merchant config {0}: {1}', configKey, String(e));
        renderListError(Resource.msg('error.save.failed', RESOURCE_BUNDLE, null));
        return;
    }
    exports.List();
};
exports.Delete.public = true;
