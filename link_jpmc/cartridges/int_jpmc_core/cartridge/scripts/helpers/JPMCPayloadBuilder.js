/**
 * JPMC Payload Builder
 * Generates request payloads for JPMC API calls (capture, refund, etc.)
 * 
 * @module scripts/helpers/JPMCPayloadBuilder
 */

'use strict';

var Logger = require('dw/system/Logger').getLogger('JPMC', 'payload');

/**
 * Converts dollar amount to cents (integer format required by JPMC API)
 * 
 * @param {Number} dollarAmount
 * @returns {Number}
 * @private
 */
function convertToCents(dollarAmount) {
    return Math.round(dollarAmount * 100);
}

/**
 * Builds merchant object with software details from configuration.
 * @returns {Object}
 * @private
 */
function buildMerchantObject() {
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var config = JPMCConfig.getConfig();
    return {
        merchantSoftware: buildMerchantSoftwareDefaults(config)
    };
}

/**
 * Builds merchant software object from JPMCConfig site preferences.
 * @param {Object} config
 * @returns {Object}
 * @private
 */
function buildMerchantSoftwareDefaults(config) {

    return {
        companyName: config.merchantSoftware.companyName,
        productName: config.merchantSoftware.productName,
        version: config.merchantSoftware.version
    };
}

/**
 * Formats phone number for JPMC API (digits only, max 12 chars)
 * 
 * @param {String} phone
 * @returns {Object}
 * @private
 */
function formatPhoneNumber(phone) {
    if (!phone) {
        return null;
    }

    var phoneObj = {
        phoneNumber: phone.replace(/[^0-9]/g, '').substring(0, 12)
    };

    if (phone.trim().startsWith('+1') || phone.trim().startsWith('1')) {
        phoneObj.countryCode = 1;
    }

    return phoneObj;
}

/**
 * Converts ISO 3166 Alpha-2 country code to Alpha-3
 * JPMC API requires Alpha-3 country codes; SFCC stores Alpha-2
 *
 * @param {String} alpha2
 * @returns {String}
 * @private
 */
function toAlpha3CountryCode(alpha2) {
    var map = {
        US: 'USA', CA: 'CAN', GB: 'GBR', MX: 'MEX', AU: 'AUS',
        DE: 'DEU', FR: 'FRA', IT: 'ITA', ES: 'ESP', NL: 'NLD',
        BR: 'BRA', JP: 'JPN', CN: 'CHN', IN: 'IND', KR: 'KOR',
        SG: 'SGP', HK: 'HKG', NZ: 'NZL', IE: 'IRL', CH: 'CHE',
        SE: 'SWE', NO: 'NOR', DK: 'DNK', FI: 'FIN', AT: 'AUT',
        BE: 'BEL', PT: 'PRT', PL: 'POL', CZ: 'CZE', ZA: 'ZAF',
        AE: 'ARE', SA: 'SAU', IL: 'ISR', TW: 'TWN', PH: 'PHL',
        TH: 'THA', MY: 'MYS', ID: 'IDN', VN: 'VNM', CL: 'CHL',
        CO: 'COL', AR: 'ARG', PE: 'PER', RO: 'ROU', HU: 'HUN',
        GR: 'GRC', RU: 'RUS', TR: 'TUR', UA: 'UKR', EG: 'EGY'
    };
    var code = alpha2 ? alpha2.toUpperCase() : '';
    var mapped = map[code];
    if (code && !mapped) {
        Logger.warn('toAlpha3CountryCode: No ISO-3166 alpha-3 mapping for country code "{0}". Falling back to alpha-2. Add this country to the mapping table.', code);
    }
    return mapped || code;
}

/**
 * Builds fraudCheckShoppingCart string from basket or order line items.
 * Format: T=type&I=itemId&D=description&Q=quantity&P=price&| (max 999 chars)
 * @param {dw.order.Basket|dw.order.Order} basketOrOrder
 * @returns {String}
 * @private
 */
function buildFraudCheckShoppingCart(basketOrOrder) {
    try {
        var items = [];
        var productLineItems = basketOrOrder.getAllProductLineItems();
        var iterator = productLineItems.iterator();
        
        while (iterator.hasNext()) {
            var pli = iterator.next();
            var product = pli.getProduct();
            
            if (!product) {
                continue;
            }
            
            var productType = product.getClassificationCategory() 
                ? product.getClassificationCategory().getDisplayName() 
                : 'Product';
            var itemId = pli.getProductID() || pli.getProductName();
            var description = pli.getProductName() || product.getName() || 'Item';
            var quantity = pli.getQuantityValue();
            var priceValue = pli.getAdjustedPrice().getValue();
            var priceCents = Math.round(priceValue * 100);
            
            var encodedType = encodeURIComponent(productType);
            var encodedItemId = encodeURIComponent(itemId);
            var encodedDescription = encodeURIComponent(description);
            
            var itemString = 'T=' + encodedType + 
                           '&I=' + encodedItemId + 
                           '&D=' + encodedDescription + 
                           '&Q=' + quantity + 
                           '&P=' + priceCents + '&|';
            
            items.push(itemString);
        }
        
        var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');
        var CART_MAX = jpmcConstants.FRAUD_CART_MAX_LENGTH;
        var shoppingCartString = items.join('');
        
        if (shoppingCartString.length > CART_MAX) {
            Logger.warn('Shopping cart string exceeds {0} characters ({1}), truncating', CART_MAX, shoppingCartString.length);
            shoppingCartString = shoppingCartString.substring(0, CART_MAX);
        }
        
        return shoppingCartString;
    } catch (e) {
        Logger.warn('Error building shopping cart string: {0}', e instanceof Error ? e.message : String(e));
        return '';
    }
}

/**
 * Builds capture request payload per JPMC API specification
 * 
 * @param {Object} params
 * @param {dw.order.Order} params.order
 * @param {Number} params.amount
 * @param {Boolean} [params.isFinal=true]
 * @param {Object} [params.multiCapture]
 * @param {Number} [params.multiCapture.sequenceNumber]
 * @param {Number} [params.multiCapture.recordCount]
 * @param {Boolean} [params.multiCapture.isFinal]
 * @returns {Object}
 */
function buildCapturePayload(params) {
    if (!params || !params.order || params.amount === undefined) {
        throw new Error('Order and amount are required for capture payload');
    }

    var payload = {
        amount: convertToCents(params.amount),
        currency: params.order.getCurrencyCode()
    };

    // JPMC constraint: multiCaptureRecordCount >= multiCaptureSequenceNumber.
    // Because the total number of captures is unknown upfront, we set recordCount
    // to sequenceNumber when this is the final capture, or to 99 otherwise
    // (the maximum allowed placeholder). The isFinalCapture flag is the real signal.
    if (params.multiCapture) {
        var seqNum = params.multiCapture.sequenceNumber || 1;
        var isFinal = params.multiCapture.isFinal || false;
        var jpmcConst = require('*/cartridge/scripts/helpers/jpmcConstants');
        payload.multiCapture = {
            multiCaptureSequenceNumber: String(seqNum),
            multiCaptureRecordCount: isFinal ? seqNum : jpmcConst.MULTI_CAPTURE_MAX_RECORD_COUNT,
            isFinalCapture: isFinal
        };
    } else {
        payload.isAmountFinal = (params.isFinal !== undefined) ? params.isFinal : true;
    }

    return payload;
}

/**
 * Builds refund request payload per JPMC API specification
 * 
 * FULL REFUND: Only transactionReferenceId is required
 * PARTIAL REFUND: Requires amount, currency, and transactionReferenceId
 * 
 * @param {Object} params
 * @param {String} params.transactionReferenceId
 * @param {Number} [params.amount]
 * @param {String} [params.currency]
 * @param {String} [params.reason]
 * @param {dw.order.PaymentInstrument} [params.paymentInstrument]
 * @returns {Object}
 */
function buildRefundPayload(params) {
    if (!params || !params.transactionReferenceId) {
        throw new Error('Transaction reference ID is required for refund payload');
    }

    var payload = {
        paymentMethodType: {
            transactionReference: {
                transactionReferenceId: params.transactionReferenceId
            }
        },
        merchant: buildMerchantObject()
    };

    if (params.paymentInstrument) {
        var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
        var merchantPreferredRouting = JPMCConfig.getMerchantPreferredRouting();
        
        if (merchantPreferredRouting) {
            if (!payload.paymentMethodType.card) {
                payload.paymentMethodType.card = {};
            }
            payload.paymentMethodType.card.merchantPreferredRouting = merchantPreferredRouting;
            if (merchantPreferredRouting === 'PINLESS') {
                var preferredNetworkList = JPMCConfig.getPreferredPaymentNetworkNameList();
                if (preferredNetworkList && preferredNetworkList.length > 0) {
                    payload.paymentMethodType.card.preferredPaymentNetworkNameList = preferredNetworkList;
                }
            }
        }
    }

    if (params.amount !== undefined && params.amount !== null && params.currency) {
        payload.amount = convertToCents(params.amount);
        payload.currency = params.currency;
    }

    return payload;
}

/**
 * Builds fraud check request payload per JPMC API specification
 * 
 * @param {Object} params
 * @param {dw.order.Basket|dw.order.Order} params.basketOrOrder
 * @param {dw.order.PaymentInstrument} params.paymentInstrument
 * @param {String} [params.deviceIPAddress]
 * @param {Object} [params.fraudScore]
 * @param {String} [params.fraudScore.cardholderBrowserInformation]
 * @param {Boolean} [params.fraudScore.isFraudRuleReturn]
 * @param {String} [params.fraudScore.fraudCheckShoppingCart]
 * @param {String} [params.fraudScore.sessionId]
 * @param {String} [params.fraudScore.websiteRootDomainName]
 * @param {Number} [params.fraudScore.fencibleItemAmount]
 * @param {String} [params.fraudScore.aNITelephoneNumber]
 * @param {String} [params.accountNumberType]
 * @returns {Object}
 */
function buildFraudCheckPayload(params) {
    if (!params || !params.basketOrOrder) {
        throw new Error('Basket or order is required for fraud check payload');
    }

    if (!params.paymentInstrument) {
        throw new Error('Payment instrument is required for fraud check payload');
    }

    var basketOrOrder = params.basketOrOrder;
    var pi = params.paymentInstrument;
    
    var payload = {
        amount: convertToCents(basketOrOrder.getTotalGrossPrice().value),
        currency: basketOrOrder.getCurrencyCode(),
        accountHolder: buildAccountHolderObject(basketOrOrder, params.deviceIPAddress, 'deviceIPAddress'),
        paymentMethodType: buildPaymentMethodTypeObject(pi, params),
        merchant: buildMerchantObject()
    };

    if (params.fraudScore) {
        payload.fraudScore = {};

        if (params.fraudScore.cardholderBrowserInformation) {
            payload.fraudScore.cardholderBrowserInformation = params.fraudScore.cardholderBrowserInformation;
        }
        
        if (params.fraudScore.isFraudRuleReturn !== undefined) {
            payload.fraudScore.isFraudRuleReturn = params.fraudScore.isFraudRuleReturn;
        }
        
        if (params.fraudScore.fraudCheckShoppingCart) {
            payload.fraudScore.fraudCheckShoppingCart = params.fraudScore.fraudCheckShoppingCart;
        } else {
            var autoShoppingCart = buildFraudCheckShoppingCart(basketOrOrder);
            if (autoShoppingCart) {
                payload.fraudScore.fraudCheckShoppingCart = autoShoppingCart;
            }
        }

        if (params.fraudScore.sessionId) {
            payload.fraudScore.sessionId = params.fraudScore.sessionId;
        }
        
        if (params.fraudScore.fencibleItemAmount !== undefined) {
            payload.fraudScore.fencibleItemAmount = convertToCents(params.fraudScore.fencibleItemAmount);
        }
        
        if (params.fraudScore.aNITelephoneNumber) {
            payload.fraudScore.aNITelephoneNumber = params.fraudScore.aNITelephoneNumber;
        }
    } else {
        payload.fraudScore = {};
        var autoShoppingCart = buildFraudCheckShoppingCart(basketOrOrder);
        if (autoShoppingCart) {
            payload.fraudScore.fraudCheckShoppingCart = autoShoppingCart;
        }
    }

    var defaultShipment = basketOrOrder.getDefaultShipment();
    if (defaultShipment && defaultShipment.getShippingAddress()) {
        payload.shipTo = buildShipToObject(defaultShipment);
    }

    return payload;
}

/**
 * Builds fraud check payload for card save in My Account (minimal payload)
 * Used when customer saves a payment card to their wallet without an active basket/order
 * 
 * @param {Object} params
 * @param {Object} params.cardData
 * @param {String} params.cardData.accountNumber
 * @param {Number} params.cardData.expirationMonth
 * @param {Number} params.cardData.expirationYear
 * @param {String} [params.currency]
 * @param {String} [params.accountNumberType='SAFETECH_TOKEN']
 * @param {String} [params.deviceIPAddress]
 * @param {String} [params.customerEmail]
 * @param {String} [params.browserInformation]
 * @param {String} [params.kountSessionId]
 * @returns {Object}
 */
function buildFraudCheckForCardSavePayload(params) {
    if (!params || !params.cardData || !params.cardData.accountNumber) {
        throw new Error('Card data with account number is required for fraud check payload');
    }

    var jpmcConstants = require('*/cartridge/scripts/helpers/jpmcConstants');
    var card = params.cardData;
    var Site = require('dw/system/Site');
    var currency = params.currency || Site.getCurrent().getDefaultCurrency();
    var payload = {
        amount: 0, // No transaction amount for card save
        currency: currency,
        accountHolder: {
            deviceIPAddress: params.deviceIPAddress || jpmcConstants.FALLBACK_IP_ADDRESS
        },
        paymentMethodType: {
            card: {
                accountNumber: card.accountNumber,
                accountNumberType: params.accountNumberType,
                expiry: {
                    month: card.expirationMonth,
                    year: card.expirationYear
                },
                cvv: card.cvv
            }
        },
        merchant: buildMerchantObject(),
        fraudScore: {
            cardholderBrowserInformation: params.browserInformation || jpmcConstants.FALLBACK_USER_AGENT,
            isFraudRuleReturn: true
        }
    };
    if (params.customerEmail) {
        payload.accountHolder.email = params.customerEmail;
    }
    if (card.encryptionIntegrityCheck) {
        payload.paymentMethodType.card.encryptionIntegrityCheck = card.encryptionIntegrityCheck;
    }
    if (params.kountSessionId) {
        payload.fraudScore.sessionId = params.kountSessionId;
    }
    
    return payload;
}

/**
 * Builds accountHolder object for fraud check and payment authorization
 * 
 * @param {dw.order.Basket|dw.order.Order} basketOrOrder
 * @param {String} [ipAddress]
 * @param {String} [ipAddressFieldName='deviceIPAddress'] - Field name to use in accountHolder object:
 *                                                            - 'deviceIPAddress' → Fraud check context (billing address always included)
 *                                                            - 'IPAddress' → Verify/Auth context (billing address controlled by AVS flag)
 * @returns {Object}
 * @private
 */
function buildAccountHolderObject(basketOrOrder, ipAddress, ipAddressFieldName) {
    var accountHolder = {};
    var billingAddress = basketOrOrder.getBillingAddress();
    var customerEmail = basketOrOrder.getCustomerEmail();
    if (customerEmail) {
        accountHolder.email = customerEmail;
    }

    var shouldIncludeBillingAddress;
    if (ipAddressFieldName === 'deviceIPAddress') {
        // Fraud check context: billing address always required for fraud detection
        shouldIncludeBillingAddress = true;
    } else {
        // Verify/Auth context: include billing address only when AVS is enabled
        var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
        shouldIncludeBillingAddress = JPMCConfig.isAVSEnabled();
    }

    if (billingAddress) {
        var firstName = billingAddress.getFirstName() || '';
        var lastName = billingAddress.getLastName() || '';
        if (firstName || lastName) {
            accountHolder.fullName = (firstName + ' ' + lastName).trim();
        }

        if (shouldIncludeBillingAddress) {
            accountHolder.billingAddress = buildAddressObject(billingAddress);
        }

        var phone = billingAddress.getPhone();
        if (phone) {
            accountHolder.phone = formatPhoneNumber(phone);
        }
    }

    if (ipAddress) {
        var fieldName = ipAddressFieldName || 'deviceIPAddress';
        accountHolder[fieldName] = ipAddress;
    }

    return accountHolder;
}

/**
 * Builds address object for fraud check
 * 
 * @param {dw.order.OrderAddress} address
 * @returns {Object}
 * @private
 */
function buildAddressObject(address) {
    var addressObj = {};

    if (address.getAddress1()) {
        addressObj.line1 = address.getAddress1().substring(0, 40);
    }

    if (address.getAddress2()) {
        addressObj.line2 = address.getAddress2().substring(0, 40);
    }

    if (address.getCity()) {
        addressObj.city = address.getCity().substring(0, 40);
    }

    if (address.getStateCode()) {
        addressObj.state = address.getStateCode().substring(0, 3);
    }

    if (address.getPostalCode()) {
        addressObj.postalCode = address.getPostalCode().substring(0, 12);
    }
    if (address.getCountryCode()) {
        addressObj.countryCode = toAlpha3CountryCode(address.getCountryCode().getValue());
    }

    return addressObj;
}

/**
 * Builds paymentMethodType object for fraud check
 * 
 * @param {dw.order.PaymentInstrument} paymentInstrument
 * @param {Object} options
 * @param {String} options.accountNumberType
 * @param {String} [options.cvv]
 * @param {String} [options.encryptedCvv]
 * @param {String} [options.encryptionIntegrityCheck]
 * @returns {Object}
 * @private
 */
function buildPaymentMethodTypeObject(paymentInstrument, options) {
    var jpmcConst = require('*/cartridge/scripts/helpers/jpmcConstants');
    var paymentMethodType = {};
    var opts = options || {};
    var accountNumberType = opts.accountNumberType || jpmcConst.ACCOUNT_NUMBER_TYPE_PIE;
    var accountNumber;
    var creditCardToken = paymentInstrument.getCreditCardToken();
    
    if (accountNumberType === 'SAFETECH_PAGE_ENCRYPTION') {
        accountNumber = paymentInstrument.getCreditCardNumber();
    } else {
        accountNumber = creditCardToken || paymentInstrument.getCreditCardNumber();
    }
    if (accountNumber) {
        paymentMethodType.card = {
            accountNumber: accountNumber,
            accountNumberType: accountNumberType
        };
        if (paymentInstrument.getCreditCardExpirationMonth() && paymentInstrument.getCreditCardExpirationYear()) {
            paymentMethodType.card.expiry = {
                month: paymentInstrument.getCreditCardExpirationMonth(),
                year: paymentInstrument.getCreditCardExpirationYear()
            };
        }

        // CVV and encrypted card data are stored in session.privacy (memory-only, never persisted to DB).
        // Fallback to paymentInstrument.custom is retained for test/headless flows only.
        if (accountNumberType === 'SAFETECH_PAGE_ENCRYPTION') {
            var sessionCvv = session.privacy.jpmcCvv || null;
            var sessionEncryptedCvv = session.privacy.jpmcEncryptedCvv || null;
            var sessionEncryptedData = session.privacy.jpmcEncryptedData || null;

            if (sessionCvv) {
                paymentMethodType.card.cvv = sessionCvv;
            } else if (sessionEncryptedCvv) {
                paymentMethodType.card.cvv = sessionEncryptedCvv;
            }

            var encryptedDataStr = sessionEncryptedData ? String(sessionEncryptedData) : null;
            if (encryptedDataStr) {
                try {
                    var encryptedData = JSON.parse(encryptedDataStr);
                    if (encryptedData.encryptionIntegrityCheck) {
                        paymentMethodType.card.encryptionIntegrityCheck = encryptedData.encryptionIntegrityCheck;
                    }
                } catch (e) {
                    var Logger = require('dw/system/Logger');
                    Logger.warn('buildPaymentMethodTypeObject: Failed to parse encrypted data for integrity check: {0}', e.message);
                }
            }
        }
    }

    return paymentMethodType;
}

/**
 * Builds shipTo object for fraud check
 * 
 * @param {dw.order.Shipment} shipment
 * @returns {Object}
 * @private
 */
function buildShipToObject(shipment) {
    var shipTo = {};
    var shippingAddress = shipment.getShippingAddress();

    if (shippingAddress) {
        shipTo.shippingAddress = buildAddressObject(shippingAddress);
        var firstName = shippingAddress.getFirstName() || '';
        var lastName = shippingAddress.getLastName() || '';
        if (firstName || lastName) {
            shipTo.fullName = (firstName + ' ' + lastName).trim();
        }
        if (firstName) {
            shipTo.firstName = firstName.substring(0, 70);
        }
        if (lastName) {
            shipTo.lastName = lastName.substring(0, 70);
        }
        var phone = shippingAddress.getPhone();
        if (phone) {
            shipTo.phone = formatPhoneNumber(phone);
        }
    }
    var shippingMethod = shipment.getShippingMethod();
    if (shippingMethod && shippingMethod.getDisplayName()) {
        shipTo.shippingDescription = shippingMethod.getDisplayName().substring(0, 120);
    }

    return shipTo;
}

/**
 * Builds verification request payload per JPMC API specification
 * Validates card details without placing a funds hold
 * 
 * @param {Object} params
 * @param {Object} params.cardData
 * @param {String} params.cardData.accountNumber
 * @param {String} [params.cardData.cvv]
 * @param {Number} params.cardData.expirationMonth
 * @param {Number} params.cardData.expirationYear
 * @param {String} [params.cardData.encryptionIntegrityCheck]
 * @param {String} params.currency
 * @param {String} [params.accountNumberType='SAFETECH_PAGE_ENCRYPTION']
 * @param {Object} [params.billingAddress]
 * @param {Object} [params.authentication]
 * @param {String} [params.walletProvider]
 * @param {String} [params.email]
 * @returns {Object}
 */
function buildVerificationPayload(params) {
    if (!params || !params.cardData || !params.currency) {
        throw new Error('Missing required parameters: cardData, currency');
    }

    var card = params.cardData;
    var jpmcConst = require('*/cartridge/scripts/helpers/jpmcConstants');
    var cardPayload = {
        accountNumberType: params.accountNumberType || jpmcConst.ACCOUNT_NUMBER_TYPE_PIE,
        accountNumber: card.accountNumber,
        expiry: {
            month: parseInt(String(card.expirationMonth), 10),
            year: parseInt(String(card.expirationYear), 10)
        }
    };
    if (card.cvv) {
        cardPayload.cvv = card.cvv;
    }

    var payload = {
        merchant: buildMerchantObject(),
        currency: params.currency,
        initiatorType: params.initiatorType,
        paymentMethodType: {
            card: cardPayload
        }
    };
    if (params.accountOnFile) {
        payload.accountOnFile = params.accountOnFile;
    }
    if (card.encryptionIntegrityCheck) {
        payload.paymentMethodType.card.encryptionIntegrityCheck = card.encryptionIntegrityCheck;
    }
    if (params.walletProvider) {
        payload.paymentMethodType.card.walletProvider = params.walletProvider;
    }
    if (params.authentication) {
        payload.paymentMethodType.card.authentication = buildVerificationAuthenticationObject(params.authentication);
    }
    if (params.billingAddress) {
        payload.accountHolder = buildVerificationAccountHolderObject(params.billingAddress, params);
    }

    return payload;
}

/**
 * Builds authentication object for verification
 * @param {Object} auth
 * @returns {Object}
 * @private
 */
function buildVerificationAuthenticationObject(auth) {
    var authObj = {};

    if (auth.authenticationId) {
        authObj.authenticationId = auth.authenticationId;
    }
    if (auth.threeDS) {
        authObj.threeDS = {};
        
        if (auth.threeDS.authenticationValue) {
            authObj.threeDS.authenticationValue = auth.threeDS.authenticationValue;
        }

        if (auth.threeDS.authenticationTransactionId) {
            authObj.threeDS.authenticationTransactionId = auth.threeDS.authenticationTransactionId;
        }

        if (auth.threeDS.threeDSProgramProtocol) {
            authObj.threeDS.threeDSProgramProtocol = auth.threeDS.threeDSProgramProtocol;
        }

        if (auth.threeDS.version1) {
            authObj.threeDS.version1 = {
                threeDSVEResEnrolled: auth.threeDS.version1.threeDSVEResEnrolled,
                threeDSPAResStatus: auth.threeDS.version1.threeDSPAResStatus
            };
        }

        if (auth.threeDS.version2) {
            authObj.threeDS.version2 = {
                threeDSTransactionStatus: auth.threeDS.version2.threeDSTransactionStatus
            };
            
            if (auth.threeDS.version2.threeDSTransactionStatusReasonCode) {
                authObj.threeDS.version2.threeDSTransactionStatusReasonCode = 
                    auth.threeDS.version2.threeDSTransactionStatusReasonCode;
            }
            
            if (auth.threeDS.version2.threeDSChallengeType) {
                authObj.threeDS.version2.threeDSChallengeType = auth.threeDS.version2.threeDSChallengeType;
            }
        }

        if (auth.threeDS.electronicCommerceIndicator) {
            authObj.threeDS.electronicCommerceIndicator = auth.threeDS.electronicCommerceIndicator;
        }

        if (auth.threeDS.tokenAuthenticationValue) {
            authObj.threeDS.tokenAuthenticationValue = auth.threeDS.tokenAuthenticationValue;
        }

        if (auth.threeDS.SCAExemptionReason) {
            authObj.threeDS.SCAExemptionReason = auth.threeDS.SCAExemptionReason;
        }
    }

    return authObj;
}

/**
 * Builds account holder object for verification
 * @param {dw.order.OrderAddress} billingAddress
 * @param {Object} params
 * @returns {Object}
 * @private
 */
function buildVerificationAccountHolderObject(billingAddress, params) {
    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var accountHolder = {};
    if (billingAddress.getFirstName() || billingAddress.getLastName()) {
        accountHolder.fullName = (billingAddress.getFirstName() + ' ' + billingAddress.getLastName()).trim();
    }
    if (params.email) {
        accountHolder.email = params.email;
    }
    if (JPMCConfig.isAVSEnabled()) {
        accountHolder.billingAddress = buildAddressObject(billingAddress);
    }
    var phone = billingAddress.getPhone();
    if (phone) {
        accountHolder.phone = formatPhoneNumber(phone);
    }

    return accountHolder;
}

/**
 * Builds create payment request payload per JPMC API specification
 * Supports Authorization (MANUAL), Sale (NOW), and Delayed Capture (DELAYED)
 * 
 * @param {Object} params
 * @param {dw.order.Basket|dw.order.Order} params.order
 * @param {dw.order.PaymentInstrument} params.paymentInstrument
 * @param {String} [params.captureMethod='NOW']
 * @param {Object} [params.authentication]
 * @param {String} [params.walletProvider]
 * @param {String} [params.accountNumberType='PAN']
 * @param {String} [params.initiatorType='CARDHOLDER']
 * @param {String} [params.accountOnFile='NOT_STORED']
 * @param {String} [params.deviceIPAddress]
 * @param {Object} [params.recurring]
 * @param {Boolean} [params.isAmountFinal=true]
 * @param {String} [params.merchantCategoryCode]
 * @param {Boolean} [params.requestFraudScore=false]
 * @param {Number} [params.transactionRiskScore]
 * @returns {Object}
 */
function buildCreatePaymentPayload(params) {
    if (!params || !params.order || !params.paymentInstrument) {
        throw new Error('Order, payment instrument, and merchant ID are required for create payment payload');
    }

    var basket = params.order;
    var paymentInstrument = params.paymentInstrument;
    var totalAmount = basket.getTotalGrossPrice();
    
    var payload = {
        captureMethod: params.captureMethod || 'NOW', // NOW (sale), DELAYED, MANUAL (auth only)
        amount: convertToCents(totalAmount.getValue()),
        currency: basket.getCurrencyCode(),
        isAmountFinal: (params.isAmountFinal !== undefined) ? params.isAmountFinal : true,
        initiatorType: params.initiatorType || 'CARDHOLDER',
        accountOnFile: params.accountOnFile || 'NOT_STORED',
        merchantOrderNumber: basket.getOrderNo ? basket.getOrderNo() : ('BASKET-' + basket.getUUID()),
        merchant: buildMerchantObject()
    };
    payload.accountHolder = buildAccountHolderObject(basket, params.IPAddress, 'IPAddress');
    if (params.merchantCategoryCode) {
        payload.merchantCategoryCode = params.merchantCategoryCode;
    }

    payload.paymentMethodType = buildCreatePaymentMethodTypeObject(paymentInstrument, {
        accountNumberType: params.accountNumberType,
        walletProvider: params.walletProvider,
        authentication: params.authentication
    });
    if (params.recurring) {
        payload.recurring = {
            recurringSequence: params.recurring.sequence || 'FIRST',
            isVariableAmount: params.recurring.isVariableAmount || false
        };
        
        if (params.recurring.agreementId) {
            payload.recurring.agreementId = params.recurring.agreementId;
        }
        
        if (params.recurring.expiryDate) {
            payload.recurring.paymentAgreementExpiryDate = params.recurring.expiryDate;
        }
        
        if (params.recurring.recurringNumber) {
            payload.recurring.recurringNumber = params.recurring.recurringNumber;
        }
    }
    if (params.requestFraudScore) {
        payload.risk = {
            requestFraudScore: true
        };
        
        if (params.transactionRiskScore) {
            payload.risk.transactionRiskScore = params.transactionRiskScore;
        }
    }

    return payload;
}

/**
 * Builds payment method type object for create payment
 * 
 * @param {dw.order.PaymentInstrument} paymentInstrument
 * @param {Object} options
 * @returns {Object}
 * @private
 */
function buildCreatePaymentMethodTypeObject(paymentInstrument, options) {
    var paymentMethodType = buildPaymentMethodTypeObject(paymentInstrument, options);

    if (paymentMethodType.card) {
        if (options.walletProvider) {
            paymentMethodType.card.walletProvider = options.walletProvider;
        }

        if (options.authentication) {
            paymentMethodType.card.authentication = options.authentication;
        }
        if (!options.walletProvider) {
            var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
            var merchantPreferredRouting = JPMCConfig.getMerchantPreferredRouting();
            
            if (merchantPreferredRouting) {
                paymentMethodType.card.merchantPreferredRouting = merchantPreferredRouting;
                if (merchantPreferredRouting === 'PINLESS') {
                    var preferredNetworkList = JPMCConfig.getPreferredPaymentNetworkNameList();
                    if (preferredNetworkList && preferredNetworkList.length > 0) {
                        paymentMethodType.card.preferredPaymentNetworkNameList = preferredNetworkList;
                    }
                }
            }
        }
    }

    return paymentMethodType;
}

/**
 * Builds the void authorization payload for JPMC PATCH /payments/{id}
 * @returns {Object}
 */
function buildVoidPayload() {
    return {
        isVoid: true
    };
}

/**
 * Builds Apple Pay payment request payload per JPMC Online Payments API specification
 * Maps Apple Pay encrypted payment token to JPMC's paymentMethodType.applepay structure
 * 
 * @param {Object} params
 * @param {dw.order.Order} params.order
 * @param {Object} params.encryptedPaymentBundle
 * @param {String} params.encryptedPaymentBundle.encryptedPayload
 * @param {String} params.encryptedPaymentBundle.signature
 * @param {String} params.encryptedPaymentBundle.protocolVersion
 * @param {Object} params.encryptedPaymentBundle.encryptedPaymentHeader
 * @param {String} params.encryptedPaymentBundle.encryptedPaymentHeader.ephemeralPublicKey
 * @param {String} params.encryptedPaymentBundle.encryptedPaymentHeader.publicKeyHash
 * @param {String} params.encryptedPaymentBundle.encryptedPaymentHeader.walletTransactionId
 * @param {String} [params.encryptedPaymentBundle.encryptedPaymentHeader.walletApplicationData]
 * @param {String} [params.captureMethod]
 * @param {String} [params.latLong]
 * @param {Boolean} [params.isAmountFinal]
 * @returns {Object}
 */
function buildApplePayPaymentPayload(params) {
    if (!params || !params.order) {
        throw new Error('Order is required for Apple Pay payment payload');
    }
    
    if (!params.encryptedPaymentBundle) {
        throw new Error('Encrypted payment bundle is required for Apple Pay payment payload');
    }
    
    var bundle = params.encryptedPaymentBundle;
    
    if (!bundle.encryptedPayload) {
        throw new Error('encryptedPayload is required in payment bundle');
    }
    if (!bundle.signature) {
        throw new Error('signature is required in payment bundle');
    }
    if (!bundle.encryptedPaymentHeader || !bundle.encryptedPaymentHeader.ephemeralPublicKey) {
        throw new Error('encryptedPaymentHeader.ephemeralPublicKey is required in payment bundle');
    }
    if (!bundle.encryptedPaymentHeader.publicKeyHash) {
        throw new Error('encryptedPaymentHeader.publicKeyHash is required in payment bundle');
    }
    if (!bundle.encryptedPaymentHeader.walletTransactionId) {
        throw new Error('encryptedPaymentHeader.walletTransactionId is required in payment bundle');
    }

    var JPMCConfig = require('*/cartridge/scripts/helpers/JPMCConfig');
    var order = params.order;
    var totalAmount = order.getTotalGrossPrice();
    var captureMethod = params.captureMethod || JPMCConfig.getCaptureMethod();
    var payload = {
        captureMethod: captureMethod,
        amount: convertToCents(totalAmount.getValue()),
        currency: order.getCurrencyCode(),
        isAmountFinal: params.isAmountFinal !== undefined ? params.isAmountFinal : true,
        initiatorType: 'CARDHOLDER',
        accountOnFile: 'NOT_STORED',
        merchantOrderNumber: order.getOrderNo(),
        merchant: buildMerchantObject()
    };
    payload.paymentMethodType = {
        applepay: {
            encryptedPaymentBundle: {
                encryptedPayload: bundle.encryptedPayload,
                signature: bundle.signature,
                protocolVersion: bundle.protocolVersion || 'EC_v1',
                encryptedPaymentHeader: {
                    ephemeralPublicKey: bundle.encryptedPaymentHeader.ephemeralPublicKey,
                    publicKeyHash: bundle.encryptedPaymentHeader.publicKeyHash,
                    walletTransactionId: bundle.encryptedPaymentHeader.walletTransactionId
                }
            }
        }
    };

    if (params.latLong) {
        payload.paymentMethodType.applepay.latLong = params.latLong;
    }
    
    if (bundle.encryptedPaymentHeader.walletApplicationData) {
        payload.paymentMethodType.applepay.encryptedPaymentBundle.encryptedPaymentHeader.walletApplicationData = 
            bundle.encryptedPaymentHeader.walletApplicationData;
    }
    
    return payload;
}

/**
 * Builds Google Pay payment request payload for JPMC API
 * @param {Object} params
 * @param {dw.order.Basket|dw.order.Order} params.order
 * @param {dw.order.PaymentInstrument} params.paymentInstrument
 * @param {Object} params.googlePayToken
 * @param {string} [params.captureMethod='NOW']
 * @param {string} [params.initiatorType='CARDHOLDER']
 * @param {string} [params.accountOnFile='NOT_STORED']
 * @param {boolean} [params.isAmountFinal=true]
 * @returns {Object}
 */
function buildGooglePayPaymentPayload(params) {
    if (!params || !params.order || !params.paymentInstrument) {
        throw new Error('Order and payment instrument are required for Google Pay payment payload');
    }

    if (!params.googlePayToken) {
        throw new Error('Google Pay token data is required');
    }

    var basket = params.order;
    var totalAmount = basket.getTotalGrossPrice();
    var gpToken = params.googlePayToken;

    var encryptedPaymentBundle = {
        encryptedPayload: gpToken.signedMessage,
        protocolVersion: gpToken.protocolVersion
    };

    if (gpToken.intermediateSigningKey
        && gpToken.intermediateSigningKey.signatures
        && gpToken.intermediateSigningKey.signatures.length > 0) {
        encryptedPaymentBundle.signature = gpToken.intermediateSigningKey.signatures[0];
    } else {
        encryptedPaymentBundle.signature = gpToken.signature;
    }

    try {
        var signedMessageObj = JSON.parse(gpToken.signedMessage);
        encryptedPaymentBundle.encryptedPaymentHeader = {
            ephemeralPublicKey: signedMessageObj.ephemeralPublicKey || ''
        };
    } catch (e) {
        encryptedPaymentBundle.encryptedPaymentHeader = { ephemeralPublicKey: '' };
    }

    var payload = {
        captureMethod: params.captureMethod || 'NOW',
        amount: convertToCents(totalAmount.getValue()),
        currency: basket.getCurrencyCode(),
        isAmountFinal: (params.isAmountFinal !== undefined) ? params.isAmountFinal : true,
        initiatorType: params.initiatorType || 'CARDHOLDER',
        accountOnFile: params.accountOnFile || 'NOT_STORED',
        merchantOrderNumber: basket.getOrderNo ? basket.getOrderNo() : ('BASKET-' + basket.getUUID()),
        merchant: buildMerchantObject(),
        paymentMethodType: {
            googlepay: {
                encryptedPaymentBundle: encryptedPaymentBundle
            }
        }
    };

    if (params.latLong) {
        payload.paymentMethodType.googlepay.latLong = params.latLong;
    }

    return payload;
}

module.exports = {
    buildCapturePayload: buildCapturePayload,
    buildRefundPayload: buildRefundPayload,
    buildVoidPayload: buildVoidPayload,
    buildFraudCheckPayload: buildFraudCheckPayload,
    buildFraudCheckForCardSavePayload: buildFraudCheckForCardSavePayload,
    buildVerificationPayload: buildVerificationPayload,
    buildCreatePaymentPayload: buildCreatePaymentPayload,
    buildApplePayPaymentPayload: buildApplePayPaymentPayload,
    buildGooglePayPaymentPayload: buildGooglePayPaymentPayload
};
