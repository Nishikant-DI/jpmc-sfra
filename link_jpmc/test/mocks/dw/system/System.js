'use strict';

var systemPreferences = {
    jpmcRealmId: undefined
};

/**
 * Mock for dw.system.System
 */
function System() {}

System.getPreferences = function () {
    return {
        getCustom: function () {
            return systemPreferences;
        }
    };
};

/**
 * Helper to set mock preferences for testing
 * @param {Object} prefs - Preferences object
 */
System.setMockPreferences = function (prefs) {
    systemPreferences = prefs || {};
};

/**
 * Helper to reset preferences
 */
System.resetMockPreferences = function () {
    systemPreferences = {
        jpmcRealmId: undefined
    };
};

module.exports = System;
