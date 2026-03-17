'use strict';

var Logger = require('dw/system/Logger').getLogger('JPMC', 'jpmc_payment');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var PaymentMgr = require('dw/order/PaymentMgr');
var Resource = require('dw/web/Resource');
var Transaction = require('dw/system/Transaction');

/**
 * Clears sensitive payment data (CVV, encrypted card data) from session.privacy.
 * Called on every exit path from Handle/authorize. No-op if session is unavailable.
 */
function clearSensitivePaymentData() {
    try {
        session.privacy.jpmcCvv = null;
        session.privacy.jpmcEncryptedCvv = null;
        session.privacy.jpmcEncryptedData = null;
    } catch (e) {
        Logger.error('clearSensitivePaymentData: Failed to clear session - {0}', e.message || String(e));
    }
}

/**
 * Extracts the first successful SAFETECH token from a verification response
 * @param {Object} verificationData
 * @returns {String|null}
 */
function extractSafetechToken(verificationData) {
    var tokens = verificationData
        && verificationData.paymentMethodType
        && verificationData.paymentMethodType.card
        && verificationData.paymentMethodType.card.paymentTokens;

    if (!tokens) {
        return null;
    }

    for (var i = 0; i < tokens.length; i++) {
        if (tokens[i].tokenProvider === 'SAFETECH'
            && tokens[i].responseStatus === 'SUCCESS'
            && tokens[i].tokenNumber) {
            return tokens[i].tokenNumber;
        }
    }

    return null;
}

/**
 * Extracts payment information from billing form including PIE encrypted data
 * @param {Object} req
 * @param {Object} paymentForm
 * @param {Object} viewFormData
 * @returns {Object}
 */
function processForm(req, paymentForm, viewFormData) {
    var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');

    var paymentMethodValue = paymentForm.paymentMethod.value;
    if (paymentMethodValue === jpmcConstants.JPMC_GOOGLE_PAY) {
        var googlePayHook = require('*/cartridge/scripts/hooks/payment/processor/jpmc_googlepay');
        return googlePayHook.processForm(req, paymentForm, viewFormData);
    }

    var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
    var array = require('*/cartridge/scripts/util/array');
    
    var viewData = viewFormData;
    var creditCardFields = paymentForm.creditCardFields;

    if (!req.form.storedPaymentUUID) {
        var creditCardErrors = COHelpers.validateCreditCard(paymentForm);
        if (Object.keys(creditCardErrors).length) {
            return { fieldErrors: creditCardErrors, error: true };
        }
    }

    viewData.paymentMethod = {
        value: paymentForm.paymentMethod.value,
        htmlName: paymentForm.paymentMethod.value
    };

    viewData.paymentInformation = {
        cardNumber: { value: creditCardFields.cardNumber.value, htmlName: creditCardFields.cardNumber.htmlName },
        cardType: { value: creditCardFields.cardType.value, htmlName: creditCardFields.cardType.htmlName },
        securityCode: { value: creditCardFields.securityCode.value, htmlName: creditCardFields.securityCode.htmlName },
        expirationMonth: { value: parseInt(creditCardFields.expirationMonth.selectedOption, 10), htmlName: creditCardFields.expirationMonth.htmlName },
        expirationYear: { value: parseInt(creditCardFields.expirationYear.value, 10), htmlName: creditCardFields.expirationYear.htmlName }
    };

    if (req.form.storedPaymentUUID) {
        viewData.storedPaymentUUID = req.form.storedPaymentUUID;
    }

    viewData.saveCard = creditCardFields.saveCard.checked;

    if (viewData.storedPaymentUUID && req.currentCustomer.raw.authenticated && req.currentCustomer.raw.registered) {
        var paymentInstrument = array.find(req.currentCustomer.wallet.paymentInstruments, function (item) {
            return viewData.storedPaymentUUID === item.UUID;
        });
        if (paymentInstrument) {
            viewData.paymentInformation.cardNumber.value = paymentInstrument.creditCardNumber;
            viewData.paymentInformation.cardType.value = paymentInstrument.creditCardType;
            viewData.paymentInformation.securityCode.value = req.form.securityCode;
            viewData.paymentInformation.expirationMonth.value = paymentInstrument.creditCardExpirationMonth;
            viewData.paymentInformation.expirationYear.value = paymentInstrument.creditCardExpirationYear;
            viewData.paymentInformation.creditCardToken = paymentInstrument.raw.creditCardToken;
            viewData.paymentInformation.storedPaymentUUID = viewData.storedPaymentUUID;
        }
    }

    var encryptedDataValue = creditCardFields.encryptedData && creditCardFields.encryptedData.value;
    if (encryptedDataValue) {
        viewData.paymentInformation.encryptedData = { value: encryptedDataValue };
    }
    viewData.paymentInformation.saveCard = creditCardFields.saveCard.checked;

    return { error: false, viewData: viewData };
}


/**
 * Save the credit card information to login account if save card option is selected
 * @param {Object} req
 * @param {dw.order.Basket} basket
 * @param {Object} billingData
 */
function savePaymentInformation(req, basket, billingData) {
    var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
    var CustomerMgr = require('dw/customer/CustomerMgr');
    var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');

    // Google Pay does not support saving card to wallet
    if (billingData.paymentMethod && billingData.paymentMethod.value === jpmcConstants.JPMC_GOOGLE_PAY) {
        return;
    }

    if (!billingData.storedPaymentUUID
        && req.currentCustomer.raw.authenticated
        && req.currentCustomer.raw.registered
        && billingData.saveCard
        && (billingData.paymentMethod.value === 'CREDIT_CARD' && session.privacy.jpmcCardSafeTechToken)
    ) {
        var customer = CustomerMgr.getCustomerByCustomerNumber(
            req.currentCustomer.profile.customerNo
        );

        var saveCardResult = COHelpers.savePaymentInstrumentToWallet(
            billingData,
            basket,
            customer
        );

        req.currentCustomer.wallet.paymentInstruments.push({
            creditCardHolder: saveCardResult.creditCardHolder,
            maskedCreditCardNumber: saveCardResult.maskedCreditCardNumber,
            creditCardType: saveCardResult.creditCardType,
            creditCardExpirationMonth: saveCardResult.creditCardExpirationMonth,
            creditCardExpirationYear: saveCardResult.creditCardExpirationYear,
            UUID: saveCardResult.UUID,
            creditCardNumber: Object.hasOwnProperty.call(
                saveCardResult,
                'creditCardNumber'
            )
                ? saveCardResult.creditCardNumber
                : null,
            raw: saveCardResult
        });
    }
}

/**
 * Validates PIE encrypted data and creates payment instrument on basket
 * @param {dw.order.Basket} basket
 * @param {Object} paymentInformation
 * @param {string} paymentMethodID
 * @param {Object} req
 * @returns {Object}
 */
function Handle(basket, paymentInformation, paymentMethodID, req) {
    var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');

    if (paymentMethodID === jpmcConstants.JPMC_GOOGLE_PAY) {
        var googlePayHook = require('*/cartridge/scripts/hooks/payment/processor/jpmc_googlepay');
        return googlePayHook.Handle(basket, paymentInformation, paymentMethodID, req);
    }

    var collections = require('*/cartridge/scripts/util/collections');
    
    var serverErrors = [];
    var cardType = paymentInformation.cardType.value;
    var isStoredCard = !!paymentInformation.storedPaymentUUID;
    var isSaveCardChecked = paymentInformation.saveCard;
    var encrypted = null;
    session.privacy.jpmcCardSafeTechToken = null;
    if (paymentMethodID === PaymentInstrument.METHOD_CREDIT_CARD) {
        var creditCardPaymentMethod = PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_CREDIT_CARD);
        
        if (!creditCardPaymentMethod) {
            return { 
                fieldErrors: [], 
                serverErrors: [Resource.msg('error.payment.not.valid', 'checkout', null)], 
                error: true 
            };
        }
        
        var paymentCardValue = PaymentMgr.getPaymentCard(cardType);
        
        if (!paymentCardValue) {
            return { 
                fieldErrors: [], 
                serverErrors: [Resource.msg('error.payment.not.valid', 'checkout', null)], 
                error: true 
            };
        }
        
        var applicablePaymentCards = creditCardPaymentMethod.getApplicablePaymentCards(
            req.currentCustomer.raw,
            req.geolocation.countryCode,
            null
        );

        if (!applicablePaymentCards.contains(paymentCardValue)) {
            return { 
                fieldErrors: [], 
                serverErrors: [Resource.msg('error.payment.not.valid', 'checkout', null)], 
                error: true 
            };
        }
    }
    if (!isStoredCard) {
        try {
            if (!paymentInformation.encryptedData || !paymentInformation.encryptedData.value) {
                Logger.error('Handle: JPMC encrypted data missing');
                serverErrors.push(Resource.msg('error.payment.encryption.missing', 'checkout', null));
                return { fieldErrors: [], serverErrors: serverErrors, error: true };
            }
            encrypted = JSON.parse(paymentInformation.encryptedData.value);
            if (!encrypted.accountNumber || !encrypted.cvv) {
                Logger.error('Handle: Invalid encrypted data structure');
                serverErrors.push(Resource.msg('error.payment.encryption.invalid', 'checkout', null));
                return { fieldErrors: [], serverErrors: serverErrors, error: true };
            }
        } catch (e) {
            var errorMsg = e instanceof Error ? e.message : String(e);
            Logger.error('Handle: Failed to parse encrypted data: {0}', errorMsg);
            serverErrors.push(Resource.msg('error.payment.encryption.invalid', 'checkout', null));
            return { fieldErrors: [], serverErrors: serverErrors, error: true };
        }
    }
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var jpmcConfig = JPMCConfig.getConfig();
    var storedCardTokenType = jpmcConfig.accountNumberType || jpmcConstants.DEFAULT_TOKEN_TYPE;
    var paymentInstrument = null;
    Transaction.wrap(function () {
        var paymentInstruments = basket.getPaymentInstruments(PaymentInstrument.METHOD_CREDIT_CARD);
        collections.forEach(paymentInstruments, function (item) {
            basket.removePaymentInstrument(item);
        });

        // Remove any existing Google Pay instruments — only one payment method at a time
        var existingGPayInstruments = basket.getPaymentInstruments(jpmcConstants.JPMC_GOOGLE_PAY);
        collections.forEach(existingGPayInstruments, function (item) {
            basket.removePaymentInstrument(item);
        });

        paymentInstrument = basket.createPaymentInstrument(
            PaymentInstrument.METHOD_CREDIT_CARD, 
            basket.totalGrossPrice
        );

        var billingAddress = basket.getBillingAddress();
        if (billingAddress && billingAddress.fullName) {
            paymentInstrument.setCreditCardHolder(billingAddress.fullName);
        }
        
        paymentInstrument.setCreditCardNumber(
            isStoredCard ? paymentInformation.cardNumber.value : encrypted.accountNumber
        );
        paymentInstrument.setCreditCardType(cardType);
        paymentInstrument.setCreditCardExpirationMonth(paymentInformation.expirationMonth.value);
        paymentInstrument.setCreditCardExpirationYear(paymentInformation.expirationYear.value);

        // Only set token on basket PI for stored cards
        // New cards will get token after verification
        if (isStoredCard) {
            paymentInstrument.setCreditCardToken(paymentInformation.creditCardToken);
        }
        
        // Capture Kount session ID from form for fraud detection (non-sensitive — OK on PI)
        if (req.form.kountSessionId) {
            paymentInstrument.custom.kountSessionId = req.form.kountSessionId;
        }
    });

    // Store CVV / encrypted card data in session.privacy (memory-only, never persisted).
    // Cleared on every exit path in authorize().
    if (isStoredCard) {
        session.privacy.jpmcCvv = paymentInformation.securityCode.value;
        session.privacy.jpmcEncryptedCvv = null;
        session.privacy.jpmcEncryptedData = null;
    } else if (encrypted) {
        session.privacy.jpmcCvv = null;
        session.privacy.jpmcEncryptedCvv = encrypted.cvv || null;
        session.privacy.jpmcEncryptedData = JSON.stringify(encrypted);
    }
    var HookMgr = require('dw/system/HookMgr');
    if (HookMgr.hasHook('app.safetech.fraud.detection')) {
        var accountNumberType = isStoredCard ? storedCardTokenType : jpmcConstants.ACCOUNT_NUMBER_TYPE_PIE;
        
        var fraudDetectionResult = HookMgr.callHook(
            'app.safetech.fraud.detection',
            'fraudDetection',
            basket,
            paymentInstrument,
            { accountNumberType: accountNumberType }
        );
        if (fraudDetectionResult.fraudRuleAction) {
            Transaction.wrap(function () {
                paymentInstrument.custom.jpmcFraudRuleAction = fraudDetectionResult.fraudRuleAction;
            });
        }
        if (fraudDetectionResult.status === 'fail') {
            Transaction.wrap(function () {
                basket.removePaymentInstrument(paymentInstrument);
            });
            clearSensitivePaymentData();
            Logger.warn('Handle: Fraud detection declined payment for order in progress');
            serverErrors.push(Resource.msg('error.fraud.declined', 'checkout', null));
            return { fieldErrors: [], serverErrors: serverErrors, error: true };
        }
    }
    var safetechToken = null;
    try {
        var JPMCPaymentHelper = require('*/cartridge/scripts/helpers/JPMCPaymentHelper');
        var accountOnFile = isStoredCard ? 'STORED' : (isSaveCardChecked ? 'TO_BE_STORED' : 'NOT_STORED');
        var cardData = {
            accountNumber: isStoredCard ? paymentInformation.creditCardToken : encrypted.accountNumber,
            expirationMonth: paymentInformation.expirationMonth.value,
            expirationYear: paymentInformation.expirationYear.value
        };
        if (!isStoredCard) {
            cardData.cvv = encrypted.cvv;
            if (encrypted.encryptionIntegrityCheck) {
                cardData.encryptionIntegrityCheck = encrypted.encryptionIntegrityCheck;
            }
        }
        var verificationOptions = {
            currency: basket.getCurrencyCode(),
            billingAddress: basket.getBillingAddress(),
            email: basket.getCustomerEmail(),
            initiatorType: 'CARDHOLDER',
            accountOnFile: accountOnFile,
            isStoredCard: isStoredCard,
            accountNumberType: isStoredCard ? storedCardTokenType : jpmcConstants.ACCOUNT_NUMBER_TYPE_PIE
        };
        var verifyResult = JPMCPaymentHelper.verifyPaymentInstrument(cardData, verificationOptions);
        
        if (!verifyResult.success) {
            Logger.error('Handle: JPMC verification failed for order in progress');
            clearSensitivePaymentData();
            serverErrors.push(Resource.msg('error.payment.verification.failed', 'checkout', null));
            return { fieldErrors: [], serverErrors: serverErrors, error: true };
        }
        if (!isStoredCard && verifyResult.data) {
            safetechToken = extractSafetechToken(verifyResult.data);
            if (safetechToken && isSaveCardChecked) {
                session.privacy.jpmcCardSafeTechToken = safetechToken;
            }
        }

        // If shopper did not opt to save the card, ensure no SAFETECH token lingers in session
        if (!isSaveCardChecked) {
            session.privacy.jpmcCardSafeTechToken = null;
        }
        if (!isStoredCard && isSaveCardChecked && safetechToken) {
            Transaction.wrap(function () {
                paymentInstrument.setCreditCardToken(safetechToken);
            });
        }
        
    } catch (e) {
        var errorMsg = e instanceof Error ? e.message : String(e);
        Logger.error('Handle: JPMC verification exception - {0}', errorMsg);
        clearSensitivePaymentData();
        serverErrors.push(Resource.msg('error.payment.verification.exception', 'checkout', null));
        return { fieldErrors: [], serverErrors: serverErrors, error: true };
    }

    return { fieldErrors: {}, serverErrors: [], error: false };
}

/**
 * Authorizes payment via JPMC processor.
 * @param {string} orderNumber
 * @param {dw.order.PaymentInstrument} paymentInstrument
 * @param {dw.order.PaymentProcessor} paymentProcessor
 * @returns {Object}
 */
function Authorize(orderNumber, paymentInstrument, paymentProcessor) {
    var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');
    var serverErrors = [];
    var fieldErrors = {};

    try {
        if (!paymentProcessor || !paymentProcessor.getID().equalsIgnoreCase(jpmcConstants.JPMC_Processor) || !paymentInstrument) {
            serverErrors.push(Resource.msg('error.payment.processor.not.supported', 'checkout', null));
            return { fieldErrors: fieldErrors, serverErrors: serverErrors, error: true };
        }
        var paymentMethodID = paymentInstrument.getPaymentMethod();
        if (paymentMethodID === jpmcConstants.JPMC_GOOGLE_PAY) {
            var googlePayHook = require('*/cartridge/scripts/hooks/payment/processor/jpmc_googlepay');
            return googlePayHook.Authorize(orderNumber, paymentInstrument, paymentProcessor);
        }

        var jpmcTransactionHelpers = require('*/cartridge/scripts/helpers/jpmcTransactionHelpers');
        var authResult = jpmcTransactionHelpers.authorize(orderNumber, paymentInstrument, paymentProcessor);

        if (authResult.error) {
            return { fieldErrors: fieldErrors, serverErrors: authResult.serverErrors || [], error: true };
        }

        return { fieldErrors: fieldErrors, serverErrors: serverErrors, error: false };
    } catch (e) {
        var errorMsg = e instanceof Error ? e.message : String(e);
        Logger.error('Authorize failed: {0}', errorMsg);
        serverErrors.push(Resource.msg('error.technical', 'checkout', null));
        return { fieldErrors: fieldErrors, serverErrors: serverErrors, error: true };
    }
}

/**
 * Creates a SAFETECH token for My Account Save Payment flow.
 * Reads PIE encrypted data from session form, performs optional fraud check, calls JPMC verification.
 * @returns {String}
 * @throws {Error}
 */
function createToken() {
    var JPMCPaymentHelper = require('*/cartridge/scripts/helpers/JPMCPaymentHelper');
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');

    var creditCardForm = session.forms.creditCard;
    var encryptedDataValue = creditCardForm.encryptedData.value;

    if (!encryptedDataValue) {
        Logger.error('createToken: Encrypted data missing from form');
        throw new Error('Payment data is missing');
    }

    var encrypted;
    try {
        encrypted = JSON.parse(encryptedDataValue);
    } catch (e) {
        Logger.error('createToken: Failed to parse encrypted data - {0}', e instanceof Error ? e.message : String(e));
        throw new Error('Payment data is invalid');
    }

    if (!encrypted.accountNumber || !encrypted.cvv) {
        Logger.error('createToken: Invalid encrypted data structure - accountNumber and cvv required');
        throw new Error('Payment data is incomplete');
    }

    var cardData = {
        accountNumber: encrypted.accountNumber,
        cvv: encrypted.cvv,
        expirationMonth: creditCardForm.expirationMonth.value,
        expirationYear: creditCardForm.expirationYear.value
    };

    if (encrypted.encryptionIntegrityCheck) {
        cardData.encryptionIntegrityCheck = encrypted.encryptionIntegrityCheck;
    }
    if (JPMCConfig.isFraudCheckEnabled()) {
        var fraudCheckOptions = {
            accountNumberType: jpmcConstants.ACCOUNT_NUMBER_TYPE_PIE,
            kountSessionId: creditCardForm.kountSessionId ? creditCardForm.kountSessionId.value : null
        };
        var fraudResult = JPMCPaymentHelper.performFraudCheckForCardSave(cardData, fraudCheckOptions);

        if (fraudResult.success && fraudResult.riskDecision) {
            var fraudRuleAction = fraudResult.riskDecision.fraudRuleAction;

            if (fraudRuleAction === 'D') {
                throw new Error('Card could not be saved due to security reasons. Please contact customer service.');
            }
        } else if (!fraudResult.success) {
            Logger.warn('createToken: Fraud check service error (fail-open) - continuing with card save');
        }
    }
    var verificationOptions = {
        accountNumberType: jpmcConstants.ACCOUNT_NUMBER_TYPE_PIE
    };

    var verifyResult = JPMCPaymentHelper.verifyPaymentInstrument(cardData, verificationOptions);

    if (!verifyResult.success) {
        Logger.error('createToken: JPMC verification failed - {0}', verifyResult.error);
        throw new Error('Payment verification failed');
    }
    var safetechToken = extractSafetechToken(verifyResult.data);
    if (safetechToken) {
        return safetechToken;
    }

    Logger.error('createToken: No SAFETECH token in verification response');
    throw new Error('Payment verification failed');
}

exports.processForm = processForm;
exports.Handle = Handle;
exports.Authorize = Authorize;
exports.savePaymentInformation = savePaymentInformation;
exports.createToken = createToken;
exports.clearSensitivePaymentData = clearSensitivePaymentData;
