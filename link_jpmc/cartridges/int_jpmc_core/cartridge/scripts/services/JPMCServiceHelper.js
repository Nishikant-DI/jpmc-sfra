/**
 * Centralized service handling for JPMC integrations
 * Uses SFCC LocalServiceRegistry with parameter validation.
 * @module scripts/services/JPMCServiceHelper
 */

'use strict';

var Logger = require('dw/system/Logger').getLogger('JPMC', 'service');

/** @type {Array<string>} Fields to mask in communication logs */
var SENSITIVE_FIELDS = [
    'accountNumber', 'cardNumber', 'maskedAccountNumber',
    'cvv', 'encryptionIntegrityCheck', 'tokenNumber',
    'expirationMonth', 'expirationYear',
    'lastName', 'line1', 'fullName', 'email', 'phoneNumber',
    'accessToken', 'access_token', 'client_assertion', 'client_id'
];

/**
 * Masks sensitive fields in a log message string (for filterLogMessage callback)
 * @private
 * @param {string} msg
 * @returns {string}
 */
function maskSensitiveData(msg) {
    var masked = msg;
    for (var i = 0; i < SENSITIVE_FIELDS.length; i++) {
        var field = SENSITIVE_FIELDS[i];
        var jsonPattern = new RegExp('("' + field + '"\\s*:\\s*)"([^"]+)"', 'gi');
        masked = masked.replace(jsonPattern, function (match, prefix, value) {
            return value.length > 4
                ? prefix + '"' + value.substring(0, 4) + '****"'
                : prefix + '"****"';
        });
        var formPattern = new RegExp('(' + field + '=)([^&]+)', 'gi');
        masked = masked.replace(formPattern, function (match, prefix, value) {
            return value.length > 4
                ? prefix + value.substring(0, 4) + '****'
                : prefix + '****';
        });
    }
    return masked;
}

/**
 * Encodes object as application/x-www-form-urlencoded
 * @private
 * @param {Object} obj
 * @returns {string}
 */
function encodeFormData(obj) {
    var parts = [];
    
    Object.keys(obj).forEach(function (key) {
        var value = obj[key];
        if (value !== null && value !== undefined) {
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
        }
    });
    
    return parts.join('&');
}

/**
 * Validates URL suffix (prevents path traversal)
 * @private
 * @param {string} urlSuffix
 * @returns {string|null}
 */
function validateUrlSuffix(urlSuffix) {
    if (!urlSuffix) {
        return null;
    }
    if (!/^[a-zA-Z0-9\-_/.?=&]+$/.test(urlSuffix)) {
        Logger.warn('Invalid URL suffix detected, rejecting: {0}', urlSuffix);
        return null;
    }
    if (urlSuffix.indexOf('..') > -1) {
        Logger.warn('Path traversal pattern detected in URL suffix');
        return null;
    }
    
    return urlSuffix;
}

/**
 * Validates placeholder ID for injection attacks (whitelist)
 * @private
 * @param {string} placeHolderId
 * @returns {string|null}
 */
function validatePlaceHolderId(placeHolderId) {
    if (!placeHolderId) {
        return null;
    }
    if (!/^[a-zA-Z0-9\-_]+$/.test(placeHolderId) || placeHolderId.length > 100) {
        Logger.warn('Invalid placeHolderId detected, rejecting');
        return null;
    }
    
    return placeHolderId;
}

/**
 * Calls a service using SFCC Service Framework
 * @param {string} serviceId
 * @param {Object} params
 * @param {string} params.method
 * @param {Object} [params.payload]
 * @param {Object} [params.headers]
 * @param {string} [params.contentType]
 * @param {string} [params.urlSuffix]
 * @param {string} [params.placeHolderId]
 * @returns {Object}
 */
function callService(serviceId, params) {
    var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
    
    var result = {
        ok: false,
        data: null,
        statusCode: null,
        errorMessage: ''
    };

    if (!serviceId || !params || !params.method) {
        result.errorMessage = 'Invalid parameters: serviceId and method required';
        Logger.error('callService: {0}', result.errorMessage);
        return result;
    }

    try {
        var contentType = params.contentType || 'application/json';
        var isFormEncoded = contentType.indexOf('x-www-form-urlencoded') > -1;

        var service = LocalServiceRegistry.createService(serviceId, {
            createRequest: function (svc, requestData) { 
                if (!requestData) {
                    return null;
                }
                
                return isFormEncoded ? encodeFormData(requestData) : JSON.stringify(requestData);
            },

            parseResponse: function (svc, client) {
                return {
                    statusCode: client.getStatusCode(),
                    statusMessage: client.getStatusMessage(),
                    responseText: client.getText() || '',
                    ok: client.getStatusCode() >= 200 && client.getStatusCode() < 300
                };
            },

            filterLogMessage: function (msg) {
                return maskSensitiveData(msg);
            }
        });

        service.setRequestMethod(params.method.toUpperCase());
        service.addHeader('Content-Type', contentType);
        if (params.placeHolderId) {
            var validatedId = validatePlaceHolderId(params.placeHolderId);
            if (validatedId) {
                service.setURL(service.getURL().replace('{place-holder-id}', validatedId));
            }
        }
        if (params.urlSuffix) {
            var validatedSuffix = validateUrlSuffix(params.urlSuffix);
            if (validatedSuffix) {
                service.setURL(service.getURL() + validatedSuffix);
            }
        }
        
        if (params.headers) {
            Object.keys(params.headers).forEach(function (key) {
                service.addHeader(key, params.headers[key]);
            });
        }

        var callResult = service.call(params.payload || null);

        if (callResult.isOk()) {
            var responseObj = callResult.getObject();
            result.ok = responseObj.ok;
            result.statusCode = responseObj.statusCode;
            
            if (responseObj.responseText) {
                try {
                    result.data = JSON.parse(responseObj.responseText);
                } catch (e) {
                    result.data = responseObj.responseText;
                }
            }
        } else {
            result.statusCode = callResult.status;
            result.errorMessage = callResult.errorMessage || callResult.msg || 'Unknown error';
            Logger.error('Service {0} failed: {1}', serviceId, result.errorMessage);
        }

    } catch (e) {
        var errorMessage = e instanceof Error ? e.message : String(e);
        result.errorMessage = errorMessage;
        Logger.error('Exception calling service {0}: {1}', serviceId, errorMessage);
    }

    return result;
}

/**
 * Generates token and calls service in one operation
 * UPDATED: Now uses TokenManager for unified token retrieval (cache-first strategy)
 * Validates all BM configuration before attempting service calls
 * @param {Object} options
 * @param {string} options.tokenServiceId
 * @param {string} options.serviceId
 * @param {string} options.method
 * @param {Object} [options.data]
 * @param {Object} [options.headers]
 * @param {string} [options.urlSuffix]
 * @param {string} [options.placeHolderId]
 * @returns {Object}
 */
function callWithTokenGeneration(options) {
    if (!options || !options.tokenServiceId || !options.serviceId || !options.method) {
        var optionsError = 'callWithTokenGeneration: tokenServiceId, serviceId, and method are required';
        Logger.error('CRITICAL: {0}', optionsError);
        return {
            success: false,
            error: optionsError,
            statusCode: 400,
            timestamp: new Date().toISOString()
        };
    }
    
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var TokenManager = require('*/cartridge/scripts/helpers/TokenManager');
    
    try {
        var config = JPMCConfig.getAccessTokenConfig();
        
        // Get valid token using unified TokenManager (cache-first, with auto-refresh)
        var tokenResult = TokenManager.getValidToken(config, options.tokenServiceId);
        
        if (tokenResult.error) {
            Logger.error('Token retrieval failed: {0}', tokenResult.error);
            return {
                success: false,
                error: tokenResult.error,
                statusCode: tokenResult.statusCode || 500,
                timestamp: new Date().toISOString()
            };
        }
        var headers = options.headers || {};
        headers.Authorization = 'Bearer ' + tokenResult.accessToken;
        var serviceResult = callService(options.serviceId, {
            method: options.method,
            payload: options.data,
            headers: headers,
            placeHolderId: options.placeHolderId,
            urlSuffix: options.urlSuffix
        });
        
        return {
            success: serviceResult.ok,
            data: serviceResult.data,
            error: serviceResult.errorMessage,
            statusCode: serviceResult.statusCode,
            timestamp: new Date().toISOString()
        };
        
    } catch (e) {
        var errorMessage = e instanceof Error ? e.message : String(e);
        Logger.error('callWithTokenGeneration error: {0}', errorMessage);
        return {
            success: false,
            error: errorMessage,
            statusCode: 500,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = {
    callWithTokenGeneration: callWithTokenGeneration
};
