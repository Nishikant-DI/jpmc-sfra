'use strict';

var currentPreferences = {};
var defaultCurrency = 'USD';
var currentSite = null;

/**
 * Mock for dw.system.Site
 */
function Site() {}

Site.getCurrent = function () {
    if (!currentSite) {
        currentSite = {
            getPreferences: function () {
                return {
                    getCustom: function () {
                        return currentPreferences;
                    }
                };
            },
            getID: function () {
                return 'RefArch';
            },
            getDefaultCurrency: function () {
                return defaultCurrency;
            }
        };
    }
    return currentSite;
};

/**
 * Helper to set mock preferences for testing
 * @param {Object} prefs - Preferences object
 */
Site.setMockPreferences = function (prefs) {
    currentPreferences = prefs || {};
};

/**
 * Helper to set default currency
 * @param {String} currency - Currency code
 */
Site.setDefaultCurrency = function (currency) {
    defaultCurrency = currency;
};

/**
 * Helper to reset preferences
 */
Site.resetMockPreferences = function () {
    currentPreferences = {};
    defaultCurrency = 'USD';
};

/**
 * Alias for resetMockPreferences
 */
Site.reset = function () {
    currentPreferences = {};
    defaultCurrency = 'USD';
    currentSite = null;
};

module.exports = Site;
