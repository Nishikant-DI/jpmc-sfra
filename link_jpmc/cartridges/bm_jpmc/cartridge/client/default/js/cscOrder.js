'use strict';

/**
 * JPMC CSC Order — vanilla JS validation for capture & refund forms.
 * No jQuery dependency. Provides:
 *  - Amount format validation (regex, >0, <=max)
 *  - "Full Amount" checkbox toggle (disables input)
 *  - Double-submit prevention (disables button after first click)
 */
(function () {
    var AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

    /**
     * Parse a dollar string to a float, returning 0 for invalid input.
     * @param {string} val - Dollar string
     * @returns {number} Parsed dollar amount or 0
     */
    function parseDollars(val) {
        var n = parseFloat(val);
        return Number.isNaN(n) ? 0 : n;
    }

    /**
     * Extract max amount from placeholder text (e.g. "Max: 125.50" → 125.50).
     * @param {HTMLInputElement} input - The amount input element
     * @returns {number} Max dollar amount from placeholder
     */
    function getMaxFromPlaceholder(input) {
        var placeholder = input.getAttribute('placeholder') || '';
        return parseDollars(placeholder.replace(/[^0-9.]/g, ''));
    }

    /* eslint-disable no-param-reassign */
    /**
     * Show an inline error next to an input.
     * @param {HTMLInputElement} input - The input element
     * @param {HTMLElement} errorEl - The error span
     * @param {string} msg - Error message
     */
    function showError(input, errorEl, msg) {
        input.style.borderColor = 'red';
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    }

    /**
     * Clear an inline error.
     * @param {HTMLInputElement} input - The input element
     * @param {HTMLElement} errorEl - The error span
     */
    function clearError(input, errorEl) {
        input.style.borderColor = '';
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }
    /* eslint-enable no-param-reassign */

    /**
     * Validate an amount form on submit.
     * @param {HTMLFormElement} form - The form
     * @param {string} inputId - Amount input element ID
     * @param {string} errorId - Error span element ID
     * @param {string} checkboxId - Full-amount checkbox ID
     * @param {string} exceedsLabel - Label for "exceeds max" error
     * @returns {boolean} True if valid
     */
    function validateAmountForm(form, inputId, errorId, checkboxId, exceedsLabel) {
        var input = form.querySelector('#' + inputId);
        var errorEl = form.querySelector('#' + errorId);
        var checkbox = form.querySelector('#' + checkboxId);

        if (!input || !errorEl) return true;

        clearError(input, errorEl);

        // Full amount — clear input so server uses remaining
        if (checkbox && checkbox.checked) {
            input.value = '';
            return true;
        }

        var value = (input.value || '').replace(/^\s+|\s+$/g, '');

        if (!value || !AMOUNT_REGEX.test(value)) {
            showError(input, errorEl, 'Enter a valid dollar amount (e.g. 10.00).');
            return false;
        }

        var dollars = parseDollars(value);
        if (dollars <= 0) {
            showError(input, errorEl, 'Amount must be greater than zero.');
            return false;
        }

        var maxAmount = getMaxFromPlaceholder(input);
        if (maxAmount > 0 && dollars > maxAmount) {
            showError(input, errorEl, exceedsLabel + ' ($' + maxAmount.toFixed(2) + ').');
            return false;
        }

        return true;
    }

    /**
     * Wire up a full-amount checkbox to toggle the amount input.
     * @param {string} checkboxId - Checkbox element ID
     * @param {string} inputId - Amount input element ID
     * @param {string} errorId - Error span element ID
     */
    function wireCheckbox(checkboxId, inputId, errorId) {
        var checkbox = document.getElementById(checkboxId);
        var input = document.getElementById(inputId);
        var errorEl = document.getElementById(errorId);

        if (!checkbox || !input) return;

        checkbox.addEventListener('change', function () {
            if (checkbox.checked) {
                input.value = '';
                input.disabled = true;
                if (errorEl) clearError(input, errorEl);
            } else {
                input.disabled = false;
            }
        });
    }

    /**
     * Disable submit button after first valid submission to prevent double-submit.
     * @param {HTMLFormElement} form - The form element
     */
    function preventDoubleSubmit(form) {
        var btn = form.querySelector('button[type="submit"]');
        if (btn) {
            btn.disabled = true;
            btn.textContent += '...';
        }
    }

    // ----------------------------------------------------------------
    // Capture form
    // ----------------------------------------------------------------
    var captureForm = document.getElementById('jpmc-capture-form');
    if (captureForm) {
        var finalCaptureCheckbox = document.getElementById('isFinalCapture');

        captureForm.addEventListener('submit', function (e) {
            var isValid = validateAmountForm(
                captureForm,
                'captureAmount',
                'captureError',
                'captureFullAmount',
                'Amount exceeds remaining authorized amount'
            );
            if (!isValid) {
                e.preventDefault();
                return;
            }
            // If "Capture Full Amount" is checked, it is implicitly final
            var fullAmountCb = document.getElementById('captureFullAmount');
            if (fullAmountCb && fullAmountCb.checked && finalCaptureCheckbox) {
                finalCaptureCheckbox.checked = true;
            }
            preventDoubleSubmit(captureForm);
        });

        wireCheckbox('captureFullAmount', 'captureAmount', 'captureError');

        // When "Capture Full Amount" is toggled, auto-check/uncheck "Final capture"
        var fullAmountCb = document.getElementById('captureFullAmount');
        if (fullAmountCb && finalCaptureCheckbox) {
            fullAmountCb.addEventListener('change', function () {
                if (fullAmountCb.checked) {
                    finalCaptureCheckbox.checked = true;
                    finalCaptureCheckbox.disabled = true;
                } else {
                    finalCaptureCheckbox.disabled = false;
                }
            });
        }
    }

    // ----------------------------------------------------------------
    // Refund form (standalone — single capture / AC / delayed)
    // ----------------------------------------------------------------
    var refundForm = document.getElementById('jpmc-refund-form');
    if (refundForm) {
        refundForm.addEventListener('submit', function (e) {
            var isValid = validateAmountForm(
                refundForm,
                'refundAmount',
                'refundError',
                'refundFullAmount',
                'Amount exceeds remaining refundable amount'
            );
            if (!isValid) {
                e.preventDefault();
                return;
            }
            preventDoubleSubmit(refundForm);
        });

        wireCheckbox('refundFullAmount', 'refundAmount', 'refundError');
    }

    // ----------------------------------------------------------------
    // Per-capture refund forms (inside capture history table)
    // ----------------------------------------------------------------
    var captureRefundForms = document.querySelectorAll('.csc-capture-refund-form');
    for (var idx = 0; idx < captureRefundForms.length; idx++) {
        (function (form) {
            var input = form.querySelector('input[name="amountIntroduced"]');
            var errorEl = form.querySelector('.csc-capture-refund-error');
            var fullCb = form.querySelector('.csc-capture-full-refund');

            // Wire up the full-refund checkbox toggle
            if (fullCb && input) {
                fullCb.addEventListener('change', function () {
                    if (fullCb.checked) {
                        input.value = '';
                        input.disabled = true;
                        if (errorEl) clearError(input, errorEl);
                    } else {
                        input.disabled = false;
                    }
                });
            }

            form.addEventListener('submit', function (e) {
                if (!input || !errorEl) return;

                clearError(input, errorEl);

                // Full refund checkbox checked — clear input so server uses remaining
                if (fullCb && fullCb.checked) {
                    input.value = '';
                    preventDoubleSubmit(form);
                    return;
                }

                var value = (input.value || '').replace(/^\s+|\s+$/g, '');

                // Empty = full refund of this capture's remaining
                if (!value) {
                    preventDoubleSubmit(form);
                    return;
                }

                if (!AMOUNT_REGEX.test(value)) {
                    showError(input, errorEl, 'Enter a valid dollar amount (e.g. 10.00).');
                    e.preventDefault();
                    return;
                }

                var dollars = parseDollars(value);
                if (dollars <= 0) {
                    showError(input, errorEl, 'Amount must be greater than zero.');
                    e.preventDefault();
                    return;
                }

                var maxAmount = getMaxFromPlaceholder(input);
                if (maxAmount > 0 && dollars > maxAmount) {
                    showError(input, errorEl, 'Exceeds refundable ($' + maxAmount.toFixed(2) + ').');
                    e.preventDefault();
                    return;
                }

                preventDoubleSubmit(form);
            });
        }(captureRefundForms[idx]));
    }

    // ----------------------------------------------------------------
    // Void form
    // ----------------------------------------------------------------
    var voidForm = document.getElementById('jpmc-void-form');
    if (voidForm) {
        voidForm.addEventListener('submit', function (e) {
            // eslint-disable-next-line no-alert
            var confirmed = window.confirm(
                'Are you sure you want to void the remaining authorization? This action cannot be undone.'
            );
            if (!confirmed) {
                e.preventDefault();
                return;
            }
            preventDoubleSubmit(voidForm);
        });
    }
}());
