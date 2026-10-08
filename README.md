# 彈窗搜尋選取示範（Laravel）

本專案示範 Laravel 的彈窗搜尋選取功能，包含單選、複選與延遲載入。

## 術語

- **Lookup**：彈窗搜尋元件。用於欄位的單選與複選。
- **ProductLookup**：產品快速輸入元件。用於明細列輸入產品編號。
- **單選**：一次選取一筆。
- **複選**：一次勾選多筆，按確認後一併寫回。
- **延遲載入**：捲到結果表底部時，自動載入下一頁。
- **確認區塊**：彈窗底部列出已勾選產品的區塊。按確認後才寫回明細。
- **白名單**：後端允許查詢的欄位與運算子清單。清單外的請求會被拒絕。

## 狀態

| 功能 | 狀態 | 驗證 |
|---|---|---|
| 客戶單選（Lookup，延遲載入） | 已完成，未驗證 | 未驗證：瀏覽器操作客戶彈窗。 |
| 批次選取產品（Lookup 複選） | 已完成，未驗證 | 未驗證：瀏覽器操作。已驗證：頁面渲染與 API 回應。 |
| ProductLookup 單選、複選、延遲載入 | 已完成 | 已驗證：瀏覽器端對端 25 項（Chromium，500 筆產品）。 |
| 全部 PHP 功能 | 已完成 | 已驗證：PHPUnit 31 項，Laravel 13 與 Laravel 10 皆通過。 |
| 進階搜尋引擎 | 未做 | 不在本示範範圍內。 |

## 版本需求

- **Laravel 13**：必須使用 PHP 8.3 以上。
- **Laravel 10**：必須使用 PHP 8.1 至 8.3。
- 前端以 CDN 載入 jQuery 3.7.1、Select2 4.0.13、Bootstrap 5.3.3。執行 npm 不是必要步驟。

## 安裝與啟動

1. 執行 `composer install`。
2. 執行 `cp .env.example .env`。若已有 `.env`，略過此步。
3. 執行 `php artisan key:generate`。若已有 `APP_KEY`，略過此步。
4. 執行 `touch database/database.sqlite`。若檔案已存在，略過此步。
5. 執行 `php artisan migrate:fresh --seed`。
6. 執行 `php artisan serve`。
7. 開啟 http://127.0.0.1:8000 。系統導到訂單列表。點「新增訂單」開始試用。

```bash
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate:fresh --seed
php artisan serve
```

示範資料：

- 客戶 30 筆。C026～C030 停用，不出現在彈窗。
- 產品 500 筆。P498～P500 停用，輸入這些編號時查無。

## 試用步驟

### 客戶（Lookup 單選）

1. 點「客戶」欄位，開啟彈窗。
2. 捲到結果表底部，下一頁自動載入。
3. 點選一列，客戶寫回欄位。

### 批次選取產品（Lookup 複選）

1. 點「批次選取產品」，開啟彈窗。
2. 勾選一筆或多筆產品。「全選已載入」只勾選目前已載入的列。
3. 點「加入明細」。每個產品新增一列明細。筆數多時，系統分段寫入，並顯示進度。

### 產品快速輸入（ProductLookup）

1. 在產品編號欄輸入 `P005`，按 Enter。系統直接帶入「示範產品 5」。
2. 輸入 `P999`，按 Enter。查無時，系統開啟彈窗，並以「產品編號 包含 P999」查詢。
3. 在結果表勾選一筆或多筆產品。捲到底，下一頁自動載入。
4. 在確認區塊檢查已選產品。按 ✕ 可移除一筆。
5. 按「加入 N 筆」。第一筆填入目前列，其餘各新增一列。

補充說明：

- 按 ↓ 可在編號欄新增一列明細。
- 彈窗的「欄位／運算子／值」可搜尋產品編號、產品名稱與單價。
- 複選時，雙擊結果列不會送出，避免誤觸。

## 測試

```bash
php artisan test
```

共 31 項。瀏覽器端對端測試腳本不在本 repo 內。

## 專案結構

| 檔案 | 用途 |
|---|---|
| `public/js/lookup.js` | Lookup 核心，支援單選、複選（`multiple`）與延遲載入（`infiniteScroll`）。 |
| `public/js/product-batch-lookup.js` | 批次選取產品，把複選結果分段寫入明細列。 |
| `public/js/product-lookup.js` | ProductLookup，`ProductLookup.init()` 設定明細列。 |
| `resources/views/components/backend/lookup-modal.blade.php` | Lookup 彈窗骨架。 |
| `resources/views/components/backend/product/lookup-modal.blade.php` | ProductLookup 彈窗骨架。 |
| `app/Traits/LookupResponseTrait.php` | 後端查詢共用回應，提供篩選與分頁。 |
| `app/Http/Controllers/LookupController.php` | 客戶查詢 API。 |
| `app/Http/Controllers/ProductLookupController.php` | 產品的四支 API，含可搜尋欄位白名單。 |
| `resources/views/orders/create.blade.php` | 使用範例：單選、複選與明細列。 |
| `docs/lookup-contract.md` | Lookup 完整規格。 |
| `docs/product-lookup.md` | ProductLookup 完整規格。 |

## 導入到自己的頁面

### Lookup（單選）

1. 在 `</form>` 之後放一次 `<x-backend.lookup-modal />`。每頁一個。
2. 目標欄位使用 `<select name="xxx">`，並包含一個空白選項。
3. 寫查詢 API（參考 `LookupController`），並在 `routes/web.php` 註冊路由。
4. 載入 `lookup.js`，呼叫 `Lookup.attach()`。
5. 要延遲載入時，加上 `infiniteScroll: true`。

### Lookup（複選，批次選取）

1. 放一個觸發按鈕。本示範使用 `.batch-add-products`。
2. 呼叫 `ProductBatchLookup.attach()`。範例見 `orders/create.blade.php`。
3. 傳入查詢 API、明細區塊與新增列按鈕。
4. 若目標欄位是 `<select multiple>`，用 `Lookup.attach()` 加上 `multiple: true`。
5. 規格見 `docs/lookup-contract.md` 的「複選模式」。

### ProductLookup

1. 在 `</form>` 之後放一次 `<x-backend.product.lookup-modal />`。
2. 載入 `product-lookup.js`，呼叫 `ProductLookup.init()`。範例見 `orders/create.blade.php`。
3. 傳入四支 API 的網址與明細列的選擇器。
4. 要複選時，設定 `multiple: true`。
5. 複選必須同時設定 `addRowSelector`。未設定時，只填入第一筆。
6. 延遲載入的預設值是 `true`。要關閉時，設定 `infiniteScroll: false`。
7. 後端提供四支 API：精確查詢（`info`）、分頁查詢（`lookup`）、欄位 metadata，以及遠端選項。參考 `ProductLookupController`。

## 安全規則

- 必須把查詢 API 的可搜尋欄位與運算子寫死在程式碼中（白名單）。請求參數不得指定其他欄位。
- 必須在查詢時先套用基底範圍，例如只查啟用中的資料與權限範圍。
- 儲存時必須在後端驗證客戶與產品存在且啟用。
- 明細單價以資料庫為準。不得採用前端送來的價格。

## 未做

- **進階搜尋引擎**（多條件 AND/OR、欄位池 metadata 自動產生）：未做，不在本示範範圍內。
- **批次選取的進階頁籤**：未做，已關閉（`advanced: false`），只提供一般搜尋。原因：本示範沒有欄位池。
- **ProductLookup 的 metadata**：未做自動產生。目前是手寫白名單，見 `ProductLookupController::SEARCH_FIELDS`。
- **表單驗證失敗後回填明細**：未做。使用者需重新輸入。
- **客戶單選與批次選取的瀏覽器操作**：未驗證。

## 授權

本專案以 MIT 授權發布。詳見 `LICENSE`。
