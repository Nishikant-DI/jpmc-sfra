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
            jar: cookieJar,
            followRedirect: false,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function () {
                assert.fail('Expected CSRF rejection');
            })
            .catch(function (err) {
                assert.include([302, 403, 500], err.statusCode);
            });
    });

    it('should return error for missing order with valid CSRF', function () {
        var cookieJar = request.jar();
        var myRequest = {
            url: config.baseUrl + '/CSRF-Generate',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(myRequest)
            .then(function (csrfResponse) {
                var csrf = JSON.parse(csrfResponse.body).csrf;
                return request({
                    url: config.baseUrl + '/CheckoutServices-Fail3DSOrder?'
                        + csrf.tokenName + '=' + csrf.token,
                    method: 'POST',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    jar: cookieJar,
                    followRedirect: false,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });
            })
            .then(function (response) {
                assert.equal(response.statusCode, 200);
                var body = JSON.parse(response.body);
                assert.isTrue(body.error);
            })
            .catch(function (err) {
                // Controller may redirect when no valid order exists
                if (err.statusCode) {
                    assert.include([302, 500], err.statusCode);
                } else {
                    throw err;
                }
            });
    });
});
