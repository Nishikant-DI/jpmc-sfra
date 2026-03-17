'use strict';

var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');

/**
 * @returns {string}
 */
function generateJTI() {
    var UUIDUtils = require('dw/util/UUIDUtils');
    return UUIDUtils.createUUID();
}

/**
 * @param {string|number} expiresIn
 * @returns {number}
 */
function parseExpiration(expiresIn) {
    if (!expiresIn) return jpmcConstants.DEFAULT_JWT_EXPIRY_SECONDS;
    if (typeof expiresIn === 'number') return expiresIn;
    if (typeof expiresIn === 'string' && expiresIn.indexOf('h') > -1) {
        return parseInt(expiresIn, 10) * 60 * 60;
    }
    return parseInt(expiresIn, 10) || jpmcConstants.DEFAULT_JWT_EXPIRY_SECONDS;
}

/**
 * @param {string} base64
 * @returns {string}
 */
function toBase64URL(base64) {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * @param {string} str
 * @returns {string}
 */
function base64UrlEncode(str) {
    var Bytes = require('dw/util/Bytes');
    var Encoding = require('dw/crypto/Encoding');
    return toBase64URL(Encoding.toBase64(new Bytes(str, 'UTF-8')));
}

/**
 * @param {Object} config
 * @returns {string}
 * @throws {Error}
 */
function generateJWT(config) {
    if (!config || !config.client_id || !config.audience || !config.privateKeyAlias) {
        throw new Error('Missing required JWT config: client_id, audience, privateKeyAlias');
    }

    var Signature = require('dw/crypto/Signature');
    var KeyRef = require('dw/crypto/KeyRef');
    var Bytes = require('dw/util/Bytes');
    var Encoding = require('dw/crypto/Encoding');
    
    var now = Math.floor(Date.now() / 1000);
    var exp = now + parseExpiration(config.expiresIn);
    
    var header = { alg: 'RS256', typ: 'JWT', kid: config.kid || '' };
    var payload = {
        jti: generateJTI(),
        iat: now,
        exp: exp,
        aud: config.audience,
        iss: config.client_id,
        sub: config.client_id
    };
    
    var signingInput = base64UrlEncode(JSON.stringify(header)) + '.' + base64UrlEncode(JSON.stringify(payload));
    
    var keyRef = new KeyRef(config.privateKeyAlias);
    var sig = new Signature();
    var sigBytes = sig.signBytes(new Bytes(signingInput, 'UTF-8'), keyRef, 'SHA256withRSA');
    
    return signingInput + '.' + toBase64URL(Encoding.toBase64(sigBytes));
}

module.exports = {
    generateJWT: generateJWT
};
