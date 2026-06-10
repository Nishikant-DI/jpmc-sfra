'use strict';

/**
 * @module scripts/helpers/AccountUpdaterHelper
  * @returns {Object} result
 */

var Logger = require('dw/system/Logger').getLogger('AccountUpdater', 'helper');
var Transaction = require('dw/system/Transaction');

var MRI_DELIMITER = '-CN-';
var RTAU_NO_UPDATE_CODES = {
    MATCH_NO_UPDATE: true,
    NO_MATCH_PARTICIPATING_BIN: true,
    NO_MATCH_NON_PARTICIPATING_BIN: true
};

/**
 * getConstants
  * @returns {Object} Constants module
 */
function getConstants() {
    return require('*/cartridge/scripts/helpers/JPMCConstants');
}

/**
 * getResolver
  * @returns {Object} JPMCMerchantResolver module
 */
function getResolver() {
    return require('*/cartridge/scripts/helpers/JPMCMerchantResolver');
}

/**
 * getServiceHelper
  * @returns {Object} Service helper module
 */
function getServiceHelper() {
    return require('*/cartridge/scripts/services/JPMCServiceHelper');
}

/**
 * createUUID
 * @returns {string} uuid
 */
function createUUID() {
    return require('dw/util/UUIDUtils').createUUID().toString();
}

/**
 * formatUUID
 * @param {string} uuidStr - uuid string
 * @returns {string} formatted uuid
 */
function formatUUID(uuidStr) {
    if (!uuidStr) {
        return '';
    }
    if (uuidStr.indexOf('-') !== -1) {
        return uuidStr;
    }
    var padded = uuidStr.length < 32
        ? uuidStr + new Array(32 - uuidStr.length + 1).join('0')
        : uuidStr;

    return padded.substring(0, 8) + '-'
        + padded.substring(8, 12) + '-'
        + padded.substring(12, 16) + '-'
        + padded.substring(16, 20) + '-'
        + padded.substring(20, 32);
}

/**
 * buildAuRequestHeaders
 * @param {string} merchantId - merchant id
 * @returns {Object} headers
 */
function buildAuRequestHeaders(merchantId) {
    return {
        'merchant-id': merchantId,
        'request-id': formatUUID(createUUID())
    };
}

/**
 * resolveForConfigKey
 * @param {string} configKey - config key
 * @returns {Object} resolved config
 */
function resolveForConfigKey(configKey) {
    var Resolver = getResolver();
    var locale = configKey ? configKey.split('::')[1] : null;
    return locale ? Resolver.resolve({ locale: locale }) : Resolver.resolve();
}

/**
 * buildRegistrationPayload
 * @param {string} token - card token
 * @param {string} month - expiration month
 * @param {string} year - expiration year
 * @param {string} accountNumberType - account number type
 * @param {string} merchantRecordIdentifier - merchant record identifier
 * @param {Object} AU - account updater constants
 * @returns {Object} payload
 */
function buildRegistrationPayload(token, month, year, accountNumberType, merchantRecordIdentifier, AU) {
    return {
        accountInformation: {
            accountNumberType: accountNumberType,
            cardNumber: token,
            expiry: { month: month, year: year }
        },
        merchantRecordIdentifier: merchantRecordIdentifier,
        cardAccountAction: AU.ACTION_REGISTER
    };
}

/**
 * isCardFlaggedByProvider
 * @param {string} reasonMessage - reason message
 * @param {Object} AU - account updater constants
 * @returns {boolean} result
 */
function isCardFlaggedByProvider(reasonMessage, AU) {
    return reasonMessage === AU.REASON_CLOSED_ACCOUNT
        || reasonMessage === AU.REASON_CONTACT_CARDHOLDER;
}

/**
 * processRegistrationResponse
 * @param {Object} serviceResult - service result
 * @param {string} creditCardToken - credit card token
 * @param {Object} AU - account updater constants
 * @returns {Object} result
 */
function processRegistrationResponse(serviceResult, creditCardToken, AU) {
    var result = { success: false, requestStatus: null, reasonMessage: null, error: null };

    if (!serviceResult.success || !serviceResult.data) {
        result.error = serviceResult.error || 'Account Updater service call failed';
        return result;
    }

    var data = serviceResult.data;
    result.requestStatus = data.requestStatus;
    result.reasonMessage = data.reasonMessage;

    if (data.requestStatus === AU.REGISTERED || data.requestStatus === AU.REGISTRATION_PENDING) {
        result.success = true;
        return result;
    }

    if (isCardFlaggedByProvider(data.reasonMessage, AU)) {
        result.error = 'Card flagged: ' + data.reasonMessage;
        unregisterCard(creditCardToken);
        return result;
    }

    result.error = data.responseMessage || ('Registration status: ' + data.requestStatus);
    return result;
}

/**
 * @param {string} creditCardToken - stored card token to register
 * @param {number} expirationMonth - card expiration month
 * @param {number} expirationYear - card expiration year
 * @param {string} merchantRecordIdentifier - unique identifier for this registration
 * @param {string} [merchantId] - Optional merchant ID for config resolution
 * @returns {Object} registration result
 */
function registerCard(creditCardToken, expirationMonth, expirationYear, merchantRecordIdentifier, merchantId) {
    var result = { success: false, requestStatus: null, reasonMessage: null, error: null };

    if (!creditCardToken || !expirationMonth || !expirationYear) {
        result.error = 'Missing required parameters';
        return result;
    }

    try {
        var constants = getConstants();
        var AU = constants.ACCOUNT_UPDATER;
        var Resolver = getResolver();
        var resolvedConfig = merchantId ? Resolver.resolveByMerchantId(merchantId) : Resolver.resolve();
        var accountNumberType = resolvedConfig.tokenizationType || constants.DEFAULT_TOKEN_TYPE;

        var payload = buildRegistrationPayload(
            creditCardToken,
            expirationMonth,
            expirationYear,
            accountNumberType,
            merchantRecordIdentifier,
            AU
        );

        var serviceResult = getServiceHelper().callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCAccountUpdater',
            method: 'POST',
            data: payload,
            headers: buildAuRequestHeaders(resolvedConfig.merchantId)
        });

        result = processRegistrationResponse(serviceResult, creditCardToken, AU);
    } catch (e) {
        result.error = e.message || String(e);
        Logger.error('registerCard: {0}', result.error);
    }

    return result;
}

/**
 * @param {string} creditCardToken - stored card token to unregister
 * @param {string} [merchantId] - Optional merchant ID for config resolution
 * @returns {Object} unregistration result
 */
function unregisterCard(creditCardToken, merchantId) {
    var result = { success: false, error: null };

    if (!creditCardToken) {
        result.error = 'Missing creditCardToken';
        return result;
    }

    try {
        var constants = getConstants();
        var AU = constants.ACCOUNT_UPDATER;
        var Resolver = getResolver();
        var resolvedConfig = merchantId ? Resolver.resolveByMerchantId(merchantId) : Resolver.resolve();

        var payload = {
            accountInformation: {
                accountNumberType: resolvedConfig.tokenizationType || constants.DEFAULT_TOKEN_TYPE,
                cardNumber: creditCardToken
            },
            cardAccountAction: AU.ACTION_UNREGISTER
        };

        var serviceResult = getServiceHelper().callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCAccountUpdater',
            method: 'POST',
            data: payload,
            headers: buildAuRequestHeaders(resolvedConfig.merchantId)
        });

        if (serviceResult.success) {
            result.success = true;
        } else {
            result.error = serviceResult.error || 'Service call failed';
        }
    } catch (e) {
        result.error = e.message || String(e);
        Logger.error('unregisterCard: {0}', result.error);
    }

    return result;
}

/**
 * constantTimeEquals
 * @param {string} a - first string
 * @param {string} b - second string
 * @returns {boolean} result
 */
function constantTimeEquals(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }

    var diff = a.length ^ b.length;
    var maxLen = a.length > b.length ? a.length : b.length;

    for (var i = 0; i < maxLen; i++) {
        var aCode = i < a.length ? a.charCodeAt(i) : 0;
        var bCode = i < b.length ? b.charCodeAt(i) : 0;
        diff |= aCode ^ bCode;
    }

    return diff === 0;
}

var BASIC_PREFIX = 'Basic ';

/**
 * authenticateWebhook - Validates webhook request authentication
 * @param {Object} req - webhook request object
 * @param {string} [locale] - Request locale for merchant config resolution
 * @returns {boolean} whether webhook authentication succeeded
 */
function authenticateWebhook(req, locale) {
    if (!req || !req.httpHeaders) {
        return false;
    }

    try {
        var Resolver = getResolver();
        var resolvedConfig = locale ? Resolver.resolve({ locale: locale }) : Resolver.resolve();
        var expectedSecret = resolvedConfig.accountUpdaterWebhookSecret;

        if (!expectedSecret) {
            Logger.error('authenticateWebhook: Webhook secret not configured');
            return false;
        }

        var authHeader = req.httpHeaders.get('authorization');

        if (!authHeader || typeof authHeader !== 'string' || authHeader.length < BASIC_PREFIX.length) {
            Logger.warn('authenticateWebhook: Missing or malformed Authorization header');
            return false;
        }

        if (authHeader.substring(0, BASIC_PREFIX.length) !== BASIC_PREFIX) {
            Logger.warn('authenticateWebhook: Unsupported authentication scheme');
            return false;
        }

        var Encoding = require('dw/crypto/Encoding');
        var Bytes = require('dw/util/Bytes');
        var username = resolvedConfig.accountUpdaterWebhookUser || '';
        var credentials = username + ':' + expectedSecret;
        var expectedEncoded = Encoding.toBase64(new Bytes(credentials, 'UTF-8'));
        var providedEncoded = authHeader.substring(BASIC_PREFIX.length);

        var authenticated = constantTimeEquals(providedEncoded, expectedEncoded);

        if (!authenticated) {
            Logger.warn('authenticateWebhook: Invalid credentials. Received encoded length={0}, expected encoded length={1}, resolved user="{2}"',
                providedEncoded.length, expectedEncoded.length, username);
        }

        return authenticated;
    } catch (e) {
        Logger.error('authenticateWebhook: {0}', e.message || String(e));
        return false;
    }
}

/**
 * Parses webhook notification body, extracting fields needed for queueing.
 * @param {Object} webhookBody - Parsed webhook JSON.
 * @returns {Object|null} Extracted fields or null if invalid.
 */
function parseWebhookNotification(webhookBody) {
    if (!webhookBody || !webhookBody.notificationId) {
        return null;
    }

    var notification = webhookBody.accountUpdateNotification;
    var status = notification && notification.accountUpdaterStatus;

    if (!status || !status.transactionId) {
        return null;
    }

    return {
        notificationId: String(webhookBody.notificationId),
        merchantId: webhookBody.merchantId ? String(webhookBody.merchantId) : '',
        transactionId: String(status.transactionId),
        reasonMessage: status.reasonMessage ? String(status.reasonMessage) : '',
        merchantRecordIdentifier: status.merchantRecordIdentifier
            ? String(status.merchantRecordIdentifier)
            : ''
    };
}

/**
 * Parses a GET /account-updates/{transactionId} response.
 *
 * @param {Object} webhookPayload - Parsed GET response body.
 * @returns {Object|null} result
 */
function parseAccountUpdaterPayload(webhookPayload) {
    if (!webhookPayload || !webhookPayload.requestId) {
        return null;
    }

    var parsed = {
        notificationId: webhookPayload.responseId || webhookPayload.requestId,
        requestStatus: webhookPayload.requestStatus || '',
        response: webhookPayload.response || '',
        merchantRecordIdentifier: webhookPayload.merchantRecordIdentifier || '',
        reasonMessage: '',
        oldCardToken: '',
        oldCardType: '',
        newCardToken: '',
        newCardType: '',
        newExpiryMonth: null,
        newExpiryYear: null,
        isCardNumberChanged: false,
        networkResponseCode: ''
    };

    var rm = webhookPayload.resultsMessage;
    if (!rm) {
        return parsed;
    }

    parsed.reasonMessage = rm.reasonMessage || '';
    parsed.networkResponseCode = rm.networkResponseCode || '';

    if (rm.oldAccountInformation) {
        parsed.oldCardToken = rm.oldAccountInformation.cardNumber || '';
        parsed.oldCardType = rm.oldAccountInformation.cardTypeName || '';
    }

    if (rm.newAccountInformation) {
        parsed.newCardToken = rm.newAccountInformation.cardNumber || '';
        parsed.newCardType = rm.newAccountInformation.cardTypeName || '';
        parsed.isCardNumberChanged = rm.newAccountInformation.paymentMethodChanged === true;

        var expiry = rm.newAccountInformation.expiry;
        if (expiry && expiry.month && expiry.year) {
            parsed.newExpiryMonth = parseInt(expiry.month, 10);
            parsed.newExpiryYear = parseInt(expiry.year, 10);
        }
    }

    return parsed;
}

/**
 * findPaymentInstrumentByMRI
 * @param {string} mri - merchant record identifier
 * @returns {Object|null} result
 */
function findPaymentInstrumentByMRI(mri) {
    if (!mri) {
        return null;
    }

    var separatorIndex = mri.indexOf(MRI_DELIMITER);
    if (separatorIndex === -1) {
        return null;
    }

    var piUUID = mri.substring(0, separatorIndex);
    var customerNo = mri.substring(separatorIndex + MRI_DELIMITER.length);

    if (!piUUID || !customerNo) {
        return null;
    }

    try {
        var CustomerMgr = require('dw/customer/CustomerMgr');
        var PaymentInstrument = require('dw/order/PaymentInstrument');

        var customer = CustomerMgr.getCustomerByCustomerNumber(customerNo);
        if (!customer || !customer.getProfile()) {
            return null;
        }

        var wallet = customer.getProfile().getWallet();
        if (!wallet) {
            return null;
        }

        var iterator = wallet.getPaymentInstruments(PaymentInstrument.METHOD_CREDIT_CARD).iterator();
        while (iterator.hasNext()) {
            var pi = iterator.next();
            if (pi && pi.getUUID() === piUUID) {
                return pi;
            }
        }

        return null;
    } catch (e) {
        Logger.error('findPaymentInstrumentByMRI: {0}', e.message || String(e));
        return null;
    }
}

/**
 * Calls GET /account-updates/{transactionId}
 * @param {string} transactionId - account update transaction ID
 * @param {string} merchantId - merchant ID for config resolution
 * @returns {Object} account update response
 */
function fetchAccountUpdate(transactionId, merchantId) {
    var result = { success: false, data: null, error: null, statusCode: null };

    if (!transactionId) {
        result.error = 'transactionId is required';
        return result;
    }

    try {
        var Resolver = getResolver();
        var resolvedConfig = merchantId
            ? Resolver.resolveByMerchantId(merchantId)
            : Resolver.resolve();

        if (!resolvedConfig || !resolvedConfig.merchantId) {
            result.error = 'Unable to resolve merchant config for merchantId=' + (merchantId || 'N/A');
            return result;
        }

        var serviceResult = getServiceHelper().callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCAccountUpdater',
            method: 'GET',
            urlSuffix: '/' + transactionId,
            headers: buildAuRequestHeaders(resolvedConfig.merchantId),
            resolvedConfig: resolvedConfig
        });

        result.statusCode = serviceResult.statusCode || null;

        if (!serviceResult.success || !serviceResult.data) {
            result.error = serviceResult.error || 'GET /account-updates/{transactionId} failed';
            return result;
        }

        result.success = true;
        result.data = serviceResult.data;
    } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
        Logger.error('fetchAccountUpdate: {0}', result.error);
    }

    return result;
}

/**
 * Updates customer wallet PI using parsed GET response data.
 * @param {Object} parsedGetData - Result of parseAccountUpdaterPayload()
 * @param {string} [merchantId] - Optional merchant ID for config resolution
 * @returns {Object} result
 */
function updateCustomerWallet(parsedGetData, merchantId) {
    var result = { success: false, error: null, customerNo: null };

    if (!parsedGetData || !parsedGetData.merchantRecordIdentifier) {
        result.error = 'Invalid parsed data: missing merchantRecordIdentifier';
        return result;
    }

    var mri = parsedGetData.merchantRecordIdentifier;
    var separatorIndex = mri.indexOf(MRI_DELIMITER);

    if (separatorIndex === -1) {
        result.error = 'Invalid merchantRecordIdentifier format';
        return result;
    }

    result.customerNo = mri.substring(separatorIndex + MRI_DELIMITER.length);

    try {
        var oldPI = findPaymentInstrumentByMRI(mri);
        if (!oldPI) {
            result.error = 'PaymentInstrument not found for mri=' + mri;
            return result;
        }

        var CustomerMgr = require('dw/customer/CustomerMgr');
        var PaymentInstrument = require('dw/order/PaymentInstrument');

        var customer = CustomerMgr.getCustomerByCustomerNumber(result.customerNo);
        if (!customer || !customer.getProfile()) {
            result.error = 'Customer or profile not found for customerNo=' + result.customerNo;
            return result;
        }

        var wallet = customer.getProfile().getWallet();
        if (!wallet) {
            result.error = 'Wallet not found for customerNo=' + result.customerNo;
            return result;
        }

        var newToken = parsedGetData.newCardToken || parsedGetData.oldCardToken;
        if (!newToken) {
            result.error = 'No card token available in GET response';
            return result;
        }

        var expMonth = parsedGetData.newExpiryMonth || oldPI.getCreditCardExpirationMonth();
        var expYear = parsedGetData.newExpiryYear || oldPI.getCreditCardExpirationYear();

        var Transaction = require('dw/system/Transaction'); // eslint-disable-line no-shadow
        var newMRI;
        Transaction.wrap(function () {
            var newPI = wallet.createPaymentInstrument(PaymentInstrument.METHOD_CREDIT_CARD);

            newPI.setCreditCardHolder(oldPI.getCreditCardHolder());
            newPI.setCreditCardNumber(oldPI.getCreditCardNumber());
            newPI.setCreditCardType(oldPI.getCreditCardType());
            newPI.setCreditCardExpirationMonth(expMonth);
            newPI.setCreditCardExpirationYear(expYear);
            newPI.setCreditCardToken(newToken);

            wallet.removePaymentInstrument(oldPI);

            newMRI = newPI.getUUID() + MRI_DELIMITER + result.customerNo;
            newPI.custom.jpmcMerchantRecordIdentifier = newMRI;
        });

        result.success = true;

        if (parsedGetData.oldCardToken) {
            try {
                var unregResult = unregisterCard(parsedGetData.oldCardToken, merchantId);
                if (!unregResult.success) {
                    Logger.warn('updateCustomerWallet: old token unregistration failed for mri={0} - {1}',
                        mri, unregResult.error);
                }
            } catch (unregErr) {
                Logger.warn('updateCustomerWallet: old token unregistration error for mri={0} - {1}',
                    mri, unregErr.message || String(unregErr));
            }
        }

        try {
            var regResult = registerCard(newToken, expMonth, expYear, newMRI, merchantId);
            if (!regResult.success) {
                Logger.warn('updateCustomerWallet: re-registration failed for mri={0} - {1}',
                    newMRI, regResult.error);
            }
        } catch (regErr) {
            Logger.warn('updateCustomerWallet: re-registration error for mri={0} - {1}',
                newMRI, regErr.message || String(regErr));
        }
    } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
        Logger.error('updateCustomerWallet: {0}', result.error);
    }

    return result;
}

/**
 * Validates subscription config prerequisites and builds the webhook payload.
 * @param {string} [configKey] - merchant config key for resolution
 * @returns {Object} subscription payload or error
 */
function buildSubscriptionPayload(configKey) {
    var constants = getConstants();
    var AU = constants.ACCOUNT_UPDATER;
    var resolvedConfig = resolveForConfigKey(configKey);

    if (!resolvedConfig.merchantId) {
        return { error: 'Merchant ID is not configured', resolvedConfig: null, payload: null };
    }
    var auMode = String(resolvedConfig.accountUpdaterMode || 'NONE').toUpperCase();
    if (auMode === 'NONE' || auMode === 'REAL_TIME') {
        return {
            error: 'Account Updater Mode is "' + auMode
                + '" - webhook notifications are disabled. Set the mode to NOTIFICATIONS or BOTH before subscribing.',
            resolvedConfig: null,
            payload: null
        };
    }
    if (!resolvedConfig.accountUpdaterWebhookSecret) {
        return { error: 'Webhook secret is not configured', resolvedConfig: null, payload: null };
    }
    if (!resolvedConfig.accountUpdaterWebhookUser) {
        return { error: 'Webhook username is not configured', resolvedConfig: null, payload: null };
    }

    var Encoding = require('dw/crypto/Encoding');
    var Bytes = require('dw/util/Bytes');
    var Site = require('dw/system/Site');
    var webhookUser = resolvedConfig.accountUpdaterWebhookUser;
    var secret = resolvedConfig.accountUpdaterWebhookSecret;
    var basicCredentials = Encoding.toBase64(new Bytes(webhookUser + ':' + secret, 'UTF-8'));

    var locale = configKey ? configKey.split('::')[1] : null;
    var siteId = Site.getCurrent().getID();
    var httpsHost = Site.getCurrent().getHttpsHostName();
    var callbackURL = 'https://' + httpsHost
        + '/on/demandware.store/Sites-' + siteId + '-Site/'
        + (locale || 'default')
        + '/AccountUpdater-Notify';

    var payload = {
        notifications: {},
        securityPreferences: {
            webhookAuthorizationType: 'basic',
            headerFields: {
                'Authorization': 'Basic ' + basicCredentials
            }
        },
        subscriptionChannels: ['WEBHOOK'],
        callbackURL: callbackURL
    };
    payload.notifications[AU.EVENT_TYPE] = [AU.EVENT_SUBTYPE];

    return { error: null, resolvedConfig: resolvedConfig, payload: payload };
}

/**
 * Validates JPMC subscription response (responseStatus=SUCCESS, responseCode=ACCEPTED).
 * @param {Object} data - Service response data
 * @param {string} operationLabel - Label for error messages (e.g. 'rejected', 'update rejected')
 * @returns {string|null} Error string or null if valid
 */
function validateSubscriptionResponse(data, operationLabel) {
    if (data.responseStatus && String(data.responseStatus).toUpperCase() !== 'SUCCESS') {
        return 'JPMC subscription ' + operationLabel + ': '
            + (data.responseMessage || data.responseStatus)
            + (data.responseCode ? ' (code=' + data.responseCode + ')' : '');
    }
    if (data.responseCode && String(data.responseCode).toUpperCase() !== 'ACCEPTED') {
        return 'JPMC subscription ' + operationLabel + ': '
            + (data.responseMessage || data.responseCode);
    }
    return null;
}

/**
 * Extracts subscriptionId from JPMC response data.
 * @param {Object} data - Service response data
 * @returns {string|null} result
 */
function extractSubscriptionId(data) {
    return data.subscriptionId
        || data.id
        || (data.subscription && data.subscription.id)
        || null;
}

/**
 * Creates a new webhook subscription with JPMC.
 * @param {string} [configKey] - merchant config key for resolution
 * @returns {Object} subscription result
 */
function subscribe(configKey) {
    var result = { success: false, subscriptionId: null, error: null };

    try {
        var prepared = buildSubscriptionPayload(configKey);
        if (prepared.error) {
            result.error = prepared.error;
            return result;
        }

        var resolvedConfig = prepared.resolvedConfig;
        var serviceResult = getServiceHelper().callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCAccountUpdaterSubscription',
            method: 'POST',
            data: prepared.payload,
            headers: {
                'entity-id': resolvedConfig.merchantId,
                'entity-type': 'MERCHANT',
                'request-id': 'AU-SUB-' + createUUID()
            },
            resolvedConfig: resolvedConfig
        });

        if (!serviceResult.success || !serviceResult.data) {
            result.error = serviceResult.error || 'Subscription request failed';
            return result;
        }

        var validationError = validateSubscriptionResponse(serviceResult.data, 'rejected');
        if (validationError) {
            result.error = validationError;
            return result;
        }

        var subscriptionId = extractSubscriptionId(serviceResult.data);
        if (!subscriptionId) {
            result.error = 'No subscriptionId returned by JPMC';
            return result;
        }

        var Resolver = getResolver();
        var saved = Resolver.saveWebhookSubscriptionId(
            subscriptionId,
            configKey || resolvedConfig.configKey
        );
        if (!saved) {
            result.error = 'Subscription created but failed to persist subscriptionId';
            return result;
        }

        result.success = true;
        result.subscriptionId = subscriptionId;
    } catch (e) {
        result.error = e.message || String(e);
        Logger.error('subscribe: {0}', result.error);
    }

    return result;
}

/**
 * @param {string} [configKey] - merchant config key for resolution
 * @returns {Object} deletion result
 */
function deleteSubscription(configKey) {
    var result = { success: false, error: null };

    try {
        var Resolver = getResolver();
        var resolvedConfig = resolveForConfigKey(configKey);
        var subscriptionId = resolvedConfig.jpmcWebhookSubscriptionId;

        if (!subscriptionId) {
            result.error = 'No subscriptionId on file';
            return result;
        }
        if (!resolvedConfig.merchantId) {
            result.error = 'Merchant ID is not configured';
            return result;
        }

        var serviceResult = getServiceHelper().callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCAccountUpdaterSubscription',
            method: 'DELETE',
            urlSuffix: '/' + subscriptionId,
            headers: {
                'entity-id': resolvedConfig.merchantId,
                'entity-type': 'MERCHANT',
                'request-id': 'AU-DEL-' + createUUID(),
                'merchant-id': resolvedConfig.merchantId
            },
            resolvedConfig: resolvedConfig
        });

        var statusCode = serviceResult.statusCode || 0;
        if (!serviceResult.success && statusCode !== 404) {
            result.error = serviceResult.error || 'Delete subscription failed';
            return result;
        }

        Resolver.clearWebhookSubscriptionId(resolvedConfig.configKey);
        result.success = true;
    } catch (e) {
        result.error = e.message || String(e);
        Logger.error('deleteSubscription: {0}', result.error);
    }

    return result;
}

/**
 * Updates an existing webhook subscription in place via PUT /subscriptions/{id}.
 * Per JPMC spec this preserves the subscriptionId and history; callbackURL
 * changes take effect after ~1 hour, other changes are immediate.
 *
 * @param {string} [configKey] - merchant config key for resolution
 * @returns {Object} update result
 */
function updateSubscription(configKey) {
    var result = { success: false, subscriptionId: null, error: null };

    try {
        var resolvedConfig = resolveForConfigKey(configKey);
        var subscriptionId = resolvedConfig.jpmcWebhookSubscriptionId;

        if (!subscriptionId) {
            return subscribe(configKey);
        }

        var prepared = buildSubscriptionPayload(configKey);
        if (prepared.error) {
            result.error = prepared.error;
            return result;
        }

        var serviceResult = getServiceHelper().callWithTokenGeneration({
            tokenServiceId: 'JPMCAccessToken',
            serviceId: 'JPMCAccountUpdaterSubscription',
            method: 'PUT',
            urlSuffix: '/' + subscriptionId,
            data: prepared.payload,
            headers: {
                'entity-id': prepared.resolvedConfig.merchantId,
                'entity-type': 'MERCHANT',
                'request-id': 'AU-UPD-' + createUUID()
            },
            resolvedConfig: prepared.resolvedConfig
        });

        if (!serviceResult.success || !serviceResult.data) {
            result.error = serviceResult.error || 'Subscription update failed';
            return result;
        }

        var validationError = validateSubscriptionResponse(serviceResult.data, 'update rejected');
        if (validationError) {
            result.error = validationError;
            return result;
        }

        result.success = true;
        result.subscriptionId = extractSubscriptionId(serviceResult.data) || subscriptionId;
    } catch (e) {
        result.error = e.message || String(e);
        Logger.error('updateSubscription: {0}', result.error);
    }

    return result;
}

/**
 * extractRtauNewToken
 * @param {Object} responseData - response data
 * @param {Object} auBlock - account updater block
 * @returns {string|null} token
 */
function extractRtauNewToken(responseData, auBlock) {
    if (auBlock && auBlock.accountNumber) {
        return auBlock.accountNumber;
    }

    var card = responseData.paymentMethodType && responseData.paymentMethodType.card;
    if (!card || !Array.isArray(card.paymentTokens)) {
        return null;
    }

    for (var i = 0; i < card.paymentTokens.length; i++) {
        var token = card.paymentTokens[i];
        if (token && token.tokenNumber && token.responseStatus === 'SUCCESS') {
            return token.tokenNumber;
        }
    }
    return null;
}

/**
 * @param {dw.order.PaymentInstrument} paymentInstrument - payment instrument to update
 * @param {Object} responseData - RTAU response from JPMC
 * @returns {Object} update summary (updated, action)
 */
function handleRTAUResponse(paymentInstrument, responseData) {
    var summary = { updated: false, action: null };

    if (!paymentInstrument || !responseData) {
        return summary;
    }

    try {
        var card = responseData.paymentMethodType && responseData.paymentMethodType.card;
        var au = responseData.accountUpdater || (card && card.accountUpdater);
        if (!au) {
            return summary;
        }

        var responseCode = au.accountUpdaterResponse || null;
        summary.action = responseCode;

        if (!responseCode || RTAU_NO_UPDATE_CODES[responseCode]) {
            return summary;
        }

        var newToken = extractRtauNewToken(responseData, au);
        var expiry = au.newAccountExpiry || au.expiry || null;
        var newMonth = expiry && parseInt(String(expiry.month), 10);
        var newYear = expiry && parseInt(String(expiry.year), 10);

        if (!newToken && !(newMonth && newYear)) {
            return summary;
        }

        Transaction.wrap(function () {
            if (newToken) {
                paymentInstrument.setCreditCardToken(newToken);
            }
            if (newMonth && newYear) {
                paymentInstrument.setCreditCardExpirationMonth(newMonth);
                paymentInstrument.setCreditCardExpirationYear(newYear);
            }
        });

        summary.updated = true;
    } catch (e) {
        Logger.error('handleRTAUResponse: {0}', e.message || String(e));
    }

    return summary;
}

module.exports = {
    registerCard: registerCard,
    unregisterCard: unregisterCard,
    authenticateWebhook: authenticateWebhook,
    parseWebhookNotification: parseWebhookNotification,
    parseAccountUpdaterPayload: parseAccountUpdaterPayload,
    fetchAccountUpdate: fetchAccountUpdate,
    updateCustomerWallet: updateCustomerWallet,
    subscribe: subscribe,
    deleteSubscription: deleteSubscription,
    updateSubscription: updateSubscription,
    handleRTAUResponse: handleRTAUResponse
};
