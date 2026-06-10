import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class DashboardPage extends BasePage {
    private readonly dashboardHeading = this.page.locator('h1, h2').filter({ hasText: 'Dashboard' });
    private readonly addNewPaymentLink = this.page.locator('a[href*="PaymentInstruments-AddPayment"]');

    constructor(page: Page) {
        super(page);
    }

    async verifyDashboard() {
        await this.verifyUrlContains('account');
        await this.verifyElementVisible(this.dashboardHeading);
    }

    async clickAddNewPayment() {
        await this.click(this.addNewPaymentLink);
    }
}
