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
    await this.page.getByRole('checkbox', { name: /show advanced/i }).check();
  }

  async pickQuality(q: string) {
    // DownloadOptionsCard renders Quality as a native select.
    await this.page.getByLabel('Quality').selectOption(q);
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
