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

test('閲覧履歴を記録し、オフにすると履歴タブを隠す', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('button[data-thumb-id]');
  await expect(cards.first()).toBeVisible();
  await cards.first().click();

  const lightbox = page.getByRole('dialog', { name: '画像ビューア' });
  await expect(lightbox).toBeVisible();
  await lightbox.getByRole('button', { name: '閉じる' }).click();
  await expect(lightbox).toBeHidden();

  await expect
    .poll(async () => {
      const response = await page.request.get('/api/history?limit=60');
      const body = (await response.json()) as { items?: unknown[] };
      return body.items?.length ?? 0;
    })
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(page.locator('button[data-thumb-id]').first()).toBeVisible();

  await page.getByRole('button', { name: '設定', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '設定' });
  await settings.getByRole('button', { name: '操作設定' }).click();
  const keepHistory = settings.getByRole('switch', { name: '閲覧履歴を残す' });
  await expect(keepHistory).toHaveAttribute('aria-checked', 'true');
  await keepHistory.click();
  await expect(keepHistory).toHaveAttribute('aria-checked', 'false');
  await settings.getByRole('button', { name: '閉じる' }).first().click();

  await expect(page.getByRole('button', { name: '履歴', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'ファイル' })).toBeVisible();
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

test('フォルダ棚で1行表示と全件表示を切り替えられる', async ({ page }) => {
  await page.goto('/');
  const toolbar = page.locator('[data-folder-toolbar]');
  const oneRow = page.getByRole('button', { name: '1行で表示' });
  const showAll = page.getByRole('button', { name: 'すべて表示' });
  const row = page.locator('#folder-tiles');
  const libraryTile = page.getByTitle('E2E Images');
  await expect(toolbar).toHaveCSS('position', 'sticky');
  await expect(page.getByRole('heading', { name: 'フォルダ' })).toBeVisible();
  await expect(oneRow).toHaveAttribute('aria-pressed', 'true');
  await expect(showAll).toHaveAttribute('aria-pressed', 'false');
  await expect(row).toHaveCSS('display', 'flex');
  await expect(libraryTile).toBeVisible();

  await showAll.click();
  await expect(showAll).toHaveAttribute('aria-pressed', 'true');
  await expect(oneRow).toHaveAttribute('aria-pressed', 'false');
  await expect(row).toHaveCSS('display', 'grid');
  await expect(libraryTile).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ファイル' })).toBeVisible();

  const scrollBeforeCollapse = await page.evaluate(() => window.scrollY);
  await oneRow.click();
  await expect(oneRow).toHaveAttribute('aria-pressed', 'true');
  await expect(showAll).toHaveAttribute('aria-pressed', 'false');
  await expect(row).toHaveCSS('display', 'flex');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeCollapse);
});

test('1行表示のフォルダ棚をホイールで横スクロールできる', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: '1行で表示' }).click();
  const row = page.locator('#folder-tiles');
  const metrics = await row.evaluate((el) => {
    const tile = el.querySelector('button');
    if (!tile) return null;
    for (let i = 0; i < 6; i += 1) el.appendChild(tile.cloneNode(true));
    (el as HTMLElement).scrollLeft = 0;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(metrics).not.toBeNull();
  expect(metrics!.scrollWidth).toBeGreaterThan(metrics!.clientWidth);

  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 100, box!.y + 50);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(() => row.evaluate((el) => (el as HTMLElement).scrollLeft))
    .toBeGreaterThan(0);
});

test('フォルダタイルの既定の形が正方形で展開表示に反映される', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'すべて表示' }).click();

  const tile = page.getByTitle('E2E Images');
  await expect(tile).toBeVisible();
  const box = await tile.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width / box!.height - 1)).toBeLessThan(0.05);
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
