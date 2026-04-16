'use strict';

/**
 * JPMC Constants
 * Centralized constants used across JPMC payment integration
 * @module scripts/helpers/jpmcConstants
 */
var JPMCConstants = {
    // Processor
    JPMC_Processor: 'JPMC_Payment',

    // Transaction States (from JPMC API response)
    TRANSACTION_STATE: {
        AUTHORIZED: 'AUTHORIZED',
        CLOSED: 'CLOSED',
        DECLINED: 'DECLINED'
    },

    // Apple Pay Protocol Versions
    APPLE_PAY_PROTOCOL: {
        EC_V1: 'EC_v1',
        RSA_V1: 'RSA_v1'
    },

    // Google Pay
    JPMC_GOOGLE_PAY: 'JPMC_GOOGLE_PAY',
    GOOGLE_PAY_WALLET_PROVIDER: 'GOOGLE_PAY',
    APPLE_PAY_WALLET_PROVIDER: 'APPLE_PAY',

    // Account Number Types
    ACCOUNT_NUMBER_TYPE_PIE: 'SAFETECH_PAGE_ENCRYPTION',

    // Token Management
    TOKEN_CACHE_ID: 'jpmc_access_token_cache',
    TOKEN_CACHE_KEY: 'jpmc_access_token',
    TOKEN_CUSTOM_OBJECT_TYPE: 'JPMCAccessToken',
    CLOCK_SKEW_SECONDS: 30,

    // Keystore Aliases (defaults)
    DEFAULT_CERT_ALIAS: 'jpmc-certificate',
    DEFAULT_KEY_ALIAS: 'jpmc-private-key',

    // Config Defaults
    DEFAULT_EXPIRES_IN: '5h',
    DEFAULT_JWT_EXPIRY_SECONDS: 8 * 60 * 60,
    DEFAULT_COMPANY_NAME: 'JPMC Plugin',
    DEFAULT_PRODUCT_NAME: 'JPMC SFCC B2C Cartridge',
    DEFAULT_VERSION: '1.0',
    DEFAULT_TOKEN_TYPE: 'SAFETECH_TOKEN',
    DEFAULT_CAPTURE_METHOD: 'MANUAL',
    CAPTURE_METHOD_NOW: 'NOW',

    // Fraud Detection
    FRAUD_REVIEW_NOTE_SUBJECT: 'Fraud Review',
    FRAUD_CART_MAX_LENGTH: 999,

    // Multi-capture
    MULTI_CAPTURE_MAX_RECORD_COUNT: 99,

    // Fallback values for external data
    FALLBACK_IP_ADDRESS: '0.0.0.0',
    FALLBACK_USER_AGENT: 'Unknown',

    // Payment method display names (server-side)
    PAYMENT_METHOD_DISPLAY_UNKNOWN: 'Unknown',
    PAYMENT_METHOD_DISPLAY_GOOGLE_PAY: 'Google Pay',
    PAYMENT_METHOD_DISPLAY_APPLE_PAY: 'Apple Pay',
    PAYMENT_METHOD_DISPLAY_CREDIT_CARD: 'Credit Card',

    // Order note subjects
    NOTE_SUBJECT_GPAY_PAYMENT: 'JPMC Google Pay Payment',
    NOTE_SUBJECT_APPLEPAY_PAYMENT: 'JPMC Apple Pay Payment',

    // Multi-MID
    MERCHANT_CONFIG_CO_TYPE: 'JPMCMerchantConfig',
    TOKEN_CACHE_KEY_PREFIX: 'jpmc_access_token_',
    MERCHANT_CONFIG_CACHE_ID: 'jpmc_merchant_config_cache',
    MERCHANT_CONFIG_CACHE_KEY_PREFIX: 'jpmc_merchant_cfg_',

    // Validation
    VALID_CAPTURE_METHODS: ['MANUAL', 'DELAYED', 'NOW'],
    ALIAS_PATTERN: /^[a-zA-Z0-9_-]{1,100}$/,
    THUMBPRINT_PATTERN: /^[A-F0-9]{40}$/
};

module.exports = JPMCConstants;