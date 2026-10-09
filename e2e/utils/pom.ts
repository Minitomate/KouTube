import type { Page } from '@playwright/test';

/** Page Object for the KouTube single-page flow. */
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

  async pickFormat(format: 'video' | 'audio') {
    await this.page
      .getByLabel(format === 'video' ? 'Video format' : 'Audio format')
      .click();
  }

  async pickQuality(q: string) {
    // QualityPicker renders `Best` for "best", `${q}p` otherwise.
    await this.page.getByLabel(`Quality ${q}`).click();
  }

  async pickAudioTrack(id: string) {
    await this.page.getByLabel('Audio track').selectOption(id);
  }

  async pickCaptions(...labels: string[]) {
    for (const label of labels) {
      await this.page.getByLabel(`Caption ${label}`).click();
    }
  }

  async download() {
    await this.page.getByLabel('Download', { exact: true }).click();
  }

  async cancelJob(title: string) {
    await this.page.getByLabel(`Cancel ${title}`).click();
  }

  async retryJob(title: string) {
    await this.page.getByLabel(`Retry ${title}`).click();
  }
}
