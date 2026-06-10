import { test, expect } from '../utils/fixtures';
import { TestData } from '../test-data/testData';
import { logStep } from '../utils/helpers';

test.describe('Guest Checkout - Negative Path', () => {
    const { urls, shippingDetails, paymentCards, products } = TestData;
    const card = paymentCards.visaCard;
    const product = products.modernSportCoat;

    test('Guest order placement shows error on failed payment', async ({
        page,
        loginPage,
        navigationPage,
        productListingPage,
        productDetailPage,
        checkoutPage,
    }) => {
        logStep('Navigate to store home page');
        await page.goto(urls.homePage, { waitUntil: 'domcontentloaded' });

        logStep('Handle tracking consent');
        await loginPage.handleConsentPopup();

        logStep(`Search and select product: ${product.name}`);
        await navigationPage.searchAndSelectProduct(product.name);

        logStep('Select size 48 and add to cart');
        await productDetailPage.verifyPDPLoaded();
        await productDetailPage.selectSizeAndAddToCart('48');

        logStep('Proceed to checkout via mini-cart');
        await navigationPage.hoverCartIcon();
        await navigationPage.clickCheckoutFromMiniCart();
        await checkoutPage.verifyUrlContains('Checkout-Begin', 20000);

        const guestEmail = 'alt.v7-5vxz0400@yopmail.com';
        logStep(`Enter guest email: ${guestEmail}`);
        await checkoutPage.enterGuestEmail(guestEmail);
        await checkoutPage.clickContinueAsGuest();
        await checkoutPage.verifyCustomerInfoEmail(guestEmail);

        logStep('Verify shipping labels and fill form');
        await checkoutPage.verifyShippingLabels();
        await checkoutPage.fillShippingForm(shippingDetails);

        logStep('Handle gift options');
        await checkoutPage.verifyGiftCheckboxDisplayed();
        await checkoutPage.clickGiftCheckbox();
        await checkoutPage.enterGiftMessage(shippingDetails.giftMessage);

        logStep('Proceed to payment step');
        await checkoutPage.clickNextPayment();
        await checkoutPage.clickAddPaymentIfVisible();

        logStep('Verify guest payment labels');
        await checkoutPage.verifyGuestPaymentFormLabels();

        logStep('Fill payment form');
        await checkoutPage.fillCheckoutPaymentForm(card.cardNumber, card.expirationMonth, card.expirationYear, card.cvv);

        logStep('Submit payment');
        await checkoutPage.clickNextPlaceOrder();

        logStep('Verify payment summary');
        await checkoutPage.verifyPaymentSummary(card.cardType, card.lastFourDigits, card.expiryDisplay);

        logStep('Click Place Order');
        await checkoutPage.clickPlaceOrder();

        logStep('Verify error message after order placement');

        const errorMessageDiv = page.locator('.error-message').first();
        const errorMessageText = page.locator('.error-message-text').first();

        // Wait for the SFRA error message div to become visible after failed Place Order
        await errorMessageDiv.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

        const hasErrorElement = await errorMessageDiv.isVisible().catch(() => false);
        const errorText = await errorMessageText.textContent().catch(() => '') ?? '';
        const hasErrorText = errorText.trim().length > 0;

        // Fallback: check body text for error keywords
        const bodyText = await page.locator('body').innerText();
        const errorPatterns = [/error/i, /failed/i, /invalid/i, /declined/i, /unsuccessful/i, /something went wrong/i, /unable to process/i, /could not be processed/i];
        const textHasError = errorPatterns.some((pattern) => pattern.test(bodyText));

        expect(hasErrorElement || hasErrorText || textHasError).toBeTruthy();
    });
});
