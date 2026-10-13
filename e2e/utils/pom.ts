import type { Page } from '@playwright/test';

/** Page Object for the KouTube single-page flow (user-end transfers, no jobs). */
export class KouTubePage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto('/');
  }

  async pasteUrl(url: string) {
    await this.page.getByLabel('YouTube URL').fill(url);
  }

  async inspect() {
    await this.page.getByLabel('Inspect video').click();
  }

  async clearLink() {
    await this.page.getByLabel('Clear link').click();
  }

  async inspectUrl(url: string) {
    await this.pasteUrl(url);
    await this.inspect();
  }

  async pickFormat(format: 'video' | 'audio' | 'captions') {
    await this.page
      .getByLabel(format === 'video' ? 'Video format' : format === 'audio' ? 'Audio format' : 'Captions format')
      .click();
  }

  /** Reveal advanced controls (idempotent — safe when already expanded). */
  async advanced() {
    const sw = this.page.getByRole('switch', { name: /show advanced/i });
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  }

  async pickQuality(q: string) {
    // SingleDropdown (custom listbox, button id md-quality*): options read
    // like '720p' / 'Best'. The open panel is unique; Escape closes it.
    await this.pickSingle('quality', q === 'best' ? 'Best' : new RegExp(`${q}p`, 'i'));
  }

  /** Pick an option from a SingleDropdown by button-id stem + option name. */
  async pickSingle(idStem: string, option: string | RegExp) {
    await this.page.locator(`[aria-labelledby^="md-${idStem}"]`).click();
    await this.page.locator('.md-panel').getByRole('option', { name: option }).click();
  }

  async pickAudioTrack(id: string) {
    // DownloadOptionsCard audio is a MultiDropdown (button id md-audio-tracks).
    // Scope to the open panel: native quality <option>s also match loosely.
    await this.page.locator('[aria-labelledby="md-audio-tracks"]').click();
    await this.page.locator('.md-panel').getByRole('option', { name: new RegExp(id, 'i') }).click();
    await this.page.keyboard.press('Escape');
  }

  async pickCaptions(...labels: string[]) {
    await this.page.locator('[aria-labelledby="md-captions"]').click();
    for (const label of labels) {
      await this.page.locator('.md-panel').getByRole('option', { name: new RegExp(label, 'i') }).click();
    }
    await this.page.keyboard.press('Escape');
  }

  async download() {
    await this.page.getByLabel('Download', { exact: true }).click();
  }

  async downloadZip() {
    await this.page.getByRole('button', { name: 'Download ZIP' }).click();
  }

  async cancelDownload() {
    await this.page.getByLabel('Cancel download').click();
  }
}
