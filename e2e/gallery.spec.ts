import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await expect
    .poll(
      async () => {
        const response = await request.get('/api/items?limit=10');
        if (!response.ok()) return 0;
        const body = (await response.json()) as { items?: unknown[] };
        return body.items?.length ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(4);
});

test('ギャラリーからライトボックスを開き、前後に移動して閉じる', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('button[data-thumb-id]');
  await expect(cards).toHaveCount(4);

  await cards.first().click();
  const lightbox = page.getByRole('dialog', { name: '画像ビューア' });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByText('1 / 4')).toBeVisible();

  await lightbox.getByRole('button', { name: '次へ' }).click();
  await expect(lightbox.getByText('2 / 4')).toBeVisible();

  await lightbox.getByRole('button', { name: '閉じる' }).click();
  await expect(lightbox).toBeHidden();
});

test('フォルダ一覧の代表サムネイルが読み込まれ、TOPへ戻っても欠けない', async ({
  page,
}) => {
  await page.goto('/');
  const libraryTile = page.getByTitle('E2E Images');
  await expect(libraryTile).toBeVisible();
  await expect
    .poll(() => libraryTile.locator('img').evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(0);

  await libraryTile.click();
  await expect(page.locator('button[data-thumb-id]')).toHaveCount(4);
  await page.locator('header h1 button').click();
  await expect(page.getByTitle('E2E Images')).toBeVisible();

  const images = page.locator('button[data-thumb-id] img');
  await expect(images).toHaveCount(4);
  await expect
    .poll(
      () =>
        images.evaluateAll((nodes) =>
          nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
});

test('システム設定からサムネイルキャッシュ上限を保存できる', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('button[data-thumb-id]').first()).toBeVisible();

  await page.getByRole('button', { name: '設定', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '設定' });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'システム' }).click();

  const lanToggle = settings.getByRole('switch', { name: 'ローカルネットワーク内に公開' });
  const portInput = settings.getByLabel('ポート');
  await expect(portInput).toBeDisabled();
  await lanToggle.click();
  await expect(portInput).toBeEnabled();

  await expect(settings.getByText('サムネイルキャッシュ')).toBeVisible();
  const maxInput = settings.getByLabel(/上限 \(MB\)/);
  await maxInput.fill('256');
  await settings.getByRole('button', { name: 'キャッシュ設定を保存' }).click();
  await expect(settings.getByText(/保存しました/)).toBeVisible();

  await settings.getByRole('button', { name: '閉じる' }).first().click();
  await expect(settings).toBeHidden();
});
