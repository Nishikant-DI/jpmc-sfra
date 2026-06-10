'use strict';

var MASKED_VALUE = '***********';

/**
 * @param {dw.value.EnumValue|string|null} val - The attribute value
 * @param {string} defaultVal - Default if value is empty/null
 * @returns {string} The string value of the enum, or the default if input is empty/null
 */
function safeEnumString(val, defaultVal) {
    if (!val) {
        return defaultVal;
    }
    if (typeof val === 'string') {
        return val;
    }
    return (val.value) ? String(val.value) : defaultVal;
}

var defaultConfig = {
    enabled: true,
    merchantId: '',
    clientId: '',
    resourceId: 'JPMC:URI:RS-105239-85484-HelixAPIEntitlementsCAT-PROD',
    certAlias: '',
    privateKeyAlias: '',
    kid: '',
    pieGetKeyUrl: 'https://safetechpageencryptionvar.chasepaymentech.com/pie/v1',
    pieEncryptionUrl: 'https://safetechpageencryptionvar.chasepaymentech.com/pie/v1/encryption.js',
    pieKey: '',
    captureMethod: 'MANUAL',
    platformId: '',
    tokenizationType: 'SAFETECH_TOKEN',
    enableAVS: true,
    enableFraudCheck: false,
    enableFraudCheckAtAuth: false,
    googlePayEnvironment: 'TEST',
    googlePayGateway: '',
    googlePayGatewayMerchantId: '',
    googlePayMerchantId: '',
    googlePayMerchantName: '',
    googlePayAllowedCardNetworks: '',
    googlePayAllowedAuthMethods: '',
    JPMCGooglePayCartEnabled: false,
    JPMCGooglePayPDPEnabled: false,
    applePayMerchantId: '',
    kountClientId: '',
    kountEnvironment: 'TEST',
    accountUpdaterMode: 'NONE',
    accountUpdaterWebhookUser: '',
    accountUpdaterWebhookSecret: '',
    jpmc3DSEnabled: false
};
Object.freeze(defaultConfig);
/**
 * buildEditConfig - Builds configuration object from custom object for editing
 * @param {dw.object.CustomObject} co - custom object
 * @param {boolean} isMasked - whether to mask sensitive values
 * @returns {Object} configuration object for edit form
 */
function buildEditConfig(co, isMasked) {
    if (!co) {
        return Object.assign({}, defaultConfig);
    }

    var config = Object.assign({}, defaultConfig);
    config.configKey = String(co.custom.configKey || '');
    config.locale = config.configKey.split('::')[1] || '';
    config.enabled = co.custom.enabled !== false;
    config.merchantId = String(co.custom.merchantId || '');
    config.clientId = isMasked && co.custom.clientId ? MASKED_VALUE : String(co.custom.clientId || '');
    config.resourceId = safeEnumString(co.custom.resourceId, 'JPMC:URI:RS-105239-85484-HelixAPIEntitlementsCAT-PROD');
    config.certAlias = String(co.custom.certAlias || '');
    config.privateKeyAlias = String(co.custom.privateKeyAlias || '');
    config.kid = isMasked && co.custom.kid ? MASKED_VALUE : String(co.custom.kid || '');
    config.pieGetKeyUrl = safeEnumString(co.custom.pieGetKeyUrl, 'https://safetechpageencryptionvar.chasepaymentech.com/pie/v1');
    config.pieEncryptionUrl = safeEnumString(co.custom.pieEncryptionUrl, 'https://safetechpageencryptionvar.chasepaymentech.com/pie/v1/encryption.js');
    config.pieKey = String(co.custom.pieKey || '');
    config.captureMethod = safeEnumString(co.custom.captureMethod, 'MANUAL');
    config.platformId = String(co.custom.platformId || '');
    config.tokenizationType = safeEnumString(co.custom.tokenizationType, 'SAFETECH_TOKEN');
    config.enableAVS = co.custom.enableAVS !== false;
    config.enableFraudCheck = co.custom.enableFraudCheck === true;
    config.enableFraudCheckAtAuth = co.custom.enableFraudCheckAtAuth === true;
    config.googlePayEnvironment = safeEnumString(co.custom.googlePayEnvironment, 'TEST');
    config.googlePayGateway = String(co.custom.googlePayGateway || '');
    config.googlePayGatewayMerchantId = String(co.custom.googlePayGatewayMerchantId || '');
    config.googlePayMerchantId = String(co.custom.googlePayMerchantId || '');
    config.googlePayMerchantName = String(co.custom.googlePayMerchantName || '');
    config.googlePayAllowedCardNetworks = String(co.custom.googlePayAllowedCardNetworks || '');
    config.googlePayAllowedAuthMethods = String(co.custom.googlePayAllowedAuthMethods || '');
    config.JPMCGooglePayCartEnabled = co.custom.JPMCGooglePayCartEnabled === true;
    config.JPMCGooglePayPDPEnabled = co.custom.JPMCGooglePayPDPEnabled === true;
    config.applePayMerchantId = String(co.custom.applePayMerchantId || '');
    config.kountClientId = String(co.custom.kountClientId || '');
    config.kountEnvironment = safeEnumString(co.custom.kountEnvironment, 'TEST');
    config.accountUpdaterMode = safeEnumString(co.custom.jpmcAccountUpdaterMode, 'NONE');
    config.accountUpdaterWebhookUser = String(co.custom.jpmcAccountUpdaterWebhookUser || '');
    config.accountUpdaterWebhookSecret = isMasked && co.custom.jpmcAccountUpdaterWebhookSecret ? MASKED_VALUE : String(co.custom.jpmcAccountUpdaterWebhookSecret || '');
    config.jpmc3DSEnabled = co.custom.jpmc3DSEnabled === true;

    return config;
}

/**
 * buildFromParams - Builds configuration object from form parameters
 * @param {Object} params - form params
 * @returns {Object} configuration object
 */
function buildFromParams(params) {
    return {
        configKey: String(params.configKey.stringValue || ''),
        locale: String(params.locale.stringValue || ''),
        enabled: params.enabled.stringValue === 'true',
        merchantId: String(params.merchantId.stringValue || ''),
        clientId: String(params.clientId.stringValue || ''),
        resourceId: String(params.resourceId.stringValue || 'JPMC:URI:RS-105239-85484-HelixAPIEntitlementsCAT-PROD'),
        certAlias: String(params.certAlias.stringValue || ''),
        privateKeyAlias: String(params.privateKeyAlias.stringValue || ''),
        kid: String(params.kid.stringValue || ''),
        pieGetKeyUrl: String(params.pieGetKeyUrl.stringValue || 'https://safetechpageencryptionvar.chasepaymentech.com/pie/v1'),
        pieEncryptionUrl: String(params.pieEncryptionUrl.stringValue || 'https://safetechpageencryptionvar.chasepaymentech.com/pie/v1/encryption.js'),
        pieKey: String(params.pieKey.stringValue || ''),
        captureMethod: String(params.captureMethod.stringValue || 'MANUAL'),
        platformId: String(params.platformId.stringValue || ''),
        tokenizationType: String(params.tokenizationType.stringValue || 'SAFETECH_TOKEN'),
        enableAVS: params.enableAVS.stringValue !== 'false',
        enableFraudCheck: params.enableFraudCheck.stringValue === 'true',
        enableFraudCheckAtAuth: params.enableFraudCheckAtAuth.stringValue === 'true',
        googlePayEnvironment: String(params.googlePayEnvironment.stringValue || 'TEST'),
        googlePayGateway: String(params.googlePayGateway.stringValue || ''),
        googlePayGatewayMerchantId: String(params.googlePayGatewayMerchantId.stringValue || ''),
        googlePayMerchantId: String(params.googlePayMerchantId.stringValue || ''),
        googlePayMerchantName: String(params.googlePayMerchantName.stringValue || ''),
        googlePayAllowedCardNetworks: String(params.googlePayAllowedCardNetworks.stringValue || ''),
        googlePayAllowedAuthMethods: String(params.googlePayAllowedAuthMethods.stringValue || ''),
        JPMCGooglePayCartEnabled: params.JPMCGooglePayCartEnabled.stringValue === 'true',
        JPMCGooglePayPDPEnabled: params.JPMCGooglePayPDPEnabled.stringValue === 'true',
        applePayMerchantId: String(params.applePayMerchantId.stringValue || ''),
        kountClientId: String(params.kountClientId.stringValue || ''),
        kountEnvironment: String(params.kountEnvironment.stringValue || 'TEST'),
        accountUpdaterMode: String(params.accountUpdaterMode.stringValue || 'NONE'),
        accountUpdaterWebhookUser: String(params.accountUpdaterWebhookUser.stringValue || ''),
        accountUpdaterWebhookSecret: String(params.accountUpdaterWebhookSecret.stringValue || ''),
        jpmc3DSEnabled: !!params.jpmc3DSEnabled && params.jpmc3DSEnabled.stringValue === 'true'
    };
}

/**
 * @param {string} value - The form-submitted field value
 * @returns {boolean} True if the value is a mask placeholder
 */
function isMaskedValue(value) {
    return !!(value) && (value === MASKED_VALUE);
}

/**
 * assignToCustomObject
 * @param {dw.object.CustomObject} co - custom object
 * @param {Object} config - config data
 */
function assignToCustomObject(co, config) {
    co.custom.configKey = config.configKey;
    co.custom.enabled = config.enabled;
    co.custom.merchantId = config.merchantId;
    if (!isMaskedValue(config.clientId)) {
        co.custom.clientId = config.clientId;
    }
    co.custom.resourceId = config.resourceId;
    co.custom.certAlias = config.certAlias;
    co.custom.privateKeyAlias = config.privateKeyAlias;
    if (!isMaskedValue(config.kid)) {
        co.custom.kid = config.kid;
    }
    co.custom.pieGetKeyUrl = config.pieGetKeyUrl;
    co.custom.pieEncryptionUrl = config.pieEncryptionUrl;
    co.custom.pieKey = config.pieKey;
    co.custom.captureMethod = config.captureMethod;
    co.custom.platformId = config.platformId;
    co.custom.tokenizationType = config.tokenizationType;
    co.custom.enableAVS = config.enableAVS;
    co.custom.enableFraudCheck = config.enableFraudCheck;
    co.custom.enableFraudCheckAtAuth = config.enableFraudCheckAtAuth;
    co.custom.googlePayEnvironment = config.googlePayEnvironment;
    co.custom.googlePayGateway = config.googlePayGateway;
    co.custom.googlePayGatewayMerchantId = config.googlePayGatewayMerchantId;
    co.custom.googlePayMerchantId = config.googlePayMerchantId;
    co.custom.googlePayMerchantName = config.googlePayMerchantName;
    co.custom.googlePayAllowedCardNetworks = config.googlePayAllowedCardNetworks;
    co.custom.googlePayAllowedAuthMethods = config.googlePayAllowedAuthMethods;
    co.custom.JPMCGooglePayCartEnabled = config.JPMCGooglePayCartEnabled;
    co.custom.JPMCGooglePayPDPEnabled = config.JPMCGooglePayPDPEnabled;
    co.custom.applePayMerchantId = config.applePayMerchantId;
    co.custom.kountClientId = config.kountClientId;
    co.custom.kountEnvironment = config.kountEnvironment;
    co.custom.jpmcAccountUpdaterMode = config.accountUpdaterMode;
    co.custom.jpmcAccountUpdaterWebhookUser = config.accountUpdaterWebhookUser;
    if (!isMaskedValue(config.accountUpdaterWebhookSecret)) {
        co.custom.jpmcAccountUpdaterWebhookSecret = config.accountUpdaterWebhookSecret;
    }
    co.custom.jpmc3DSEnabled = config.jpmc3DSEnabled;
}

module.exports = {
    getDefaultConfig: function () {
        return Object.assign({}, defaultConfig);
    },
    buildEditConfig: buildEditConfig,
    buildFromParams: buildFromParams,
    assignToCustomObject: assignToCustomObject,
    isMaskedValue: isMaskedValue
};
