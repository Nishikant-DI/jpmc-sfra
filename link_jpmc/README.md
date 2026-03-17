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

## Technical Requirements

- Salesforce Commerce Cloud B2C Commerce
- Node.js 14+ for development
- SGMF Scripts for build processes

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

## Support

This cartridge is fully supported by JPMorgan Chase Payments.

For technical support and documentation, please contact your JPMorgan Chase representative.

## License

Copyright © 2026 JPMorgan Chase & Co. All rights reserved.
