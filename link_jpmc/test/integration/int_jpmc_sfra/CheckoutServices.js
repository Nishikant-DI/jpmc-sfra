'use strict';

var assert = require('chai').assert;
var request = require('request-promise');
var config = require('../it.config');

describe('CheckoutServices-Fail3DSOrder', function () {
    this.timeout(10000);

    it('should reject request without CSRF token', function () {
        var cookieJar = request.jar();
        var myRequest = {
            url: config.baseUrl + '/CheckoutServices-Fail3DSOrder',
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

    it('should return error for missing order with valid CSRF', function () {
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
                    url: config.baseUrl + '/CheckoutServices-Fail3DSOrder',
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
                if (response.statusCode === 200) {
                    var body = JSON.parse(response.body);
                    assert.isTrue(body.error);
                } else {
                    assert.include([301, 302, 500], response.statusCode);
                }
            });
    });
});
