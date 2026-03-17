'use strict';

/**
 * JPMC PIE (Page Integrated Encryption) utility module
 * Shared encryption logic for billing and payment instruments
 */

/**
 * Checks if JPMC PIE library is ready
 * @returns {boolean} True if PIE library is fully loaded
 */
function isPieReady() {
    return typeof window.PIE !== 'undefined' &&
           typeof window.PIE.K !== 'undefined' &&
           typeof window.PIE.L !== 'undefined' &&
           typeof window.PIE.E !== 'undefined' &&
           typeof window.PIE.key_id !== 'undefined' &&
           typeof window.PIE.phase !== 'undefined' &&
           typeof window.ValidatePANChecksum === 'function' &&
           typeof window.ProtectPANandCVV === 'function';
}

/**
 * Encrypts card data using JPMC PIE
 * @param {string} cardNumber - Card number (will be sanitized)
 * @param {string} cvv - CVV/security code
 * @returns {Object|null} Encrypted data object or null if encryption fails
 */
function encryptCardData(cardNumber, cvv) {
    if (!cardNumber || !cvv || !isPieReady()) {
        return null;
    }

    var sanitizedCardNumber = cardNumber.replace(/\s/g, '');

    if (!window.ValidatePANChecksum(sanitizedCardNumber)) {
        return null;
    }

    var result = window.ProtectPANandCVV(sanitizedCardNumber, cvv, false);

    if (result && result[0] && result[1]) {
        return {
            accountNumber: result[0],
            cvv: result[1],
            encryptionIntegrityCheck: result[2] || null
        };
    }

    return null;
}

/**
 * Encrypts card data and stores in target element
 * @param {string} cardSelector - Selector for card number input
 * @param {string} cvvSelector - Selector for CVV input
 * @param {string} targetSelector - Selector for hidden encrypted data field
 * @returns {boolean} True if encryption was successful
 */
function encryptAndStore(cardSelector, cvvSelector, targetSelector) {
    var $target = $(targetSelector);
    var cardNumber = $(cardSelector).val();
    var cvv = $(cvvSelector).val();

    $target.val('');

    var encrypted = encryptCardData(cardNumber, cvv);
    if (encrypted) {
        $target.val(JSON.stringify(encrypted));
        return true;
    }

    return false;
}

module.exports = {
    encryptAndStore: encryptAndStore
};
