'use strict';

/**
 * Mock for dw.object.CustomObjectMgr
 */
var customObjects = {};

function CustomObject(type, keyValue) {
    this.type = type;
    this.keyValue = keyValue;
    this.custom = {};
}

function CustomObjectMgr() {}

CustomObjectMgr.getCustomObject = function (type, keyValue) {
    var key = type + '::' + keyValue;
    return customObjects[key] || null;
};

CustomObjectMgr.createCustomObject = function (type, keyValue) {
    var key = type + '::' + keyValue;
    var co = new CustomObject(type, keyValue);
    customObjects[key] = co;
    return co;
};

CustomObjectMgr.remove = function (customObject) {
    if (!customObject) return;
    var key = customObject.type + '::' + customObject.keyValue;
    delete customObjects[key];
};

CustomObjectMgr.getAllCustomObjects = function (type) {
    var results = [];
    Object.keys(customObjects).forEach(function (key) {
        if (customObjects[key].type === type) {
            results.push(customObjects[key]);
        }
    });
    return results;
};

/**
 * Helper to reset all custom objects
 */
CustomObjectMgr.resetAllCustomObjects = function () {
    customObjects = {};
};

/**
 * Helper to get custom objects for testing
 */
CustomObjectMgr.getMockCustomObjects = function () {
    return customObjects;
};

module.exports = CustomObjectMgr;
