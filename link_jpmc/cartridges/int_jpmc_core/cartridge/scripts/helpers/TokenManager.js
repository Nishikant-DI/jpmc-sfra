/**
 * 3-tier token management: cache → custom object → generate
 * Includes 30-second clock-skew buffer for expiry prevention
 * 
 * IMPORTANT: Cache must be registered in cartridge's caches.json:
 * { "caches": [{ "id": "jpmc_access_token_cache", "expireAfterSeconds": 3600 }] }
 * 
 * @module scripts/helpers/TokenManager
 */

'use strict';

var Logger = require('dw/system/Logger').getLogger('JPMC', 'token');
var constants = require('*/cartridge/scripts/helpers/jpmcConstants');

/**
 * @param {number|string} expiresAt
 * @returns {boolean}
 */
function isTokenExpired(expiresAt) {
    if (!expiresAt) return true;
    
    try {
        var expiryMs = typeof expiresAt === 'string' 
            ? new Date(expiresAt).getTime() 
            : expiresAt;
        return Date.now() > (expiryMs - constants.CLOCK_SKEW_SECONDS * 1000);
    } catch (e) {
        return true;
    }
}

/**
 * @param {string} cacheKey
 * @returns {Object|null}
 */
function getTokenFromCache(cacheKey) {
    try {
        var CacheMgr = require('dw/system/CacheMgr');
        var cache = CacheMgr.getCache(constants.TOKEN_CACHE_ID);
        
        if (!cache) return null;
        
        var token = cache.get(cacheKey);
        if (!token || isTokenExpired(token.expiresAt)) {
            if (token) cache.invalidate(cacheKey);
            return null;
        }
        
        return token;
    } catch (e) {
        return null;
    }
}

/**
 * @param {string} cacheKey
 * @param {Object} tokenData
 * @returns {boolean}
 */
function storeTokenInCache(cacheKey, tokenData) {
    try {
        var CacheMgr = require('dw/system/CacheMgr');
        var cache = CacheMgr.getCache(constants.TOKEN_CACHE_ID);
        
        if (!cache) return false;
        
        cache.put(cacheKey, tokenData);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * @returns {Object|null}
 */
function getTokenFromCustomObject() {
    try {
        var CustomObjectMgr = require('dw/object/CustomObjectMgr');
        var Transaction = require('dw/system/Transaction');
        
        var co = CustomObjectMgr.getCustomObject(constants.TOKEN_CUSTOM_OBJECT_TYPE, constants.TOKEN_CACHE_KEY);
        if (!co) return null;
        
        var expiresAt = String(co.custom.expiresAt || '');
        
        if (isTokenExpired(expiresAt)) {
            Transaction.wrap(function() {
                CustomObjectMgr.remove(co);
            });
            return null;
        }
        
        return {
            accessToken: co.custom.accessToken,
            expiresAt: expiresAt,
            expiresIn: co.custom.expiresIn
        };
    } catch (e) {
        return null;
    }
}

/**
 * @param {string} accessToken
 * @param {number} expiresIn
 * @returns {boolean}
 */
function storeTokenInCustomObject(accessToken, expiresIn) {
    try {
        var CustomObjectMgr = require('dw/object/CustomObjectMgr');
        var Transaction = require('dw/system/Transaction');
        var expiresAtMs = Date.now() + (expiresIn * 1000);
        
        Transaction.wrap(function() {
            var existing = CustomObjectMgr.getCustomObject(constants.TOKEN_CUSTOM_OBJECT_TYPE, constants.TOKEN_CACHE_KEY);
            if (existing) CustomObjectMgr.remove(existing);
            
            var co = CustomObjectMgr.createCustomObject(constants.TOKEN_CUSTOM_OBJECT_TYPE, constants.TOKEN_CACHE_KEY);
            co.custom.accessToken = accessToken;
            co.custom.expiresIn = expiresIn;
            co.custom.expiresAt = new Date(expiresAtMs).toISOString();
            co.custom.issuedAt = new Date().toISOString();
            co.custom.type = 'Bearer';
        });
        
        return true;
    } catch (e) {
        Logger.error('Failed to store token: {0}', e.message || String(e));
        return false;
    }
}

/**
 * @param {string} jwt
 * @param {Object} config
 * @param {string} serviceId
 * @returns {Object}
 */
function requestToken(jwt, config, serviceId) {
    try {
        var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
        
        var payload = {
            client_id: config.client_id,
            client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            client_assertion: jwt,
            grant_type: 'client_credentials',
            resource: config.resource_id
        };
        
        var service = LocalServiceRegistry.createService(serviceId, {
            createRequest: function(svc) {
                var parts = [];
                Object.keys(payload).forEach(function(key) {
                    if (payload[key] != null) {
                        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(payload[key]));
                    }
                });
                svc.setRequestMethod('POST');
                svc.addHeader('Content-Type', 'application/x-www-form-urlencoded');
                return parts.join('&');
            },
            parseResponse: function(svc, client) {
                return JSON.parse(client.text);
            }
        });
        
        var result = service.call();
        
        if (!result.ok || !result.object || !result.object.access_token) {
            Logger.error('Token request failed: {0}', result.errorMessage || 'No access_token');
            return { error: result.errorMessage || 'Token request failed', statusCode: result.status || 500 };
        }
        
        return {
            ok: true,
            accessToken: result.object.access_token,
            expiresIn: result.object.expires_in,
            tokenType: result.object.token_type
        };
    } catch (e) {
        Logger.error('Token request error: {0}', e.message || String(e));
        return { error: e.message || 'Token request failed', statusCode: 500 };
    }
}

/**
 * @param {Object} config
 * @param {string} [serviceId]
 * @returns {Object}
 */
function getValidToken(config, serviceId) {
    if (!config || !config.client_id) {
        return { error: 'Invalid configuration', statusCode: 500 };
    }
    
    serviceId = serviceId || 'JPMCAccessToken';
    
    // L1: Cache
    var cached = getTokenFromCache(constants.TOKEN_CACHE_KEY);
    if (cached) {
        return { accessToken: cached.accessToken, expiresIn: cached.expiresIn };
    }
    
    // L2: Custom Object
    var stored = getTokenFromCustomObject();
    if (stored) {
        storeTokenInCache(constants.TOKEN_CACHE_KEY, stored);
        return { accessToken: stored.accessToken, expiresIn: stored.expiresIn };
    }
    
    // L3: Generate new token
    var JWTHelper = require('*/cartridge/scripts/helpers/JWTHelper');
    var jwt;
    
    try {
        jwt = JWTHelper.generateJWT(config);
    } catch (e) {
        Logger.error('JWT generation failed: {0}', e.message || String(e));
        return { error: 'JWT generation failed', statusCode: 500 };
    }
    
    if (!jwt) {
        Logger.error('JWT generation returned empty');
        return { error: 'JWT generation failed', statusCode: 500 };
    }
    
    var result = requestToken(jwt, config, serviceId);
    
    if (result.error) {
        return { error: result.error, statusCode: result.statusCode };
    }
    
    var tokenData = {
        accessToken: result.accessToken,
        expiresAt: Date.now() + (result.expiresIn * 1000),
        expiresIn: result.expiresIn
    };
    
    storeTokenInCustomObject(result.accessToken, result.expiresIn);
    storeTokenInCache(constants.TOKEN_CACHE_KEY, tokenData);
    
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
}

module.exports = {
    getValidToken: getValidToken
};
