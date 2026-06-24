'use strict';

var server = require('server');

// Extend base Cart controller
server.extend(module.superModule);

/**
 * Cart-MiniCartShow : Append to add miniCart flag to view data
 * @name Base/Cart-MiniCartShow
 * @function
 * @memberof Cart
 * @param {middleware} - server.middleware.include
 * @param {serverfunction} - append
 */
server.append('MiniCartShow', function (req, res, next) {
    // Add miniCart flag to indicate this is the mini cart
    var viewData = res.getViewData();
    viewData.miniCart = true;
    res.setViewData(viewData);
    next();
});

module.exports = server.exports();
