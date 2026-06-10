import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class NavigationPage extends BasePage {
    private readonly newArrivalsMenu = this.page.locator('button:has-text("New Arrivals"), a:has-text("New Arrivals")').first();

    constructor(page: Page) {
        super(page);
    }

    async hoverNewArrivals() {
        await this.newArrivalsMenu.hover();
    }

    async clickNavItem(label: string) {
        await this.page.locator(`a:has-text("${label}"), button:has-text("${label}")`).first().click();
    }

    async hoverAndSelectCategory(topMenu: string, subCategory: string) {
        const topItem = this.page.locator(`button:has-text("${topMenu}"), a:has-text("${topMenu}")`).first();
        await topItem.hover();
        await this.page.waitForTimeout(this.waits.short);
        const subItem = this.page.getByText(subCategory, { exact: true }).first();
        await subItem.waitFor({ state: 'visible', timeout: this.timeouts.action });
        await subItem.click();
    }

    async searchAndSelectProduct(productName: string) {
        const searchInput = this.page.locator('input.search-field').first();
        await searchInput.click();
        await searchInput.fill(productName);
        await this.page.waitForTimeout(this.waits.medium);

        const suggestion = this.page.locator(`.suggestions .item a[aria-label="${productName}"]`).first();
        await suggestion.waitFor({ state: 'visible', timeout: this.timeouts.action });
        await suggestion.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async hoverCartIcon() {
        const minicart = this.page.locator('.minicart').first();
        await minicart.hover();
        await this.page.waitForTimeout(this.waits.medium);
    }

    async clickCheckoutFromMiniCart() {
        const checkoutBtn = this.page.locator('[class*="checkout-btn"], a:has-text("Checkout")').first();
        await checkoutBtn.waitFor({ state: 'visible', timeout: this.timeouts.action });
        await checkoutBtn.click();
    }
}
