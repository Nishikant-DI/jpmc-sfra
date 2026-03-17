'use strict';

var ISML = require('dw/template/ISML');
var CSRFProtection = require('dw/web/CSRFProtection');
var Resource = require('dw/web/Resource');
var Logger = require('dw/system/Logger').getLogger('JPMC', 'bm-tools');

/**
 * Validate a certificate alias against the allowed pattern.
 * @param {string} alias
 * @returns {boolean}
 */
function isValidAlias(alias) {
    var constants = require('*/cartridge/scripts/helpers/jpmcConstants');
    return !!(alias && typeof alias === 'string' && constants.ALIAS_PATTERN.test(alias));
}

/**
 * Send JSON response to client.
 * @param {Object} data
 * @returns {void}
 */
function json(data) {
    response.setContentType('application/json');
    response.writer.print(JSON.stringify(data));
}

/**
 * Build and send a standard JSON response.
 * @param {boolean} success
 * @param {string} [message]
 * @param {Object} [extra]
 * @returns {void}
 */
function sendResponse(success, message, extra) {
    var resp = { success: success };
    if (message) resp.message = message;
    if (extra) {
        Object.keys(extra).forEach(function(key) {
            resp[key] = extra[key];
        });
    }
    json(resp);
}

/**
 * Renders thumbprint generator page.
 */
function thumbprintGenerator() {
    try {
        var Site = require('dw/system/Site');
        var URLUtils = require('dw/web/URLUtils');
        var site = Site.getCurrent();

        ISML.renderTemplate('jpmc/thumbprintGenerator', {
            kidConfigured: !!(site.getCustomPreferenceValue('jpmc_kid')),
            certAlias: site.getCustomPreferenceValue('JPMCCertAlias') || '',
            privateKeyAlias: site.getCustomPreferenceValue('JPMCPrivateKeyAlias') || '',
            saveUrl: URLUtils.url('JPMCTools-SaveThumbprint').toString(),
            getCertUrl: URLUtils.url('JPMCTools-GetCertificatePEM').toString(),
            // Two independent tokens — each endpoint consumes its own token.
            csrfTokenGet: CSRFProtection.getTokenName() + '=' + CSRFProtection.generateToken(),
            csrfTokenSave: CSRFProtection.getTokenName() + '=' + CSRFProtection.generateToken()
        });
    } catch (e) {
        Logger.error('Failed to render thumbprint generator page');
        response.writer.print(Resource.msg('error.page.load', 'jpmcbm', 'Error loading page'));
    }
}

/**
 * Returns the certificate DER as base64 for client-side SHA-1 thumbprint computation.
 * CSRF-protected. DER is only returned to authenticated BM sessions.
 */
function getCertificatePEM() {
    if (!CSRFProtection.validateRequest()) {
        Logger.warn('CSRF validation failed for GetCertificatePEM');
        sendResponse(false, 'Security validation failed');
        return;
    }

    var certAlias = request.httpParameterMap.certAlias.stringValue || '';

    if (!isValidAlias(certAlias)) {
        sendResponse(false, 'Invalid certificate alias format');
        return;
    }

    try {
        var CertificateRef = require('dw/crypto/CertificateRef');
        var CertificateUtils = require('dw/crypto/CertificateUtils');

        var derBase64 = CertificateUtils.getEncodedCertificate(new CertificateRef(certAlias));

        if (!derBase64) {
            sendResponse(false, 'Certificate not found');
            return;
        }

        sendResponse(true, '', { derBase64: derBase64 });
    } catch (e) {
        Logger.error('Certificate retrieval failed');
        sendResponse(false, 'Failed to retrieve certificate');
    }
}

/**
 * Saves thumbprint to site preferences.
 * The kid value is computed client-side via crypto.subtle SHA-1 and submitted via CSRF-protected POST.
 * Server validates the format against THUMBPRINT_PATTERN before persisting.
 */
function saveThumbprint() {
    if (!CSRFProtection.validateRequest()) {
        Logger.warn('CSRF validation failed for SaveThumbprint');
        sendResponse(false, 'Security validation failed');
        return;
    }

    var params = request.httpParameterMap;
    var kid = params.kid.stringValue || '';
    var certAlias = params.certAlias.stringValue || '';
    var privateKeyAlias = params.privateKeyAlias.stringValue || '';

    var constants = require('*/cartridge/scripts/helpers/jpmcConstants');
    if (!kid || !constants.THUMBPRINT_PATTERN.test(kid)) {
        sendResponse(false, 'Invalid thumbprint format');
        return;
    }

    if (certAlias && !isValidAlias(certAlias)) {
        sendResponse(false, 'Invalid certificate alias format');
        return;
    }

    if (privateKeyAlias && !isValidAlias(privateKeyAlias)) {
        sendResponse(false, 'Invalid private key alias format');
        return;
    }

    try {
        var Transaction = require('dw/system/Transaction');
        var Site = require('dw/system/Site');
        var site = Site.getCurrent();

        Transaction.wrap(function () {
            site.setCustomPreferenceValue('jpmc_kid', kid);
            if (certAlias) { site.setCustomPreferenceValue('JPMCCertAlias', certAlias); }
            if (privateKeyAlias) { site.setCustomPreferenceValue('JPMCPrivateKeyAlias', privateKeyAlias); }
        });

        sendResponse(true, 'Configuration saved');
    } catch (e) {
        Logger.error('Failed to save thumbprint configuration');
        sendResponse(false, 'Failed to save configuration');
    }
}

module.exports.ThumbprintGenerator = thumbprintGenerator;
module.exports.ThumbprintGenerator.public = true;

module.exports.GetCertificatePEM = getCertificatePEM;
module.exports.GetCertificatePEM.public = true;

module.exports.SaveThumbprint = saveThumbprint;
module.exports.SaveThumbprint.public = true;
