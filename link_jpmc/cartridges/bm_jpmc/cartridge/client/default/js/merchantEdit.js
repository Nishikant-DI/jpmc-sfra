var MerchantEditForm = (function() {
    'use strict';

    var CONFIG = {
        locale: {
            selector: '#localeSelect',
            configKeyInput: '#configKeyInput'
        },
        timeout: 5000,
        retries: 3
    };

    var fields = [
        'enabled', 'merchantId', 'clientId', 'resourceId', 'audience',
        'tokenUri', 'expiresIn', 'certAlias', 'privateKeyAlias', 'kid',
        'pieGetKeyUrl', 'pieEncryptionUrl', 'captureMethod', 'platformId',
        'tokenizationType', 'enableAVS',
        'enableFraudCheck', 'enableFraudCheckAtAuth', 'googlePayEnvironment',
        'googlePayGateway', 'googlePayGatewayMerchantId', 'googlePayMerchantId',
        'googlePayMerchantName', 'googlePayAllowedCardNetworks',
        'googlePayAllowedAuthMethods', 'JPMCGooglePayCartEnabled',
        'JPMCGooglePayPDPEnabled', 'applePayMerchantId', 'kountClientId',
        'kountEnvironment'
    ];

    function onLocaleChange() {
        var localeSelect = document.querySelector(CONFIG.locale.selector);
        var configKeyInput = document.querySelector(CONFIG.locale.configKeyInput);

        if (!localeSelect || !configKeyInput) {
            return;
        }

        var locale = localeSelect.value;
        if (!locale) {
            return;
        }

        var url = localeSelect.getAttribute('data-config-url');
        if (!url) {
            return;
        }

        fetchLocaleConfig(url, locale, configKeyInput);
    }

    function fetchLocaleConfig(baseUrl, locale, configKeyInput) {
        var xhr = new XMLHttpRequest();
        var url = baseUrl + encodeURIComponent(locale);

        xhr.timeout = CONFIG.timeout;
        xhr.open('GET', url, true);

        xhr.onload = function() {
            if (xhr.status === 200) {
                handleConfigResponse(xhr.responseText, configKeyInput);
            } else {
                handleConfigError();
            }
        };

        xhr.onerror = function() {
            handleConfigError();
        };

        xhr.ontimeout = function() {
            handleConfigError();
        };

        xhr.send();
    }

    function handleConfigResponse(responseText, configKeyInput) {
        try {
            var resp = JSON.parse(responseText);
            if (resp && resp.configKey && resp.data) {
                configKeyInput.value = resp.configKey;
                populateFormFields(resp.data);
            }
        } catch (e) {
            handleConfigError();
        }
    }

    function handleConfigError() {
        return;
    }

    function populateFormFields(data) {
        if (!data || typeof data !== 'object') {
            return;
        }

        fields.forEach(function(fieldName) {
            var input = document.querySelector(
                'input[name="' + fieldName + '"], ' +
                'select[name="' + fieldName + '"]'
            );

            if (!input) {
                return;
            }

            var value = data[fieldName];
            if (value === true) {
                input.value = 'true';
            } else if (value === false) {
                input.value = 'false';
            } else if (value !== undefined && value !== null) {
                input.value = String(value);
            } else {
                input.value = '';
            }
        });
    }

    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initForm);
        } else {
            initForm();
        }
    }

    function initForm() {
        var localeSelect = document.querySelector(CONFIG.locale.selector);
        if (localeSelect) {
            localeSelect.addEventListener('change', onLocaleChange);
            onLocaleChange();
        }
    }

    return {
        init: init
    };
}());

MerchantEditForm.init();
