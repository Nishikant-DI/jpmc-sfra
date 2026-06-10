import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProductDetailPage extends BasePage {
    private readonly addToCartButton = this.page.locator('button.add-to-cart, button:has-text("Add to Cart")').first();

    constructor(page: Page) {
        super(page);
    }

    async verifyPDPLoaded() {
        await this.page.waitForLoadState('domcontentloaded');
        await this.addToCartButton.waitFor({ state: 'visible', timeout: this.timeouts.action });
    }

    async selectSize(size: string) {
        const sizeDropdown = this.page.locator('select[id*="Size"], select[id*="size"]').first();
        if (await sizeDropdown.isVisible()) {
            await sizeDropdown.selectOption(size);
        } else {
            const sizeBtn = this.page.locator(`[data-attr-value="${size}"], button:has-text("${size}"), .size-btn:has-text("${size}")`).first();
            await sizeBtn.click();
        }
    }

    async clickAddToCart() {
        await this.addToCartButton.waitFor({ state: 'visible', timeout: this.timeouts.action });
        await this.addToCartButton.click();
        await this.page.waitForTimeout(this.waits.medium);
    }

    async selectSizeAndAddToCart(size: string) {
        await this.selectSize(size);
        await this.clickAddToCart();
    }
}
