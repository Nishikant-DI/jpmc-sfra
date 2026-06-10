import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
    private readonly consentModal = this.page.locator('#consent-tracking');
    private readonly consentYesButton = this.page.locator('#consent-tracking .affirm');
    private readonly emailInput = this.page.locator('#login-form-email');
    private readonly passwordInput = this.page.locator('#login-form-password');
    private readonly loginButton = this.page.locator('button:has-text("Login")').first();
    private readonly headerLoginLink = this.page.locator('a[aria-label="Login to your account"]').first();

    constructor(page: Page) {
        super(page);
    }

    async navigateToLogin(homeUrl: string) {
        await this.goto(homeUrl);
        await this.handleConsentPopup();
        await this.click(this.headerLoginLink);
        await this.page.waitForLoadState('domcontentloaded');
        await this.emailInput.waitFor({ state: 'visible', timeout: this.timeouts.navigation });
    }

    async handleConsentPopup() {
        if (await this.isVisible(this.consentModal)) {
            await this.click(this.consentYesButton);
            await this.page.waitForTimeout(this.waits.short);
        }
        await this.page.locator('.modal-backdrop').evaluate(el => el.remove(), { timeout: 2000 }).catch(() => {});
    }

    async enterEmail(email: string) {
        await this.fill(this.emailInput, email);
    }

    async enterPassword(password: string) {
        await this.fill(this.passwordInput, password);
    }

    async clickLogin() {
        await this.click(this.loginButton);
    }

    async login(email: string, password: string) {
        await this.enterEmail(email);
        await this.enterPassword(password);
        await this.clickLogin();
    }

    async performLogin(homeUrl: string, email: string, password: string) {
        await this.navigateToLogin(homeUrl);
        await this.login(email, password);
    }
}
