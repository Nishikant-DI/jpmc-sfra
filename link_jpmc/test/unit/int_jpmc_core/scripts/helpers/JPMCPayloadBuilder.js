'use strict';

/* eslint-disable no-unused-vars */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();
var sinon = require('sinon');

describe('int_jpmc_core/scripts/helpers/JPMCPayloadBuilder', function () {
    var JPMCPayloadBuilder;
    var mockLogger;
    var mockJPMCConfig;
    var mockSite;
    var Order;
    var OrderAddress;
    var PaymentInstrument;
    var ProductLineItem;
    var Product;
    var Shipment;
    var ShippingMethod;

    beforeEach(function () {
        // Reset all mocks
        mockLogger = require('../../../../../test/mocks/dw/system/Logger');
        mockLogger.resetAllLoggers();

        mockSite = require('../../../../../test/mocks/dw/system/Site');
        mockSite.resetMockPreferences();

        Order = require('../../../../../test/mocks/dw/order/Order');
        Order.resetMock();

        OrderAddress = require('../../../../../test/mocks/dw/order/OrderAddress');
        PaymentInstrument = require('../../../../../test/mocks/dw/order/PaymentInstrument');
        ProductLineItem = require('../../../../../test/mocks/dw/order/ProductLineItem');
        Product = require('../../../../../test/mocks/dw/catalog/Product');
        Shipment = require('../../../../../test/mocks/dw/order/Shipment');
        ShippingMethod = require('../../../../../test/mocks/dw/order/ShippingMethod');

        // Mock JPMCConfig
        mockJPMCConfig = {
            getConfig: sinon.stub().returns({
                merchantSoftware: {
                    companyName: 'Test Company',
                    productName: 'SFCC Plugin',
                    version: '1.0.0'
                }
            }),
            getCaptureMethod: sinon.stub().returns('MANUAL'),
            isAVSEnabled: sinon.stub().returns(true)
        };

        // Load module with mocks
        JPMCPayloadBuilder = proxyquire('../../../../../cartridges/int_jpmc_core/cartridge/scripts/helpers/JPMCPayloadBuilder', {
            'dw/system/Logger': mockLogger,
            'dw/system/Site': mockSite,
            '*/cartridge/scripts/helpers/JPMCConfig': mockJPMCConfig,
            '*/cartridge/scripts/helpers/jpmcConstants': {
                FALLBACK_IP_ADDRESS: '0.0.0.0',
                FALLBACK_USER_AGENT: 'Unknown',
                ACCOUNT_NUMBER_TYPE_PIE: 'SAFETECH_PAGE_ENCRYPTION',
                MULTI_CAPTURE_MAX_RECORD_COUNT: 99,
                DEFAULT_COMPANY_NAME: 'Salesforce Commerce Cloud',
                DEFAULT_PRODUCT_NAME: 'SFCC',
                DEFAULT_VERSION: '1.0.0'
            }
        });
    });

    describe('buildCapturePayload', function () {
        var mockOrder;

        beforeEach(function () {
            mockOrder = new Order();
            mockOrder.orderNo = 'ORDER-12345';
            mockOrder.currencyCode = 'USD';
        });

        it('should throw error when order is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildCapturePayload({ amount: 100 });
            }, 'Order and amount are required for capture payload');
        });

        it('should throw error when amount is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildCapturePayload({ order: mockOrder });
            }, 'Order and amount are required for capture payload');
        });

        it('should build basic capture payload', function () {
            var payload = JPMCPayloadBuilder.buildCapturePayload({
                order: mockOrder,
                amount: 100.00
            });

            assert.equal(payload.amount, 10000); // Converted to cents
            assert.equal(payload.currency, 'USD');
            assert.isTrue(payload.isAmountFinal);
            assert.isUndefined(payload.multiCapture);
        });

        it('should convert amount from dollars to cents correctly', function () {
            var payload = JPMCPayloadBuilder.buildCapturePayload({
                order: mockOrder,
                amount: 99.99
            });

            assert.equal(payload.amount, 9999);
        });

        it('should handle isFinal parameter', function () {
            var payload = JPMCPayloadBuilder.buildCapturePayload({
                order: mockOrder,
                amount: 50.00,
                isFinal: false
            });

            assert.isFalse(payload.isAmountFinal);
        });

        it('should build multi-capture payload with sequence number', function () {
            var payload = JPMCPayloadBuilder.buildCapturePayload({
                order: mockOrder,
                amount: 50.00,
                multiCapture: {
                    sequenceNumber: 1,
                    isFinal: false
                }
            });

            assert.isDefined(payload.multiCapture);
            assert.equal(payload.multiCapture.multiCaptureSequenceNumber, '1');
            assert.equal(payload.multiCapture.multiCaptureRecordCount, 99); // Placeholder
            assert.isFalse(payload.multiCapture.isFinalCapture);
            assert.isUndefined(payload.isAmountFinal);
        });

        it('should build final multi-capture payload', function () {
            var payload = JPMCPayloadBuilder.buildCapturePayload({
                order: mockOrder,
                amount: 50.00,
                multiCapture: {
                    sequenceNumber: 3,
                    isFinal: true
                }
            });

            assert.equal(payload.multiCapture.multiCaptureSequenceNumber, '3');
            assert.equal(payload.multiCapture.multiCaptureRecordCount, 3); // Same as sequence when final
            assert.isTrue(payload.multiCapture.isFinalCapture);
        });
    });

    describe('buildRefundPayload', function () {
        it('should throw error when transactionReferenceId is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildRefundPayload({});
            }, 'Transaction reference ID is required for refund payload');
        });

        it('should build full refund payload', function () {
            var payload = JPMCPayloadBuilder.buildRefundPayload({
                transactionReferenceId: 'TXN123456'
            });

            assert.equal(payload.paymentMethodType.transactionReference.transactionReferenceId, 'TXN123456');
            assert.isDefined(payload.merchant);
            assert.isUndefined(payload.amount);
            assert.isUndefined(payload.currency);
        });

        it('should build partial refund payload with amount', function () {
            var payload = JPMCPayloadBuilder.buildRefundPayload({
                transactionReferenceId: 'TXN123456',
                amount: 50.00,
                currency: 'USD'
            });

            assert.equal(payload.amount, 5000); // Converted to cents
            assert.equal(payload.currency, 'USD');
            assert.equal(payload.paymentMethodType.transactionReference.transactionReferenceId, 'TXN123456');
        });

        it('should include merchant software information', function () {
            var payload = JPMCPayloadBuilder.buildRefundPayload({
                transactionReferenceId: 'TXN123456'
            });

            assert.isDefined(payload.merchant);
            assert.isDefined(payload.merchant.merchantSoftware);
            assert.equal(payload.merchant.merchantSoftware.companyName, 'Salesforce Commerce Cloud');
            assert.equal(payload.merchant.merchantSoftware.productName, 'SFCC');
            assert.equal(payload.merchant.merchantSoftware.version, '1.0.0');
        });
    });

    describe('buildVoidPayload', function () {
        it('should build void payload', function () {
            var payload = JPMCPayloadBuilder.buildVoidPayload();

            assert.isDefined(payload);
            assert.isTrue(payload.isVoid);
        });
    });

    describe('buildFraudCheckPayload', function () {
        var mockOrder;
        var mockPaymentInstrument;
        var mockBillingAddress;

        beforeEach(function () {
            mockOrder = new Order();
            mockOrder.totalGrossPrice = { value: 100.00 };
            mockOrder.currencyCode = 'USD';
            mockOrder.customerEmail = 'customer@example.com';

            mockBillingAddress = new OrderAddress();
            mockOrder.billingAddress = mockBillingAddress;

            mockPaymentInstrument = new PaymentInstrument();
            mockPaymentInstrument.paymentMethod = 'CREDIT_CARD';
            mockPaymentInstrument.custom = {
                jpmcCvv: '123'
            };
        });

        it('should throw error when basket/order is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildFraudCheckPayload({
                    paymentInstrument: mockPaymentInstrument
                });
            }, 'Basket or order is required for fraud check payload');
        });

        it('should throw error when payment instrument is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildFraudCheckPayload({
                    basketOrOrder: mockOrder
                });
            }, 'Payment instrument is required for fraud check payload');
        });

        it('should build fraud check payload with required fields', function () {
            var payload = JPMCPayloadBuilder.buildFraudCheckPayload({
                basketOrOrder: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                accountNumberType: 'SAFETECH_PAGE_ENCRYPTION'
            });

            assert.equal(payload.amount, 10000); // Cents
            assert.equal(payload.currency, 'USD');
            assert.isDefined(payload.accountHolder);
            assert.isDefined(payload.paymentMethodType);
            assert.isDefined(payload.merchant);
            assert.isDefined(payload.fraudScore);
        });

        it('should include account holder email', function () {
            var payload = JPMCPayloadBuilder.buildFraudCheckPayload({
                basketOrOrder: mockOrder,
                paymentInstrument: mockPaymentInstrument
            });

            assert.equal(payload.accountHolder.email, 'customer@example.com');
        });

        it('should include billing address when present', function () {
            var payload = JPMCPayloadBuilder.buildFraudCheckPayload({
                basketOrOrder: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                deviceIPAddress: '192.168.1.1'
            });

            assert.isDefined(payload.accountHolder.billingAddress);
            assert.equal(payload.accountHolder.billingAddress.line1, '123 Main St');
            assert.equal(payload.accountHolder.billingAddress.city, 'New York');
            assert.equal(payload.accountHolder.billingAddress.state, 'NY');
            assert.equal(payload.accountHolder.billingAddress.postalCode, '10001');
            assert.equal(payload.accountHolder.billingAddress.countryCode, 'USA'); // Converted to Alpha-3
        });

        it('should include device IP address', function () {
            var payload = JPMCPayloadBuilder.buildFraudCheckPayload({
                basketOrOrder: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                deviceIPAddress: '192.168.1.1'
            });

            assert.equal(payload.accountHolder.deviceIPAddress, '192.168.1.1');
        });

        it('should include fraud score information', function () {
            var payload = JPMCPayloadBuilder.buildFraudCheckPayload({
                basketOrOrder: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                fraudScore: {
                    cardholderBrowserInformation: 'Mozilla/5.0',
                    isFraudRuleReturn: true,
                    sessionId: 'kount-session-123'
                }
            });

            assert.equal(payload.fraudScore.cardholderBrowserInformation, 'Mozilla/5.0');
            assert.isTrue(payload.fraudScore.isFraudRuleReturn);
            assert.equal(payload.fraudScore.sessionId, 'kount-session-123');
        });

        it('should auto-generate shopping cart string', function () {
            // Add product line item
            var pli = new ProductLineItem();
            pli.productID = 'PROD001';
            pli.productName = 'Test Product';
            pli.quantity.value = 2;
            pli.adjustedPrice.value = 49.99;
            pli.product = new Product();
            mockOrder.productLineItems.add(pli);

            var payload = JPMCPayloadBuilder.buildFraudCheckPayload({
                basketOrOrder: mockOrder,
                paymentInstrument: mockPaymentInstrument
            });

            assert.isDefined(payload.fraudScore.fraudCheckShoppingCart);
            assert.include(payload.fraudScore.fraudCheckShoppingCart, 'I=PROD001');
            assert.include(payload.fraudScore.fraudCheckShoppingCart, 'Q=2');
        });

        it('should include shipping information when present', function () {
            var shipment = new Shipment();
            shipment.shippingAddress = new OrderAddress();
            shipment.shippingMethod = new ShippingMethod();
            mockOrder.defaultShipment = shipment;

            var payload = JPMCPayloadBuilder.buildFraudCheckPayload({
                basketOrOrder: mockOrder,
                paymentInstrument: mockPaymentInstrument
            });

            assert.isDefined(payload.shipTo);
            assert.isDefined(payload.shipTo.shippingAddress);
            assert.equal(payload.shipTo.shippingDescription, 'Standard Shipping');
        });

        it('should format phone number correctly', function () {
            mockBillingAddress.phone = '+1 (555) 123-4567';

            var payload = JPMCPayloadBuilder.buildFraudCheckPayload({
                basketOrOrder: mockOrder,
                paymentInstrument: mockPaymentInstrument
            });

            assert.isDefined(payload.accountHolder.phone);
            assert.equal(payload.accountHolder.phone.phoneNumber, '15551234567');
            assert.equal(payload.accountHolder.phone.countryCode, 1);
        });
    });

    describe('buildFraudCheckForCardSavePayload', function () {
        it('should throw error when card data is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildFraudCheckForCardSavePayload({});
            }, 'Card data with account number is required');
        });

        it('should build card save fraud check payload', function () {
            var payload = JPMCPayloadBuilder.buildFraudCheckForCardSavePayload({
                cardData: {
                    accountNumber: '4111111111111111',
                    expirationMonth: 12,
                    expirationYear: 2025,
                    cvv: '123'
                },
                currency: 'USD',
                accountNumberType: 'SAFETECH_TOKEN'
            });

            assert.equal(payload.amount, 0); // No transaction amount
            assert.equal(payload.currency, 'USD');
            assert.equal(payload.paymentMethodType.card.accountNumber, '4111111111111111');
            assert.equal(payload.paymentMethodType.card.accountNumberType, 'SAFETECH_TOKEN');
            assert.equal(payload.paymentMethodType.card.expiry.month, 12);
            assert.equal(payload.paymentMethodType.card.expiry.year, 2025);
        });

        it('should use default currency from site when not provided', function () {
            mockSite.setDefaultCurrency('EUR');

            var payload = JPMCPayloadBuilder.buildFraudCheckForCardSavePayload({
                cardData: {
                    accountNumber: '4111111111111111',
                    expirationMonth: 12,
                    expirationYear: 2025
                }
            });

            assert.equal(payload.currency, 'EUR');
            
            // Reset for other tests
            mockSite.setDefaultCurrency('USD');
        });

        it('should include customer email when provided', function () {
            var payload = JPMCPayloadBuilder.buildFraudCheckForCardSavePayload({
                cardData: {
                    accountNumber: '4111111111111111',
                    expirationMonth: 12,
                    expirationYear: 2025
                },
                customerEmail: 'customer@example.com'
            });

            assert.equal(payload.accountHolder.email, 'customer@example.com');
        });

        it('should include Kount session ID when provided', function () {
            var payload = JPMCPayloadBuilder.buildFraudCheckForCardSavePayload({
                cardData: {
                    accountNumber: '4111111111111111',
                    expirationMonth: 12,
                    expirationYear: 2025
                },
                kountSessionId: 'kount-session-456'
            });

            assert.equal(payload.fraudScore.sessionId, 'kount-session-456');
        });
    });

    describe('buildVerificationPayload', function () {
        it('should throw error when required parameters are missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildVerificationPayload({});
            }, 'Missing required parameters: cardData, currency');
        });

        it('should build verification payload with card data', function () {
            var payload = JPMCPayloadBuilder.buildVerificationPayload({
                cardData: {
                    accountNumber: '4111111111111111',
                    expirationMonth: 12,
                    expirationYear: 2025,
                    cvv: '123'
                },
                currency: 'USD'
            });

            assert.equal(payload.currency, 'USD');
            assert.equal(payload.paymentMethodType.card.accountNumber, '4111111111111111');
            assert.equal(payload.paymentMethodType.card.expiry.month, 12);
            assert.equal(payload.paymentMethodType.card.expiry.year, 2025);
            assert.equal(payload.paymentMethodType.card.cvv, '123');
            assert.isDefined(payload.merchant);
        });

        it('should handle verification without CVV for stored cards', function () {
            var payload = JPMCPayloadBuilder.buildVerificationPayload({
                cardData: {
                    accountNumber: 'TOKEN123',
                    expirationMonth: 12,
                    expirationYear: 2025
                },
                currency: 'USD',
                accountNumberType: 'SAFETECH_TOKEN'
            });

            assert.equal(payload.paymentMethodType.card.accountNumberType, 'SAFETECH_TOKEN');
            assert.isUndefined(payload.paymentMethodType.card.cvv);
        });

        it('should include billing address when provided and AVS enabled', function () {
            var billingAddress = new OrderAddress();

            var payload = JPMCPayloadBuilder.buildVerificationPayload({
                cardData: {
                    accountNumber: '4111111111111111',
                    expirationMonth: 12,
                    expirationYear: 2025
                },
                currency: 'USD',
                billingAddress: billingAddress,
                email: 'customer@example.com'
            });

            assert.isDefined(payload.accountHolder);
            assert.equal(payload.accountHolder.email, 'customer@example.com');
            assert.isDefined(payload.accountHolder.billingAddress);
        });

        it('should include wallet provider', function () {
            var payload = JPMCPayloadBuilder.buildVerificationPayload({
                cardData: {
                    accountNumber: 'APPLE_PAY_TOKEN',
                    expirationMonth: 12,
                    expirationYear: 2025
                },
                currency: 'USD',
                walletProvider: 'APPLE_PAY'
            });

            assert.equal(payload.paymentMethodType.card.walletProvider, 'APPLE_PAY');
        });
    });

    describe('buildCreatePaymentPayload', function () {
        var mockOrder;
        var mockPaymentInstrument;

        beforeEach(function () {
            mockOrder = new Order();
            mockOrder.orderNo = 'ORDER-12345';
            mockOrder.totalGrossPrice = { value: 100.00 };
            mockOrder.currencyCode = 'USD';
            mockOrder.billingAddress = new OrderAddress();

            mockPaymentInstrument = new PaymentInstrument();
            mockPaymentInstrument.custom = {};
        });

        it('should throw error when order is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildCreatePaymentPayload({
                    paymentInstrument: mockPaymentInstrument
                });
            }, 'Order, payment instrument, and merchant ID are required');
        });

        it('should throw error when payment instrument is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildCreatePaymentPayload({
                    order: mockOrder
                });
            }, 'Order, payment instrument, and merchant ID are required');
        });

        it('should build create payment payload with defaults', function () {
            var payload = JPMCPayloadBuilder.buildCreatePaymentPayload({
                order: mockOrder,
                paymentInstrument: mockPaymentInstrument
            });

            assert.equal(payload.captureMethod, 'NOW');
            assert.equal(payload.amount, 10000); // Cents
            assert.equal(payload.currency, 'USD');
            assert.isTrue(payload.isAmountFinal);
            assert.equal(payload.initiatorType, 'CARDHOLDER');
            assert.equal(payload.accountOnFile, 'NOT_STORED');
            assert.equal(payload.merchantOrderNumber, 'ORDER-12345');
            assert.isDefined(payload.merchant);
            assert.isDefined(payload.accountHolder);
            assert.isDefined(payload.paymentMethodType);
        });

        it('should support custom capture method', function () {
            var payload = JPMCPayloadBuilder.buildCreatePaymentPayload({
                order: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                captureMethod: 'MANUAL'
            });

            assert.equal(payload.captureMethod, 'MANUAL');
        });

        it('should support recurring payments', function () {
            var payload = JPMCPayloadBuilder.buildCreatePaymentPayload({
                order: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                recurring: {
                    sequence: 'FIRST',
                    isVariableAmount: false,
                    agreementId: 'AGR123'
                }
            });

            assert.isDefined(payload.recurring);
            assert.equal(payload.recurring.recurringSequence, 'FIRST');
            assert.isFalse(payload.recurring.isVariableAmount);
            assert.equal(payload.recurring.agreementId, 'AGR123');
        });

        it('should support fraud score request', function () {
            var payload = JPMCPayloadBuilder.buildCreatePaymentPayload({
                order: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                requestFraudScore: true,
                transactionRiskScore: 50
            });

            assert.isDefined(payload.risk);
            assert.isTrue(payload.risk.requestFraudScore);
            assert.equal(payload.risk.transactionRiskScore, 50);
        });

       
    });

    describe('buildApplePayPaymentPayload', function () {
        var mockOrder;
        var mockEncryptedBundle;

        beforeEach(function () {
            mockOrder = new Order();
            mockOrder.orderNo = 'ORDER-12345';
            mockOrder.totalGrossPrice = { value: 100.00 };
            mockOrder.currencyCode = 'USD';

            mockEncryptedBundle = {
                encryptedPayload: 'encrypted-data-here',
                signature: 'signature-here',
                protocolVersion: 'EC_v1',
                encryptedPaymentHeader: {
                    ephemeralPublicKey: 'ephemeral-key-here',
                    publicKeyHash: 'public-key-hash-here',
                    walletTransactionId: 'wallet-txn-123'
                }
            };
        });

        it('should throw error when order is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildApplePayPaymentPayload({
                    encryptedPaymentBundle: mockEncryptedBundle
                });
            }, 'Order is required for Apple Pay payment payload');
        });

        it('should throw error when encrypted bundle is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildApplePayPaymentPayload({
                    order: mockOrder
                });
            }, 'Encrypted payment bundle is required');
        });

        it('should validate required bundle fields', function () {
            var invalidBundle = { encryptedPayload: 'data' };

            assert.throws(function () {
                JPMCPayloadBuilder.buildApplePayPaymentPayload({
                    order: mockOrder,
                    encryptedPaymentBundle: invalidBundle
                });
            }, /is required/);
        });

        it('should build Apple Pay payment payload', function () {
            var payload = JPMCPayloadBuilder.buildApplePayPaymentPayload({
                order: mockOrder,
                encryptedPaymentBundle: mockEncryptedBundle,
                latLong: '1,1'
            });

            assert.equal(payload.amount, 10000);
            assert.equal(payload.currency, 'USD');
            assert.equal(payload.merchantOrderNumber, 'ORDER-12345');
            assert.isDefined(payload.paymentMethodType.applepay);
            assert.equal(payload.paymentMethodType.applepay.latLong, '1,1');
            assert.equal(
                payload.paymentMethodType.applepay.encryptedPaymentBundle.encryptedPayload,
                'encrypted-data-here'
            );
        });

        it('should use capture method from config', function () {
            mockJPMCConfig.getCaptureMethod.returns('DELAYED');

            var payload = JPMCPayloadBuilder.buildApplePayPaymentPayload({
                order: mockOrder,
                encryptedPaymentBundle: mockEncryptedBundle
            });

            assert.equal(payload.captureMethod, 'DELAYED');
        });

        it('should allow capture method override', function () {
            var payload = JPMCPayloadBuilder.buildApplePayPaymentPayload({
                order: mockOrder,
                encryptedPaymentBundle: mockEncryptedBundle,
                captureMethod: 'NOW'
            });

            assert.equal(payload.captureMethod, 'NOW');
        });

        it('should include optional wallet application data', function () {
            mockEncryptedBundle.encryptedPaymentHeader.walletApplicationData = 'app-data-hash';

            var payload = JPMCPayloadBuilder.buildApplePayPaymentPayload({
                order: mockOrder,
                encryptedPaymentBundle: mockEncryptedBundle
            });

            assert.equal(
                payload.paymentMethodType.applepay.encryptedPaymentBundle.encryptedPaymentHeader.walletApplicationData,
                'app-data-hash'
            );
        });
    });

    describe('buildGooglePayPaymentPayload', function () {
        var mockOrder;
        var mockPaymentInstrument;
        var mockGooglePayToken;

        beforeEach(function () {
            mockOrder = new Order();
            mockOrder.orderNo = 'ORDER-12345';
            mockOrder.UUID = 'basket-uuid-123';
            mockOrder.totalGrossPrice = { value: 100.00 };
            mockOrder.currencyCode = 'USD';

            mockPaymentInstrument = new PaymentInstrument();

            mockGooglePayToken = {
                signedMessage: '{"ephemeralPublicKey":"key-data"}',
                signature: 'signature-data',
                protocolVersion: 'ECv2'
            };
        });

        it('should throw error when order is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildGooglePayPaymentPayload({
                    paymentInstrument: mockPaymentInstrument,
                    googlePayToken: mockGooglePayToken
                });
            }, 'Order and payment instrument are required');
        });

        it('should throw error when Google Pay token is missing', function () {
            assert.throws(function () {
                JPMCPayloadBuilder.buildGooglePayPaymentPayload({
                    order: mockOrder,
                    paymentInstrument: mockPaymentInstrument
                });
            }, 'Google Pay token data is required');
        });

        it('should build Google Pay payment payload', function () {
            var payload = JPMCPayloadBuilder.buildGooglePayPaymentPayload({
                order: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                googlePayToken: mockGooglePayToken,
                latLong: '0,0'
            });

            assert.equal(payload.amount, 10000);
            assert.equal(payload.currency, 'USD');
            assert.equal(payload.captureMethod, 'NOW');
            assert.equal(payload.merchantOrderNumber, 'ORDER-12345');
            assert.isDefined(payload.paymentMethodType.googlepay);
            assert.equal(payload.paymentMethodType.googlepay.latLong, '0,0');
        });

        it('should parse signed message for ephemeral key', function () {
            var payload = JPMCPayloadBuilder.buildGooglePayPaymentPayload({
                order: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                googlePayToken: mockGooglePayToken
            });

            assert.equal(
                payload.paymentMethodType.googlepay.encryptedPaymentBundle.encryptedPaymentHeader.ephemeralPublicKey,
                'key-data'
            );
        });

        it('should handle intermediate signing key', function () {
            mockGooglePayToken.intermediateSigningKey = {
                signatures: ['intermediate-signature']
            };

            var payload = JPMCPayloadBuilder.buildGooglePayPaymentPayload({
                order: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                googlePayToken: mockGooglePayToken
            });

            assert.equal(
                payload.paymentMethodType.googlepay.encryptedPaymentBundle.signature,
                'intermediate-signature'
            );
        });

        it('should handle invalid signed message gracefully', function () {
            mockGooglePayToken.signedMessage = 'invalid-json';

            var payload = JPMCPayloadBuilder.buildGooglePayPaymentPayload({
                order: mockOrder,
                paymentInstrument: mockPaymentInstrument,
                googlePayToken: mockGooglePayToken
            });

            assert.equal(
                payload.paymentMethodType.googlepay.encryptedPaymentBundle.encryptedPaymentHeader.ephemeralPublicKey,
                ''
            );
        });
    });

    describe('module exports', function () {
        it('should export all required functions', function () {
            assert.isFunction(JPMCPayloadBuilder.buildCapturePayload);
            assert.isFunction(JPMCPayloadBuilder.buildRefundPayload);
            assert.isFunction(JPMCPayloadBuilder.buildVoidPayload);
            assert.isFunction(JPMCPayloadBuilder.buildFraudCheckPayload);
            assert.isFunction(JPMCPayloadBuilder.buildFraudCheckForCardSavePayload);
            assert.isFunction(JPMCPayloadBuilder.buildVerificationPayload);
            assert.isFunction(JPMCPayloadBuilder.buildCreatePaymentPayload);
            assert.isFunction(JPMCPayloadBuilder.buildApplePayPaymentPayload);
            assert.isFunction(JPMCPayloadBuilder.buildGooglePayPaymentPayload);
        });
    });
});
