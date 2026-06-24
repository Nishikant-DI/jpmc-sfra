'use strict';

var assert = require('chai').assert;
var request = require('request-promise');
var config = require('../it.config');

describe('JPMCGooglePay-GetConfig', function () {
    this.timeout(5000);

    it('should return Google Pay configuration JSON', function () {
        var myRequest = {
            url: config.baseUrl + '/JPMCGooglePay-GetConfig',
            method: 'GET',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (response) {
                assert.equal(response.statusCode, 200);
                var body = JSON.parse(response.body);
                assert.isBoolean(body.enabled);
            });
    });
});

describe('JPMCGooglePay-StoreToken', function () {
    this.timeout(5000);

    it('should reject request without CSRF token', function () {
        var cookieJar = request.jar();
        var myRequest = {
            url: config.baseUrl + '/JPMCGooglePay-StoreToken',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            followRedirect: false,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            },
            form: {
                token: JSON.stringify({ signature: 'test', protocolVersion: 'ECv2' })
            }
        };

        return request(myRequest)
            .then(function (response) {
                assert.include([301, 302, 403, 500], response.statusCode, 'CSRF rejection should redirect or error');
            });
    });

    it('should store token with valid CSRF', function () {
        var cookieJar = request.jar();
        var myRequest = {
            url: config.baseUrl + '/CSRF-Generate',
            method: 'GET',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (csrfResponse) {
                var csrf = JSON.parse(csrfResponse.body).csrf;
                var formData = {
                    token: JSON.stringify({ signature: 'test', protocolVersion: 'ECv2' })
                };
                formData[csrf.tokenName] = csrf.token;
                return request({
                    url: config.baseUrl + '/JPMCGooglePay-StoreToken',
                    method: 'POST',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    simple: false,
                    jar: cookieJar,
                    form: formData,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });
            })
            .then(function (response) {
                assert.include([200, 301, 302], response.statusCode);
                if (response.statusCode === 200) {
                    var body = JSON.parse(response.body);
                    assert.isFalse(body.error);
                }
            });
    });
});

describe('JPMCGooglePay-ClearToken', function () {
    this.timeout(5000);

    it('should reject request without CSRF token', function () {
        var cookieJar = request.jar();
        var myRequest = {
            url: config.baseUrl + '/JPMCGooglePay-ClearToken',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            followRedirect: false,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (response) {
                assert.include([301, 302, 403, 500], response.statusCode, 'CSRF rejection should redirect or error');
            });
    });

    it('should clear token with valid CSRF', function () {
        var cookieJar = request.jar();
        var myRequest = {
            url: config.baseUrl + '/CSRF-Generate',
            method: 'GET',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (csrfResponse) {
                var csrf = JSON.parse(csrfResponse.body).csrf;
                var formData = {};
                formData[csrf.tokenName] = csrf.token;
                return request({
                    url: config.baseUrl + '/JPMCGooglePay-ClearToken',
                    method: 'POST',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    simple: false,
                    jar: cookieJar,
                    form: formData,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });
            })
            .then(function (response) {
                assert.include([200, 301, 302], response.statusCode);
                if (response.statusCode === 200) {
                    var body = JSON.parse(response.body);
                    assert.isFalse(body.error);
                }
            });
    });
});

describe('JPMCGooglePay-SelectShippingDetails', function () {
    this.timeout(10000);

    var cookieJar = request.jar();
    var variantPid = '701643421084M';

    before(function () {
        var myRequest = {
            url: config.baseUrl + '/Cart-AddProduct',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            },
            form: { pid: variantPid, quantity: 1 }
        };
        return request(myRequest)
            .then(function (response) {
                assert.include([200, 301, 302], response.statusCode);
            });
    });

    it('should reject request without CSRF token', function () {
        var myRequest = {
            url: config.baseUrl + '/JPMCGooglePay-SelectShippingDetails',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            followRedirect: false,
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ address: { countryCode: 'US', postalCode: '01803', administrativeArea: 'MA', locality: 'Burlington' } })
        };

        return request(myRequest)
            .then(function (response) {
                assert.include([301, 302, 403, 500], response.statusCode, 'CSRF rejection should redirect or error');
            });
    });

    it('should return shipping options with valid CSRF and address', function () {
        var myRequest = {
            url: config.baseUrl + '/CSRF-Generate',
            method: 'GET',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (csrfResponse) {
                var csrf = JSON.parse(csrfResponse.body).csrf;
                var payload = {
                    address: { countryCode: 'US', postalCode: '01803', administrativeArea: 'MA', locality: 'Burlington' }
                };
                payload[csrf.tokenName] = csrf.token;
                return request({
                    url: config.baseUrl + '/JPMCGooglePay-SelectShippingDetails',
                    method: 'POST',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    simple: false,
                    jar: cookieJar,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
            })
            .then(function (response) {
                assert.include([200, 301, 302], response.statusCode);
                if (response.statusCode === 200) {
                    var body = JSON.parse(response.body);
                    assert.isObject(body);
                }
            });
    });
});

describe('JPMCGooglePay-SelectShippingMethod', function () {
    this.timeout(10000);

    var cookieJar = request.jar();
    var variantPid = '701643421084M';

    before(function () {
        var myRequest = {
            url: config.baseUrl + '/Cart-AddProduct',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            followRedirect: true,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            },
            form: { pid: variantPid, quantity: 1 }
        };
        return request(myRequest)
            .then(function (response) {
                // Accept 200, 301, 302 (successful response or handled redirect)
                assert.include([200, 301, 302], response.statusCode);
            });
    });

    it('should reject request without CSRF token', function () {
        var myRequest = {
            url: config.baseUrl + '/JPMCGooglePay-SelectShippingMethod',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            followRedirect: false,
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ shippingMethodId: '001' })
        };

        return request(myRequest)
            .then(function (response) {
                assert.include([301, 302, 403, 500], response.statusCode, 'CSRF rejection should redirect or error');
            });
    });

    it('should select shipping method with valid CSRF', function () {
        var myRequest = {
            url: config.baseUrl + '/CSRF-Generate',
            method: 'GET',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (csrfResponse) {
                var csrf = JSON.parse(csrfResponse.body).csrf;
                var payload = {
                    shippingMethodId: '001'
                };
                payload[csrf.tokenName] = csrf.token;
                return request({
                    url: config.baseUrl + '/JPMCGooglePay-SelectShippingMethod',
                    method: 'POST',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    simple: false,
                    jar: cookieJar,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
            })
            .then(function (response) {
                assert.include([200, 301, 302], response.statusCode);
                if (response.statusCode === 200) {
                    var body = JSON.parse(response.body);
                    assert.isObject(body);
                }
            });
    });
});

describe('JPMCGooglePay-PrepareBasket', function () {
    this.timeout(10000);

    var cookieJar = request.jar();
    var variantPid = '701643421084M';

    before(function () {
        var myRequest = {
            url: config.baseUrl + '/Cart-AddProduct',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            followRedirect: true,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            },
            form: { pid: variantPid, quantity: 1 }
        };
        return request(myRequest)
            .then(function (response) {
                // Accept 200, 301, 302 (successful response or handled redirect)
                assert.include([200, 301, 302], response.statusCode);
            });
    });

    it('should reject request without CSRF token', function () {
        var myRequest = {
            url: config.baseUrl + '/JPMCGooglePay-PrepareBasket',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            followRedirect: false,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (response) {
                assert.include([301, 302, 403, 500], response.statusCode, 'CSRF rejection should redirect or error');
            });
    });

    it('should prepare basket with valid CSRF', function () {
        var myRequest = {
            url: config.baseUrl + '/CSRF-Generate',
            method: 'GET',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (csrfResponse) {
                var csrf = JSON.parse(csrfResponse.body).csrf;
                var formData = {};
                formData[csrf.tokenName] = csrf.token;
                return request({
                    url: config.baseUrl + '/JPMCGooglePay-PrepareBasket',
                    method: 'POST',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    simple: false,
                    jar: cookieJar,
                    form: formData,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });
            })
            .then(function (response) {
                assert.include([200, 301, 302], response.statusCode);
                if (response.statusCode === 200) {
                    var body = JSON.parse(response.body);
                    assert.isObject(body);
                }
            });
    });
});

describe('JPMCGooglePay-RestoreBasket', function () {
    this.timeout(5000);

    it('should reject request without CSRF token', function () {
        var cookieJar = request.jar();
        var myRequest = {
            url: config.baseUrl + '/JPMCGooglePay-RestoreBasket',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            followRedirect: false,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (response) {
                assert.include([301, 302, 403, 500], response.statusCode, 'CSRF rejection should redirect or error');
            });
    });

    it('should restore basket with valid CSRF', function () {
        var cookieJar = request.jar();
        var myRequest = {
            url: config.baseUrl + '/CSRF-Generate',
            method: 'GET',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            simple: false,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (csrfResponse) {
                var csrf = JSON.parse(csrfResponse.body).csrf;
                var formData = {};
                formData[csrf.tokenName] = csrf.token;
                return request({
                    url: config.baseUrl + '/JPMCGooglePay-RestoreBasket',
                    method: 'POST',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    simple: false,
                    jar: cookieJar,
                    form: formData,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });
            })
            .then(function (response) {
                assert.include([200, 301, 302], response.statusCode);
                if (response.statusCode === 200) {
                    var body = JSON.parse(response.body);
                    assert.isFalse(body.error);
                }
            });
    });
});
