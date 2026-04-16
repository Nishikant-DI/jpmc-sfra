'use strict';

var processInclude = require('base/util');

$(document).ready(function () {
    processInclude(require('base/cart/cart'));
    processInclude(require('./jpmc/googlePay'));
});
