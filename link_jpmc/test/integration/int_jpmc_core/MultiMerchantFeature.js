'use strict';

var assert = require('assert');
var proxyquire = require('proxyquire').noCallThru();

var CONSTANTS = {
    MERCHANT_CONFIG_CACHE_ID: 'jpmc-merchant-config',
    MERCHANT_CONFIG_CACHE_KEY_PREFIX: 'jpmc_config_',
    MERCHANT_CONFIG_CO_TYPE: 'JPMCMerchantConfig',
    DEFAULT_EXPIRES_IN: '8h',
    DEFAULT_CERT_ALIAS: 'default-cert',
    DEFAULT_KEY_ALIAS: 'default-key',
    DEFAULT_TOKEN_TYPE: 'SAFETECH_TOKEN',
    DEFAULT_CAPTURE_METHOD: 'MANUAL',
    DEFAULT_COMPANY_NAME: 'JPMC',
    DEFAULT_PRODUCT_NAME: 'JPMC Plugin',
    DEFAULT_VERSION: '1.0.0'
};

function makeMockLogger() {
    return { debug: function () {}, info: function () {}, warn: function () {}, error: function () {} };
}

function makeMockCache(overrides) {
    return Object.assign({
        get: function (key, cb) { return cb(); },
        invalidate: function () {}
    }, overrides || {});
}

function makeSitePrefs(enabled, custom) {
    return {
        getCurrent: function () {
            return {
                getID: function () { return 'RefArch'; },
                getPreferences: function () {
                    return {
                        getCustom: function () {
                            return Object.assign({
                                JPMC_MerchantCode: 'sp-merchant',
                                JPMCClientID: 'sp-client',
                                JPMCResourceID: 'sp-resource',
                                JPMCAudience: 'sp-audience',
                                JPMCExpiresIn: '8h',
                                JPMCCertAlias: 'sp-cert',
                                JPMCPrivateKeyAlias: 'sp-key',
                                jpmc_kid: 'sp-kid',
                                JPMCTokenizationType: { value: 'SAFETECH_TOKEN' },
                                JPMCCaptureMethod: { value: 'MANUAL' },
                                JPMCEnableAVS: true,
                                JPMCEnableFraudCheck: false,
                                JPMCEnableFraudCheckAtAuth: false,
                                jpmcKountEnvironment: { value: 'TEST' },
                                JPMCGetKeyUrl: 'https://sp-pie-key.example.com',
                                JPMCEncryptionUrl: 'https://sp-pie-enc.example.com',
                                JPMCPlatformId: 'sp-platform',
                                JPMCGooglePayGatewayMerchantId: 'sp-gpay-gw-mid',
                                JPMCGooglePayMerchantId: 'sp-gpay-mid',
                                JPMCGooglePayMerchantName: 'SP Store',
                                JPMCGooglePayEnvironment: { value: 'TEST' },
                                JPMCGooglePayGateway: 'sp-gateway',
                                JPMCGooglePayAllowedCardNetworks: 'VISA,MASTERCARD',
                                JPMCGooglePayAllowedAuthMethods: 'PAN_ONLY',
                                JPMCGooglePayCartEnabled: false,
                                JPMCGooglePayPDPEnabled: false,
                                jpmcKountClientId: 'sp-kount',
                                JPMCMerchantSoftwareCompany: null,
                                JPMCMerchantSoftwareProduct: null,
                                JPMCMerchantSoftwareVersion: null,
                                JPMCTokenURI: null
                            }, custom || {});
                        },
                        custom: { JPMCEnableMultiMerchant: enabled === true }
                    };
                }
            };
        }
    };
}

function makeCO(fields) {
    return { custom: Object.assign({ enabled: true }, fields || {}) };
}

function makeIterator(items) {
    var idx = 0;
    return {
        hasNext: function () { return idx < items.length; },
        next: function () { return items[idx++]; },
        close: function () {}
    };
}

function loadResolver(mockSite, mockCO, cacheOverrides) {
    var cache = makeMockCache(cacheOverrides || {});
    return proxyquire('../../../../../cartridges/int_jpmc_core/cartridge/scripts/helpers/JPMCMerchantResolver', {
        'dw/system/Logger': { getLogger: function () { return makeMockLogger(); } },
        'dw/system/CacheMgr': { getCache: function () { return cache; } },
        'dw/system/Site': mockSite,
        'dw/object/CustomObjectMgr': mockCO || { getCustomObject: function () { return null; }, queryCustomObjects: function () { return makeIterator([]); } },
        '*/cartridge/scripts/helpers/jpmcConstants': CONSTANTS
    });
}

describe('Multi-Merchant Feature Integration', function () {

    describe('Scenario 1: Complete Custom Object configuration', function () {

        var resolver, result;

        before(function () {
            var fullCo = makeCO({
                configKey: 'RefArch::en_CA',
                merchantId: 'co-canada-merchant',
                clientId: 'co-canada-client',
                resourceId: 'co-canada-resource',
                audience: 'co-canada-audience',
                expiresIn: '24h',
                certAlias: 'co-cert',
                privateKeyAlias: 'co-key',
                kid: 'co-kid',
                tokenUri: 'https://co-token.example.com',
                captureMethod: { value: 'NOW' },
                tokenizationType: { value: 'NETWORK_TOKEN' },
                enableAVS: true,
                enableFraudCheck: true,
                enableFraudCheckAtAuth: true,
                kountEnvironment: { value: 'PROD' },
                kountClientId: 'co-kount',
                platformId: 'co-platform',
                pieGetKeyUrl: 'https://co-pie-key.example.com',
                pieEncryptionUrl: 'https://co-pie-enc.example.com',
                googlePayEnvironment: { value: 'PRODUCTION' },
                googlePayGatewayMerchantId: 'co-gpay-gw-mid',
                googlePayMerchantId: 'co-gpay-mid',
                googlePayMerchantName: 'CO Store',
                googlePayGateway: 'co-gw',
                googlePayAllowedCardNetworks: 'VISA,AMEX',
                googlePayAllowedAuthMethods: 'CRYPTOGRAM_3DS',
                JPMCGooglePayCartEnabled: true,
                JPMCGooglePayPDPEnabled: true,
                applePayMerchantId: 'co-apple-mid',
                merchantSoftwareCompany: 'CO Corp',
                merchantSoftwareProduct: 'CO Pay',
                merchantSoftwareVersion: '2.0.0'
            });
            var mockCO = { getCustomObject: function (type, key) { return key === 'RefArch::en_CA' ? fullCo : null; } };
            resolver = loadResolver(makeSitePrefs(true), mockCO);
            result = resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' });
        });

        it('source should be CustomObject', function () { assert.strictEqual(result.source, 'CustomObject'); });
        it('merchantId comes from CO', function () { assert.strictEqual(result.merchantId, 'co-canada-merchant'); });
        it('clientId comes from CO', function () { assert.strictEqual(result.clientId, 'co-canada-client'); });
        it('resourceId comes from CO', function () { assert.strictEqual(result.resourceId, 'co-canada-resource'); });
        it('audience comes from CO', function () { assert.strictEqual(result.audience, 'co-canada-audience'); });
        it('expiresIn comes from CO (24h)', function () { assert.strictEqual(result.expiresIn, '24h'); });
        it('certAlias comes from CO', function () { assert.strictEqual(result.certAlias, 'co-cert'); });
        it('privateKeyAlias comes from CO', function () { assert.strictEqual(result.privateKeyAlias, 'co-key'); });
        it('kid comes from CO', function () { assert.strictEqual(result.kid, 'co-kid'); });
        it('tokenUri comes from CO', function () { assert.strictEqual(result.tokenUri, 'https://co-token.example.com'); });
        it('captureMethod comes from CO enum (NOW)', function () { assert.strictEqual(result.captureMethod, 'NOW'); });
        it('tokenizationType comes from CO enum (NETWORK_TOKEN)', function () { assert.strictEqual(result.tokenizationType, 'NETWORK_TOKEN'); });
        it('enableAVS=true from CO', function () { assert.strictEqual(result.enableAVS, true); });
        it('enableFraudCheck=true from CO', function () { assert.strictEqual(result.enableFraudCheck, true); });
        it('enableFraudCheckAtAuth=true from CO', function () { assert.strictEqual(result.enableFraudCheckAtAuth, true); });
        it('kountEnvironment=PROD from CO', function () { assert.strictEqual(result.kountEnvironment, 'PROD'); });
        it('kountClientId from CO', function () { assert.strictEqual(result.kountClientId, 'co-kount'); });
        it('platformId from CO', function () { assert.strictEqual(result.platformId, 'co-platform'); });
        it('pieGetKeyUrl from CO', function () { assert.strictEqual(result.pieGetKeyUrl, 'https://co-pie-key.example.com'); });
        it('pieEncryptionUrl from CO', function () { assert.strictEqual(result.pieEncryptionUrl, 'https://co-pie-enc.example.com'); });
        it('googlePayEnvironment=PRODUCTION from CO', function () { assert.strictEqual(result.googlePayEnvironment, 'PRODUCTION'); });
        it('googlePayGatewayMerchantId from CO', function () { assert.strictEqual(result.googlePayGatewayMerchantId, 'co-gpay-gw-mid'); });
        it('googlePayMerchantName from CO', function () { assert.strictEqual(result.googlePayMerchantName, 'CO Store'); });
        it('JPMCGooglePayCartEnabled=true from CO', function () { assert.strictEqual(result.JPMCGooglePayCartEnabled, true); });
        it('JPMCGooglePayPDPEnabled=true from CO', function () { assert.strictEqual(result.JPMCGooglePayPDPEnabled, true); });
        it('applePayMerchantId from CO', function () { assert.strictEqual(result.applePayMerchantId, 'co-apple-mid'); });
        it('merchantSoftwareCompany always from constants', function () { assert.strictEqual(result.merchantSoftwareCompany, CONSTANTS.DEFAULT_COMPANY_NAME); });
        it('merchantSoftwareProduct always from constants', function () { assert.strictEqual(result.merchantSoftwareProduct, CONSTANTS.DEFAULT_PRODUCT_NAME); });
        it('merchantSoftwareVersion always from constants', function () { assert.strictEqual(result.merchantSoftwareVersion, CONSTANTS.DEFAULT_VERSION); });
    });

    describe('Scenario 2: Partial CO — mandatory from CO, optional from SP', function () {

        var resolver, result;

        before(function () {
            var partialCo = makeCO({
                configKey: 'RefArch::en_CA',
                merchantId: 'partial-co-merchant',
                clientId: 'partial-co-client',
                resourceId: 'partial-co-resource',
                audience: 'partial-co-audience'
            });
            var mockCO = { getCustomObject: function (type, key) { return key === 'RefArch::en_CA' ? partialCo : null; } };
            resolver = loadResolver(makeSitePrefs(true), mockCO);
            result = resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' });
        });

        it('source should be CustomObject', function () { assert.strictEqual(result.source, 'CustomObject'); });
        it('mandatory merchantId from CO', function () { assert.strictEqual(result.merchantId, 'partial-co-merchant'); });
        it('mandatory clientId from CO', function () { assert.strictEqual(result.clientId, 'partial-co-client'); });
        it('optional expiresIn falls back to SP (8h)', function () { assert.strictEqual(result.expiresIn, '8h'); });
        it('optional certAlias falls back to SP', function () { assert.strictEqual(result.certAlias, 'sp-cert'); });
        it('optional privateKeyAlias falls back to SP', function () { assert.strictEqual(result.privateKeyAlias, 'sp-key'); });
        it('optional kid falls back to SP', function () { assert.strictEqual(result.kid, 'sp-kid'); });
        it('optional kountEnvironment falls back to TEST', function () { assert.strictEqual(result.kountEnvironment, 'TEST'); });
        it('optional tokenizationType falls back to SAFETECH_TOKEN', function () { assert.strictEqual(result.tokenizationType, 'SAFETECH_TOKEN'); });
        it('optional enableAVS defaults to true', function () { assert.strictEqual(result.enableAVS, true); });
        it('optional enableFraudCheck falls back to SP false', function () { assert.strictEqual(result.enableFraudCheck, false); });
    });

    describe('Scenario 3: Multi-merchant DISABLED — always SitePreferences', function () {

        var resolver;

        before(function () {
            var localeCo = makeCO({ configKey: 'RefArch::en_CA', merchantId: 'co-en-ca-merchant', clientId: 'co-cid', resourceId: 'co-rid', audience: 'co-aud' });
            var mockCO = { getCustomObject: function (type, key) { return key === 'RefArch::en_CA' ? localeCo : null; } };
            resolver = loadResolver(makeSitePrefs(false), mockCO);
        });

        it('resolve() with en_CA locale still returns SitePreferences', function () {
            assert.strictEqual(resolver.resolve({ locale: 'en_CA' }).source, 'SitePreferences');
        });
        it('resolve() with fr_CA locale still returns SitePreferences', function () {
            assert.strictEqual(resolver.resolve({ locale: 'fr_CA' }).source, 'SitePreferences');
        });
        it('resolve() with no locale returns SitePreferences', function () {
            assert.strictEqual(resolver.resolve({ locale: null }).source, 'SitePreferences');
        });
        it('SP merchantId returned regardless of CO', function () {
            assert.strictEqual(resolver.resolve({ locale: 'en_CA' }).merchantId, 'sp-merchant');
        });
        it('resolveForOrder() returns SP even when CO exists', function () {
            var order = { custom: {}, getCustomerLocaleID: function () { return 'en_CA'; } };
            assert.strictEqual(resolver.resolveForOrder(order).source, 'SitePreferences');
        });
    });

    describe('Scenario 4: Multiple locales — locale-specific CO per locale', function () {

        var resolver;
        var cos = {
            'RefArch::en_CA': makeCO({ configKey: 'RefArch::en_CA', merchantId: 'merchant-en-ca', clientId: 'client-en-ca', resourceId: 'res-en-ca', audience: 'aud-en-ca' }),
            'RefArch::fr_CA': makeCO({ configKey: 'RefArch::fr_CA', merchantId: 'merchant-fr-ca', clientId: 'client-fr-ca', resourceId: 'res-fr-ca', audience: 'aud-fr-ca' })
        };

        before(function () {
            var mockCO = { getCustomObject: function (type, key) { return cos[key] || null; } };
            resolver = loadResolver(makeSitePrefs(true), mockCO);
        });

        it('en_CA resolves to en_CA merchant', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' }).merchantId, 'merchant-en-ca');
        });
        it('fr_CA resolves to fr_CA merchant', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'fr_CA' }).merchantId, 'merchant-fr-ca');
        });
        it('unknown locale falls back to Site Preferences (no default CO)', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'zh_CN' }).source, 'SitePreferences');
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'zh_CN' }).merchantId, 'sp-merchant');
        });
        it('null locale falls back to Site Preferences', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: null }).source, 'SitePreferences');
        });
    });

    describe('Scenario 5: resolveForOrder() by jpmcMerchantId', function () {

        it('should resolve by merchant ID when CO exists', function () {
            var merchantCo = makeCO({ configKey: 'RefArch::mid-abc', merchantId: 'mid-abc', clientId: 'abc-cid', resourceId: 'abc-rid', audience: 'abc-aud' });
            var mockCO = {
                getCustomObject: function () { return null; },
                queryCustomObjects: function (type, query, sort, mid) {
                    return makeIterator(mid === 'mid-abc' ? [merchantCo] : []);
                }
            };
            var resolver = loadResolver(makeSitePrefs(true), mockCO);
            var order = { custom: { jpmcMerchantId: 'mid-abc' }, getCustomerLocaleID: function () { return 'en_CA'; } };
            assert.strictEqual(resolver.resolveForOrder(order).merchantId, 'mid-abc');
        });

        it('should fallback to locale CO when no CO found for merchant ID', function () {
            var localeCo = makeCO({ configKey: 'RefArch::en_CA', merchantId: 'locale-merchant', clientId: 'locale-cid', resourceId: 'locale-rid', audience: 'locale-aud' });
            var mockCO = {
                getCustomObject: function (type, key) { return key === 'RefArch::en_CA' ? localeCo : null; },
                queryCustomObjects: function () { return makeIterator([]); }
            };
            var resolver = loadResolver(makeSitePrefs(true), mockCO);
            var order = { custom: { jpmcMerchantId: 'unknown-mid' }, getCustomerLocaleID: function () { return 'en_CA'; } };
            assert.strictEqual(resolver.resolveForOrder(order).merchantId, 'locale-merchant');
        });

        it('should fallback to SP when no CO found for merchant ID and no locale CO', function () {
            var mockCO = {
                getCustomObject: function () { return null; },
                queryCustomObjects: function () { return makeIterator([]); }
            };
            var resolver = loadResolver(makeSitePrefs(true), mockCO);
            var order = { custom: { jpmcMerchantId: 'unknown-mid' }, getCustomerLocaleID: function () { return 'en_CA'; } };
            assert.strictEqual(resolver.resolveForOrder(order).source, 'SitePreferences');
        });
    });

    describe('Scenario 6: toAccessTokenConfig() — full round-trip from resolve to token config', function () {

        it('should produce valid token config from resolved CO config', function () {
            var localeCo = makeCO({
                configKey: 'RefArch::en_CA',
                merchantId: 'token-merchant',
                clientId: 'token-client',
                resourceId: 'token-resource',
                audience: 'token-audience',
                certAlias: 'token-cert',
                privateKeyAlias: 'token-key',
                expiresIn: '12h',
                tokenUri: 'https://token.example.com',
                kid: 'token-kid'
            });
            var mockCO = { getCustomObject: function (type, key) { return key === 'RefArch::en_CA' ? localeCo : null; } };
            var resolver = loadResolver(makeSitePrefs(true), mockCO);

            var resolved = resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' });
            var tokenConfig = resolver.toAccessTokenConfig(resolved);

            assert.strictEqual(tokenConfig.client_id, 'token-client');
            assert.strictEqual(tokenConfig.merchantId, 'token-merchant');
            assert.strictEqual(tokenConfig.certAlias, 'token-cert');
            assert.strictEqual(tokenConfig.privateKeyAlias, 'token-key');
            assert.strictEqual(tokenConfig.expiresIn, '12h');
            assert.strictEqual(tokenConfig.audience, 'token-audience');
            assert.strictEqual(tokenConfig.resource_id, 'token-resource');
            assert.strictEqual(tokenConfig.ida_url, 'https://token.example.com');
            assert.strictEqual(tokenConfig.kid, 'token-kid');
        });

        it('should produce valid token config from SP fallback', function () {
            var mockCO = { getCustomObject: function () { return null; } };
            var resolver = loadResolver(makeSitePrefs(true), mockCO);

            var resolved = resolver.resolve({ siteId: 'RefArch', locale: 'zh_CN' });
            var tokenConfig = resolver.toAccessTokenConfig(resolved);

            assert.strictEqual(tokenConfig.client_id, 'sp-client');
            assert.strictEqual(tokenConfig.merchantId, 'sp-merchant');
        });
    });

    describe('Scenario 7: Cache invalidation', function () {

        it('should return true and call invalidate for configKey', function () {
            var calls = [];
            var resolver = loadResolver(makeSitePrefs(true), null, { invalidate: function (k) { calls.push(k); } });
            assert.strictEqual(resolver.invalidateCache('RefArch::en_CA'), true);
            assert.ok(calls.some(function (k) { return k.indexOf('RefArch::en_CA') > -1; }));
        });

        it('should invalidate both configKey and merchantId caches', function () {
            var calls = [];
            var resolver = loadResolver(makeSitePrefs(true), null, { invalidate: function (k) { calls.push(k); } });
            resolver.invalidateCache('RefArch::en_CA', 'merchant-123');
            assert.strictEqual(calls.length, 2);
            assert.ok(calls[1].indexOf('mid_merchant-123') > -1);
        });

        it('should return false for empty key', function () {
            var resolver = loadResolver(makeSitePrefs(true), null);
            assert.strictEqual(resolver.invalidateCache(''), false);
        });
    });

    describe('Scenario 8: Disabled CO (enabled=false) is skipped', function () {

        it('should skip locale CO with enabled=false and fall through', function () {
            var disabledCo = makeCO({ configKey: 'RefArch::en_CA', enabled: false, merchantId: 'disabled-merchant', clientId: 'cid', resourceId: 'rid', audience: 'aud' });
            var mockCO = { getCustomObject: function (type, key) { return key === 'RefArch::en_CA' ? disabledCo : null; } };
            var resolver = loadResolver(makeSitePrefs(true), mockCO);

            var result = resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' });
            assert.strictEqual(result.source, 'SitePreferences', 'Disabled CO should be skipped');
            assert.notStrictEqual(result.merchantId, 'disabled-merchant');
        });
    });

    describe('Scenario 9: Error resilience', function () {

        it('getCustomObject throwing should not crash resolve() — returns SP', function () {
            var mockCO = { getCustomObject: function () { throw new Error('DB unavailable'); } };
            var resolver = loadResolver(makeSitePrefs(true), mockCO);
            var result = resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' });
            assert.strictEqual(result.source, 'SitePreferences');
        });

        it('queryCustomObjects throwing should not crash resolveForOrder() — returns SP', function () {
            var mockCO = {
                getCustomObject: function () { return null; },
                queryCustomObjects: function () { throw new Error('DB unavailable'); }
            };
            var resolver = loadResolver(makeSitePrefs(true), mockCO);
            var order = { custom: { jpmcMerchantId: 'mid-xyz' }, getCustomerLocaleID: function () { return 'en_CA'; } };
            var result = resolver.resolveForOrder(order);
            assert.strictEqual(result.source, 'SitePreferences');
        });

        it('isMultiMerchantEnabled() throwing should not crash — returns false', function () {
            var badSite = { getCurrent: function () { throw new Error('Site error'); } };
            var resolver = loadResolver(badSite, null);
            assert.strictEqual(resolver.isMultiMerchantEnabled(), false);
        });

        it('invalidateCache() with cache.invalidate throwing should return false', function () {
            var resolver = loadResolver(makeSitePrefs(true), null, { invalidate: function () { throw new Error('cache fail'); } });
            assert.strictEqual(resolver.invalidateCache('some-key'), false);
        });
    });


    describe('Scenario 10: Backward compatibility (feature disabled = pre-existing behavior)', function () {

        var resolver;
        before(function () {
            resolver = loadResolver(makeSitePrefs(false), null);
        });

        it('resolve() returns SP merchantId', function () {
            assert.strictEqual(resolver.resolve().merchantId, 'sp-merchant');
        });
        it('resolve() returns SP clientId', function () {
            assert.strictEqual(resolver.resolve().clientId, 'sp-client');
        });
        it('resolve() returns SP resourceId', function () {
            assert.strictEqual(resolver.resolve().resourceId, 'sp-resource');
        });
        it('resolve() returns SP audience', function () {
            assert.strictEqual(resolver.resolve().audience, 'sp-audience');
        });
        it('resolve() certAlias from SP', function () {
            assert.strictEqual(resolver.resolve().certAlias, 'sp-cert');
        });
        it('resolve() expiresIn from SP', function () {
            assert.strictEqual(resolver.resolve().expiresIn, '8h');
        });
        it('resolveForOrder() returns SP source', function () {
            var order = { custom: { jpmcMerchantId: 'whatever' }, getCustomerLocaleID: function () { return 'en_CA'; } };
            assert.strictEqual(resolver.resolveForOrder(order).source, 'SitePreferences');
        });
        it('isMultiMerchantEnabled() returns false', function () {
            assert.strictEqual(resolver.isMultiMerchantEnabled(), false);
        });
    });

   
    describe('Scenario 11: Canadian site — en_CA / fr_CA merchants', function () {

        var resolver;

        before(function () {
            var coStore = {
                'RefArch::en_CA': makeCO({
                    configKey: 'RefArch::en_CA',
                    merchantId: 'canada-english-merchant',
                    clientId: 'canada-en-client',
                    resourceId: 'canada-en-resource',
                    audience: 'canada-en-audience',
                    captureMethod: { value: 'MANUAL' },
                    tokenizationType: { value: 'SAFETECH_TOKEN' },
                    enableAVS: true,
                    enableFraudCheck: false
                }),
                'RefArch::fr_CA': makeCO({
                    configKey: 'RefArch::fr_CA',
                    merchantId: 'canada-french-merchant',
                    clientId: 'canada-fr-client',
                    resourceId: 'canada-fr-resource',
                    audience: 'canada-fr-audience',
                    captureMethod: { value: 'NOW' },
                    tokenizationType: { value: 'NETWORK_TOKEN' },
                    enableAVS: true,
                    enableFraudCheck: true
                })
            };
            var mockCO = { getCustomObject: function (type, key) { return coStore[key] || null; } };
            resolver = loadResolver(makeSitePrefs(true), mockCO);
        });

        it('English Canada shopper gets correct merchant', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' }).merchantId, 'canada-english-merchant');
        });
        it('French Canada shopper gets correct merchant', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'fr_CA' }).merchantId, 'canada-french-merchant');
        });
        it('English Canada order resolved correctly', function () {
            var order = { custom: {}, getCustomerLocaleID: function () { return 'en_CA'; } };
            assert.strictEqual(resolver.resolveForOrder(order).merchantId, 'canada-english-merchant');
        });
        it('French Canada order resolved correctly', function () {
            var order = { custom: {}, getCustomerLocaleID: function () { return 'fr_CA'; } };
            assert.strictEqual(resolver.resolveForOrder(order).merchantId, 'canada-french-merchant');
        });
        it('en_CA captureMethod=MANUAL from CO', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' }).captureMethod, 'MANUAL');
        });
        it('fr_CA captureMethod=NOW from CO', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'fr_CA' }).captureMethod, 'NOW');
        });
        it('fr_CA enableFraudCheck=true from CO', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'fr_CA' }).enableFraudCheck, true);
        });
        it('en_CA tokenizationType=SAFETECH_TOKEN from CO', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' }).tokenizationType, 'SAFETECH_TOKEN');
        });
        it('fr_CA tokenizationType=NETWORK_TOKEN from CO', function () {
            assert.strictEqual(resolver.resolve({ siteId: 'RefArch', locale: 'fr_CA' }).tokenizationType, 'NETWORK_TOKEN');
        });
        it('optional fields missing in CO fallback to SP value', function () {
            var enResult = resolver.resolve({ siteId: 'RefArch', locale: 'en_CA' });
            assert.strictEqual(enResult.kid, 'sp-kid', 'kid should fallback to SP');
        });
    });

    
    describe('Scenario 12: Module exports API completeness', function () {
        var resolver;
        before(function () { resolver = loadResolver(makeSitePrefs(false), null); });

        it('exports resolve', function () { assert.strictEqual(typeof resolver.resolve, 'function'); });
        it('exports resolveForOrder', function () { assert.strictEqual(typeof resolver.resolveForOrder, 'function'); });
        it('exports toAccessTokenConfig', function () { assert.strictEqual(typeof resolver.toAccessTokenConfig, 'function'); });
        it('exports invalidateCache', function () { assert.strictEqual(typeof resolver.invalidateCache, 'function'); });
        it('exports isMultiMerchantEnabled', function () { assert.strictEqual(typeof resolver.isMultiMerchantEnabled, 'function'); });
        it('does not expose internal getMerchantConfigCO', function () { assert.strictEqual(resolver.getMerchantConfigCO, undefined); });
        it('does not expose internal buildSitePrefsConfig', function () { assert.strictEqual(resolver.buildSitePrefsConfig, undefined); });
    });
});

