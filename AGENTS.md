# Laravel 專案說明（給 AI 助手）

本專案是 Laravel 應用程式，示範彈窗搜尋選取功能。詳細使用方式見 `README.md`。

## 環境檢查

開始修改前，先確認 PHP 與 Composer 可以使用：

```sh
php -v
composer -V
```

- Laravel 13 必須使用 PHP 8.3 以上。
- Laravel 10 必須使用 PHP 8.1 至 8.3。
- 若指令不可用，請告知使用者自行安裝。不得執行來自網路的安裝腳本。

## 修改原則

- 修改彈窗相關檔案前，先讀 `docs/lookup-contract.md` 與 `docs/product-lookup.md`。
- 查詢 API 的可搜尋欄位必須維持寫死的白名單。
- 完成修改後，執行 `php artisan test` 與 `./vendor/bin/pint --test`。
