'use strict';

var assert = require('chai').assert;
var request = require('request-promise');
var config = require('../it.config');

describe('AccountUpdater-Notify', function () {
    this.timeout(5000);

    it('should reject request without valid auth credentials', function () {
        var myRequest = {
            url: config.baseUrl + '/AccountUpdater-Notify',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                notificationType: 'CARD_UPDATED',
                data: { oldToken: 'old123', newToken: 'new456' }
            })
        };

        return request(myRequest)
            .then(function (response) {
                // If server returns 200 with error flag
                assert.equal(response.statusCode, 200);
                var body = JSON.parse(response.body);
                assert.isTrue(body.error);
            })
            .catch(function (err) {
                // If server returns 401 directly
                assert.equal(err.statusCode, 401);
                var body = JSON.parse(err.response.body);
                assert.property(body, 'error');
            });
    });

    it('should reject request with invalid Basic auth', function () {
        var myRequest = {
            url: config.baseUrl + '/AccountUpdater-Notify',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from('wrong:creds').toString('base64')
            },
            body: JSON.stringify({
                notificationType: 'CARD_UPDATED',
                data: { oldToken: 'old123', newToken: 'new456' }
            })
        };

        return request(myRequest)
            .then(function (response) {
                // If server returns 200 with error flag
                assert.equal(response.statusCode, 200);
                var body = JSON.parse(response.body);
                assert.isTrue(body.error);
            })
            .catch(function (err) {
                // If server returns 401 directly
                assert.equal(err.statusCode, 401);
                var body = JSON.parse(err.response.body);
                assert.property(body, 'error');
            });
    });
});
