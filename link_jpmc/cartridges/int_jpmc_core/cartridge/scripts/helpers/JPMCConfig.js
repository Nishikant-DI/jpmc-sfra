'use strict';

var Logger = require('dw/system/Logger').getLogger('JPMC', 'config');
var constants = require('*/cartridge/scripts/helpers/jpmcConstants');

/**
 * @param {dw.system.SitePreferences} prefs
 * @param {string} key
 * @param {boolean} [required]
 * @returns {*}
 */
function getSitePreference(prefs, key, required) {
    if (!prefs) {
        if (required) throw new Error('Site preferences unavailable');
        return null;
    }

    var value = prefs.getCustom()[key];

    if (value !== null && value !== undefined && value !== '') {
        return value;
    }

    if (required) {
        throw new Error('Required preference not configured: ' + key);
    }

    return null;
}

/**
 * @returns {Object}
 * @throws {Error}
 */
function getAccessTokenConfig() {
    var Site = require('dw/system/Site');
    var prefs = Site.getCurrent().getPreferences();

    return {
        client_id: getSitePreference(prefs, 'JPMCClientID', true),
        merchantId: getSitePreference(prefs, 'JPMC_MerchantCode', true),
        certAlias: getSitePreference(prefs, 'JPMCCertAlias', false) || constants.DEFAULT_CERT_ALIAS,
        privateKeyAlias: getSitePreference(prefs, 'JPMCPrivateKeyAlias', false) || constants.DEFAULT_KEY_ALIAS,
        expiresIn: getSitePreference(prefs, 'JPMCExpiresIn', false) || constants.DEFAULT_EXPIRES_IN,
        audience: getSitePreference(prefs, 'JPMCAudience', true),
        resource_id: getSitePreference(prefs, 'JPMCResourceID', true),
        ida_url: getSitePreference(prefs, 'JPMCTokenURI', true),
        kid: getSitePreference(prefs, 'jpmc_kid', false)
    };
}

/**
 * @param {string} key
 * @param {boolean} [required]
 * @returns {*}
 */
function getPreference(key, required) {
    var Site = require('dw/system/Site');
    return getSitePreference(Site.getCurrent().getPreferences(), key, required);
}

/**
 * @returns {Object}
 * @throws {Error}
 */
function getConfig() {
    var Site = require('dw/system/Site');
    var prefs = Site.getCurrent().getPreferences();

    var tokenType = getSitePreference(prefs, 'JPMCTokenizationType', false);

    return {
        merchantId: getSitePreference(prefs, 'JPMC_MerchantCode', true),
        merchantSoftware: {
            companyName: getSitePreference(prefs, 'JPMCMerchantSoftwareCompany', false) || constants.DEFAULT_COMPANY_NAME,
            productName: getSitePreference(prefs, 'JPMCMerchantSoftwareProduct', false) || constants.DEFAULT_PRODUCT_NAME,
            version: getSitePreference(prefs, 'JPMCMerchantSoftwareVersion', false) || constants.DEFAULT_VERSION
        },
        platformId: getSitePreference(prefs, 'JPMCPlatformId', false),
        accountNumberType: (tokenType && tokenType.value) || constants.DEFAULT_TOKEN_TYPE
    };
}

/**
 * @returns {string}
 */
function getCaptureMethod() {
    var methodPref = getPreference('JPMCCaptureMethod', false);
    var methodValue = null;

    if (methodPref && typeof methodPref === 'object' && Object.prototype.hasOwnProperty.call(methodPref, 'value')) {
        methodValue = methodPref.value;
    } else if (typeof methodPref === 'string') {
        methodValue = methodPref;
    }

    var method = methodValue || constants.DEFAULT_CAPTURE_METHOD;
    return constants.VALID_CAPTURE_METHODS.indexOf(method) !== -1 ? method : constants.DEFAULT_CAPTURE_METHOD;
}

/**
 * @returns {boolean}
 */
function isFraudCheckEnabled() {
    var val = getPreference('JPMCEnableFraudCheck', false);
    return val === true || val === 'true';
}

/**
 * @returns {boolean}
 */
function isFraudCheckEnabledAtAuth() {
    var val = getPreference('JPMCEnableFraudCheckAtAuth', false);
    return val === true || val === 'true';
}

/**
 * Checks if Address Verification Service (AVS) is enabled
 * When enabled, billing address is included in Verify and Auth API payloads
 * @returns {boolean}
 */
function isAVSEnabled() {
    var val = getPreference('JPMCEnableAVS', false);
    return val === true || val === 'true';
}

/**
 * Gets Google Pay configuration from site preferences.
 * All values must come from Site Preferences — no hardcoded defaults.
 * @returns {Object}
 */
function getGooglePayConfig() {
    var Site = require('dw/system/Site');
    var PaymentMgr = require('dw/order/PaymentMgr');
    var prefs = Site.getCurrent().getPreferences();

    var googlePayMethod = PaymentMgr.getPaymentMethod('JPMC_GOOGLE_PAY');
    if (!googlePayMethod || !googlePayMethod.isActive()) {
        return { enabled: false };
    }

    var environmentEnum = getSitePreference(prefs, 'JPMCGooglePayEnvironment', false);
    var environment = (environmentEnum && environmentEnum.value) ? environmentEnum.value : null;
    if (!environment) {
        Logger.error('JPMCGooglePayEnvironment not configured');
        return { enabled: false, error: true };
    }

    var gateway = getSitePreference(prefs, 'JPMCGooglePayGateway', false);
    if (!gateway) {
        Logger.error('JPMCGooglePayGateway not configured');
        return { enabled: false, error: true };
    }

    var gatewayMerchantId = getSitePreference(prefs, 'JPMCGooglePayGatewayMerchantId', false);
    if (!gatewayMerchantId) {
        Logger.error('JPMCGooglePayGatewayMerchantId not configured');
        return { enabled: false, error: true };
    }

    var merchantName = getSitePreference(prefs, 'JPMCGooglePayMerchantName', false);
    if (!merchantName) {
        Logger.error('JPMCGooglePayMerchantName not configured');
        return { enabled: false, error: true };
    }

    var allowedCardNetworksStr = getSitePreference(prefs, 'JPMCGooglePayAllowedCardNetworks', false);
    if (!allowedCardNetworksStr) {
        Logger.error('JPMCGooglePayAllowedCardNetworks not configured');
        return { enabled: false, error: true };
    }

    var allowedCardNetworks = allowedCardNetworksStr.split(',').map(function (n) {
        return n.trim();
    }).filter(function (n) {
        return n.length > 0;
    });

    if (!allowedCardNetworks.length) {
        Logger.error('JPMCGooglePayAllowedCardNetworks is empty after parsing');
        return { enabled: false, error: true };
    }

    var allowedAuthMethodsStr = getSitePreference(prefs, 'JPMCGooglePayAllowedAuthMethods', false);
    if (!allowedAuthMethodsStr) {
        Logger.error('JPMCGooglePayAllowedAuthMethods not configured');
        return { enabled: false, error: true };
    }

    var allowedAuthMethods = allowedAuthMethodsStr.split(',').map(function (m) {
        return m.trim();
    }).filter(function (m) {
        return m.length > 0;
    });

    if (!allowedAuthMethods.length) {
        Logger.error('JPMCGooglePayAllowedAuthMethods is empty after parsing');
        return { enabled: false, error: true };
    }

    var googlePayMerchantId = getSitePreference(prefs, 'JPMCGooglePayMerchantId', false);
    if (environment === 'PRODUCTION' && !googlePayMerchantId) {
        Logger.error('JPMCGooglePayMerchantId required for PRODUCTION environment');
        return { enabled: false, error: true };
    }

    return {
        enabled: true,
        environment: environment,
        gateway: gateway,
        gatewayMerchantId: gatewayMerchantId,
        googlePayMerchantId: googlePayMerchantId || '',
        merchantName: merchantName,
        allowedCardNetworks: allowedCardNetworks,
        allowedAuthMethods: allowedAuthMethods
    };
}

/**
 * Returns whether Google Pay should be shown on the cart page.
 * Checkout always shows Google Pay; this flag additionally enables it on the cart.
 * @returns {boolean}
 */
function isGooglePayOnCartEnabled() {
    var val = getPreference('JPMCGooglePayCartEnabled', false);
    return val === true || val === 'true';
}

/**
 * Returns whether Google Pay should be shown on the product detail page.
 * @returns {boolean}
 */
function isGooglePayOnPDPEnabled() {
    var val = getPreference('JPMCGooglePayPDPEnabled', false);
    return val === true || val === 'true';
}

module.exports = {
    getAccessTokenConfig: getAccessTokenConfig,
    getPreference: getPreference,
    getConfig: getConfig,
    getCaptureMethod: getCaptureMethod,
    getGooglePayConfig: getGooglePayConfig,
    isGooglePayOnCartEnabled: isGooglePayOnCartEnabled,
    isGooglePayOnPDPEnabled: isGooglePayOnPDPEnabled,
    isFraudCheckEnabled: isFraudCheckEnabled,
    isFraudCheckEnabledAtAuth: isFraudCheckEnabledAtAuth,
    isAVSEnabled: isAVSEnabled
};
