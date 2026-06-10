# JPMorgan Chase Payment Cartridge for Salesforce Commerce Cloud

The JPMorgan Chase Payment Cartridge integrates JPMorgan Payments Modern API with Salesforce Commerce Cloud (SFCC) to provide a comprehensive payment solution for e-commerce merchants.

## Overview

This cartridge enables seamless integration of JPMorgan Chase payment services with SFCC, offering secure and reliable payment processing capabilities for online merchants.

## Features

### Payment Methods
- **Credit Card Payments**: Full credit card processing with enhanced security
- **Google Pay**: Digital wallet integration for Web
- **Apple Pay**: Digital wallet integration for Web (safari)

### Credit Card Features
- **Page Encryption**: Client-side encryption for enhanced security
- **Tokenization**: Secure token-based payment processing
- **AVS (Address Verification System)**: Address verification for fraud prevention
- **Saved Card Payments**: Secure storage and reuse of customer payment methods
- **Authorization**: Payment authorization processing
- **Capture**: Payment capture functionality
- **Refund**: Full and partial refund capabilities
- **Void**: Transaction void operations

### Security & Compliance
- PCI DSS compliant payment processing
- End-to-end encryption
- Secure tokenization
- Fraud prevention tools

## Supported Payment Types

- Credit Cards (Visa, Mastercard, American Express, Discover etc.)
- Google Pay (Web)
- Apple Pay (Web — Safari)

## Technical Requirements

- Salesforce Commerce Cloud B2C Commerce
- SFRA version: 7.0.1
- Compatibility mode: 21.2+
- Node.js 14+ for development
- SGMF Scripts for build processes

## Supported Locales

- en_US (English — United States)
- en_CA (English - Cananda)
- Locales supported by SFRA (Multi Merchant feature)

## Installation

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the cartridge: `npm run build`
4. Upload to SFCC: `npm run uploadCartridge`

## Development Scripts

- `npm run build` - Build JavaScript and SCSS files
- `npm run watch` - Watch for changes and rebuild
- `npm run lint` - Run linting for JavaScript and CSS
- `npm run test` - Run unit tests
- `npm run uploadCartridge` - Upload cartridge to SFCC

## Cartridge Structure

- `int_jpmc_core` - Core payment functionality and API integration
- `int_jpmc_sfra` - SFRA-specific templates and controllers
- `bm_jpmc` - SFRA-specific templates + controllers + Integartions from BM users(Admin and CSC)

## Configuration

Configure the payment settings in Business Manager:
1. Navigate to Merchant Tools > Site Preferences > Custom Preferences
2. Configure JPMorgan Chase payment credentials
3. Enable desired payment methods
4. Configure the Services

## Failover & Recovery

When the JPMorgan Chase payment service is unavailable, the cartridge handles failures as follows:

- **Service Framework Circuit Breaker**: All API calls use the SFCC Service Framework (`LocalServiceRegistry`), which provides automatic circuit-breaker protection. After repeated failures, the framework stops calling the service for a configurable cooldown period, preventing cascading timeouts.
- **Authorization Failure**: If the payment authorization call fails or times out, the order is not placed. The customer sees a payment error message and can retry or choose a different payment method.
- **3DS Authentication**: If the 3DS orchestration service is unreachable, the authentication step fails gracefully and the customer is returned to checkout with an error message.
- **Capture/Refund/Void (BM Operations)**: If a post-authorization operation fails, the CSC agent sees an error banner in Business Manager. The operation can be retried once the service recovers.
- **Account Updater Job**: If the Account Updater service is unavailable during a scheduled job run, failed notifications are queued in `AccountUpdater_Notification_Queue` and retried on the next job execution (up to 5 retries).
- **Fraud Check (Kount)**: If the fraud check service is unreachable, the payment proceeds without a fraud score (configurable behavior via Site Preferences).
- **Logging**: All service failures are logged with error-level severity to `customerror_*` log files for monitoring and alerting.

## Support

This cartridge is fully supported by JPMorgan Chase Payments.

For technical support and documentation, please contact your JPMorgan Chase representative.

## License

Copyright © 2026 JPMorgan Chase & Co. All rights reserved.
