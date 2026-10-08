# 萬用 Lookup 元件：規格與移植指南

> **狀態：已實作（v2，含複選模式）。** 修改核心檔案時，請同步更新本文件與「變更紀錄」。這份指南要跟核心檔案一起複製，複製後兩邊要保持一致。
>
> 本文件刻意不提任何特定專案的模組名稱，可以跟元件檔案一起複製到其他專案。專案自己的導入範圍、分支安排，請寫在該專案的設計文件裡。

## Context

表單裡常有「從另一張表挑一筆資料」的欄位（客戶、廠商、單據、母件…）。常見的舊寫法有兩種，各有問題：

- 一次撈全部塞進 select2：資料一多前端就很重
- 每種資料各寫一個專用彈窗：程式重複，操作方式也不一致

萬用 Lookup 把「彈窗＋一般／進階搜尋＋分頁＋選取寫回」做成一套共用元件。**要查什麼資料、搜尋欄位、結果欄位、選完怎麼顯示，都由使用端的設定決定**，新的資料類型不用再寫新的彈窗。

**適用**：表單表頭或單一欄位，從關聯資料挑一筆。

**不適用**：
- 表身逐列的快速輸入，例如「打編號按 Enter 直接帶入」這種互動
- 列表頁的篩選（那是篩 DataTable，不是挑一筆資料回填）

---

## 架構分層

| 層 | 內容 | 是否必要 |
|---|---|---|
| **核心** | 彈窗骨架、一般搜尋、分頁、`Lookup.attach()`、`LookupResponseTrait` | 必要 |
| **進階搜尋** | 進階頁籤（欄位／運算子／AND-OR 條件列），後端搜尋引擎、欄位池 metadata API | 選配 |
| **專案層** | 各專案自己的 preset（前端設定組）、領域 trait（後端篩選組）、查詢 API | 各專案自行撰寫 |

原則：**核心不認識任何業務資料，進階搜尋是可拔除的外掛**。沒有搜尋引擎的專案也能只用核心。

> 各專案的複本要保持一致，但**不要用 md5 當判準**：有些專案會對全專案跑 Laravel Pint，docblock 的 `@param` 對齊方式會被改掉（`@param array<...> $x` → `@param  array<...>  $x`），檔案內容其實沒變。比對時用 `diff -w`，只要忽略空白後沒有差異就算一致。

---

## 檔案清單

| 檔案 | 層 | 說明 |
|---|---|---|
| `public/js/lookup.js` | 核心 | `Lookup.attach()`、`Lookup.preset()`，含進階頁籤的前端邏輯（沒設定 `advanced` 時不會用到） |
| `resources/views/components/backend/lookup-modal.blade.php` | 核心 | 彈窗骨架，每頁放一個 |
| `app/Traits/LookupResponseTrait.php` | 核心 | 後端查詢 API 的共用回應：一般篩選、分頁、進階條件轉交 |
| `app/Service/Search/SearchQueryService.php` | 進階 | 把條件 JSON 套到 Eloquent 查詢上 |
| `app/Service/Search/SearchRegistry.php` | 進階 | link 字串 → SearchDefinition 的對照表 |
| `app/Service/Search/Definitions/SearchDefinition.php` | 進階 | 欄位池介面 |
| `app/Service/Search/Definitions/AbstractSearchDefinition.php` | 進階 | 欄位池基底類別，可從 `config('xxx.form')['fields']` 表單設定產生欄位 |
| `app/Http/Controllers/Backend/SearchController.php` + 路由 `backend.search.metadata` | 進階 | 欄位池 metadata API |
| `tests/Unit/Search/{SearchQueryServiceTest,AbstractSearchDefinitionTest,SearchRegistryTest}.php` | 進階 | 引擎本身的測試，可一併搬過去 |
| `public/js/lookup-presets.js` | 專案層 | 各專案自己的 preset，**不要**跟著核心複製 |

---

## 依賴

| 依賴 | 用途 | 必要性 |
|---|---|---|
| jQuery | DOM、AJAX | 必要 |
| Bootstrap 5（Modal、Tab） | 彈窗與頁籤 | 必要。彈窗骨架補圓角那條 CSS 用了 `var(--bs-border-radius)`，那是 **5.3+** 才有的變數；舊版只是少了圓角，功能不受影響 |
| select2 | 進階條件列的下拉；目標欄位若套了 select2 會先 destroy | 用進階搜尋時必要 |
| Font Awesome | 按鈕圖示（`fa-plus`、`fa-trash`） | 選配，沒有只是少了圖示 |
| SweetAlert2（`Swal`） | 載入欄位池失敗時的提示 | 選配，沒有就退回 `alert()` |
| Laravel 10、PHP 8.1+ | 後端 | 必要 |
| 專案自訂的版本號 helper | 靜態檔加版本號 | 選配。**跟著你要改的那個 Blade 檔案的慣例走，不是專案層級的慣例** —— 實務上曾遇到 layout 用 `asset('js/x.js?'.time())`、某張表單自己用 專案自訂的版本號 helper |

---

## 前端 API

### `Lookup.attach(target, config)`

在一個既有欄位上掛上 lookup，一個欄位一行。範例（客戶欄位）：

```js
Lookup.attach('select[name="customer_id"]', {
    title: '客戶',
    url: '{{ route("customers.lookup") }}',
    generalFields: [
        { name: 'no',   label: '客戶編號' },
        { name: 'name', label: '客戶名稱' },
    ],
    columns: [
        { key: 'no',   label: '客戶編號' },
        { key: 'name', label: '客戶名稱' },
    ],
    display: '{no} - {name}',
    advanced: { link: 'customer' },
});
```

| 設定 | 必填 | 說明 |
|---|---|---|
| `url` | ✔ | 查詢 API，格式見「後端 API」 |
| `columns` | ✔ | 結果表固定欄位，`{ key, label, align, headAlign }`；`key` 支援點記法（`product.name`）；`align` 為內容對齊、`headAlign` 為表頭對齊，可為 `start`／`center`／`end`，未設定時內容不加對齊、表頭置中 |
| `display` | ✔ | 選定後顯示框的文字：`{欄位}` 樣板（支援點記法）或 `function (row)` |
| `title` | | 彈窗標題 |
| `generalFields` | | 一般頁籤的搜尋欄位，`{ name, label, type, options, emptyLabel }`；`type` 可為 `text`（預設）、`date`、`select`；`name` 直接當查詢參數名；`select` 最前面固定有一個空值選項（代表不限），`emptyLabel` 可指定它顯示的文字（例如「全部」），未設定為空白 |
| `params` | | `function` 回傳每次查詢都要帶的額外參數（例如表單上的類別單選鈕） |
| `clearOn` | | selector，這些元素 change 時清空已選的值 |
| `advanced` | | 有給才顯示進階頁籤。`link`：欄位池名稱，字串或 `function`（可依表單狀態動態決定）；`hint`：提示文字，字串或 `function`；`allowAddCondition`：進階頁籤可新增多個 AND／OR 條件，同時保留一般頁籤；`dynamicGeneral`：一般頁籤改成「挑欄位加條件列」（n 個條件一律 AND，欄位來自欄位池，不用 `generalFields` 的固定欄位；`generalFields` 仍用來決定開窗時預設帶入哪幾列與其名稱）。輸入方式依欄位型別：文字＝包含、數字／日期＝起始～結束（可只填單邊，後端用 `gte`／`lte`）、有主檔編碼的下拉＝起始～結束、固定選項／是否＝單一下拉（等於）。已加入的欄位不再出現在挑選器，每列可取消勾選暫停或移除。結果表會多長一欄顯示條件用到的欄位 |
| `multiple` | | 設 `true` 開啟複選模式，目標必須是 `<select multiple>`；詳見「複選模式」 |
| `valueKey` | | 寫回的值取自哪個欄位，預設 `id` |
| `onPick` | | `function (row)`，寫回之後的擴充點 |
| `extraFieldAlign` | | 預設 `false`：進階條件額外欄表頭置中、內容不加對齊。設 `true` 時依欄位池的型別對齊（表頭與內容一致）：`number` 置右、`date` 置中、其他（`select`、`string`…）置左 |
| `searchOnInput` | | 預設 `true`：一般頁籤文字欄打字後 300ms、日期／下拉變更時自動查詢。設 `false` 時改條件不自動查詢，只有按「搜尋」或在文字欄按 Enter 才查 |
| `searchOnOpen` | | 預設 `true`：開窗立即查詢第一頁。設 `false` 時開窗不查詢，結果區顯示「請輸入條件後搜尋」，等使用者按搜尋（適合資料量大、一定要先下條件的情境） |

回傳一個實例：`open()`、`clear()`、`destroy()`。

### `Lookup.preset(name, overrides)`

同一種資料在多張表單用同一組設定時，把設定集中成 preset，各頁只傳差異：

```js
// lookup-presets.js（專案層）
Lookup.definePreset('customer', function (overrides) {
    return $.extend({
        title: '客戶',
        generalFields: [ /* ... */ ],
        columns: [ /* ... */ ],
        display: '{no} - {name}',
        advanced: { link: 'customer' },
    }, overrides);
});

// 各頁
Lookup.attach('select[name="customer_id"]', Lookup.preset('customer', {
    url: '{{ route("sales_orders.customer_lookup") }}',
}));
```

範例用的是淺層合併：有傳的鍵會整個取代預設值，例如傳 `columns` 就是換掉整組欄位。不要改成 `$.extend(true, …)`，深層合併會把陣列依索引逐筆合併，留下預設值的殘留元素。preset 也可以由工廠函式自己組出完整設定，不做合併。

### 對目標欄位的行為

1. **找不到目標就結束**。selector 要寫到能區分新增和編輯模式，例如 `select[name="xxx"]`、`input[type="hidden"][name="xxx"]`，避免套到編輯模式下同名的唯讀文字框
2. 目標如果套了 select2 就先 `destroy`；因為頁面的全域主題會在 document ready 時對全頁 `<select>` 統一套用 select2（可能在 `attach()` 執行之後才跑），`attach()` 會在 ready 後再拆一次。目標接著**視覺隱藏**並加上 `tabindex="-1"`（避免 Tab 停在看不見的欄位），搬進顯示框所在的 input-group。顯示框本身是 `readonly` 的 `<input>`，但**點擊它也會開彈窗**（游標會顯示 `pointer`），不用精準點在旁邊的「選擇」按鈕——這跟結果列「點整列即可選取」是同一個「擴大可點擊範圍」的考量。停用狀態（見第 5 點）沒有綁這個 click、也不顯示 `pointer` 游標，避免誤導使用者以為還能改
3. 選定後寫回目標並 `trigger('change')`：
   - `<select>`（單選）：`empty()` → `append(new Option(顯示文字, 值, false, false))` → `val(值)`
   - `<select multiple>`（複選）：`empty()` → 每筆 `append(new Option(...))` 後設 `option.selected = true`
   - `<input type="hidden">`：`val(值)`
   - 頁面既有的 change 聯動完全照舊，所以**舊頁面可以直接套用**

   **插入 option 時不要預先選取**（不要用 `new Option(text, value, true, true)`）。原因見「移植時的坑」第 5 點——那個寫法只設 selectedness、不設 dirtiness flag，遇到會移除 `selected` 屬性的全域處理器就會被重算掉。

   pick 只會觸發 `change`；頁面原本如果監聽的是 `select2:select`，或呼叫 `.select2('data')` 取值，套用後要改成監聽 `change`、用 `.val()` 取值。
4. 有值時，顯示框旁邊會多一顆 ✕ 清除鈕（跟「選擇」按鈕一起放在 input-group 裡），點了會清空值與顯示框、並觸發 `change`（這跟第 5 點 `clearOn` 觸發的 `clear()` 不同——`clearOn` 是內部連動，故意不觸發 change 避免無窮遞迴；使用者自己點 ✕ 則要讓頁面既有的 change 監聽照常反應）。這是核心固定行為，**不是**選配，沒有 `disabled: true` 的欄位一律會出現。沒有值、或目標是 disabled 時都不顯示
5. `clearOn` 的元素 change 時清空值與顯示框，**不**觸發 change
6. 目標是 disabled 時，顯示框也 disabled，不顯示選擇按鈕、也不顯示清除鈕

**導入前先確認目標真的有 `required` 屬性**：有些專案的表單設定寫了 `'required' => true`，但 Blade 是手寫的 `<select>`，只印了紅色星號、沒有輸出 `required`（驗證在後端）。那種欄位「視覺隱藏 vs display:none」沒有差別，不必把它當驗收重點。查法：在目標頁面 Console 跑 `document.querySelectorAll('select[required]')`。

**必填欄位**：目標用「視覺隱藏」（絕對定位、透明、1px），並搬進顯示框所在的 input-group，不用 `display:none`。`display:none` 的 `<select required>` 在送出時會被瀏覽器擋下並報 "An invalid form control is not focusable"；唯讀輸入框則根本不參與必填驗證。視覺隱藏才能讓原生 `checkValidity()` 繼續正常運作，提示也會出現在欄位附近。`<input type="hidden">` 本身就不參與必填驗證，**需要必填的欄位請用 `<select>` 當目標**。

---

## 複選模式

複選有兩種情境，共用同一個彈窗。

### 一個欄位裝多個 id

```js
Lookup.attach('select[name="material_ids[]"]', {
    multiple: true,
    title: '原料',
    url: '...',
    columns: [ /* ... */ ],
    display: '{product_serial} - {name}',
});
```

目標必須是 `<select multiple>`。打開彈窗時會把欄位現有的已選 option 預先勾起來（文字直接沿用 option 的文字，不用打 API），按確認是**取代**整組：重建 option 並全部選取，然後觸發一次 `change`。沒有任何選取時按確認代表清空欄位。顯示框寫「已選 N 筆」。

### 批次帶進表身

```js
Lookup.attachButton('#batch-add-products', {
    multiple: true,
    title: '選擇產品',
    url: '...',
    columns: [ /* ... */ ],
    display: '{product_serial} - {name}',
    onPick: function (rows) {
        rows.forEach(appendItemRow);
    },
});
```

`attachButton(selector, config)` 掛在按鈕上，沒有目標欄位、不產生顯示框。打開時不預勾，按確認是**附加**：呼叫 `onPick(rows)`，要變成幾列表身、要不要去重都由頁面決定；沒有選取就直接關閉，不會呼叫 `onPick`。不給 `multiple` 時 `onPick` 收到單一資料列。

### 選配：改用 select2 顯示已選項目

複選欄位預設是「唯讀框寫『已選 N 筆』＋選擇按鈕」。想改成在表單上直接顯示 tag、可以個別叉掉，**由頁面自己接**，核心不提供這個呈現（各專案的版面與主題不同，而且不是每個專案都裝 select2）：

```js
var multi = Lookup.attach('#material_ids', { multiple: true, /* ... */ });

// 把目標從視覺隱藏改回顯示，藏掉唯讀框，改用 select2 顯示 tag
$('#material_ids').removeClass('lookup-target-hidden').removeAttr('tabindex')
    .css({ position: '', width: '', height: '', opacity: '' });
$('#material_ids_display').closest('.input-group').find('.lookup-display').addClass('d-none');
$('#material_ids').select2({ placeholder: '點這裡選擇', width: '100%', allowClear: true });

// 點欄位不要開 select2 的下拉，改開彈窗
$('#material_ids').on('select2:opening', function (event) {
    event.preventDefault();
    multi.open();
});
```

注意 select2 會接管欄位的 UI，原生必填驗證在這種欄位上不一定會如預期跳提示。重複用到第三個頁面時，再把這段抽成專案層的小函式即可。

### 彈窗的差異

- 每列的 radio 換成 checkbox，表頭多一個「全選本頁」（只選目前這一頁）
- 結果表下方多一區「已選 N 筆」，可個別移除或一次清除全部
- 已選項目跨頁、跨搜尋條件都保留，直到按確認或關閉彈窗
- 點結果表的任一列就切換勾選，不必精準點到 checkbox（單選模式點整列＝選取該列，雙擊＝選取並關閉）

`onPick` 在複選模式收到的是資料列陣列。**從欄位既有值預先勾選、且使用者沒有重新查到的項目，該筆會是 `null`**（它只有 value 與顯示文字，不是從查詢結果來的）；同一筆只要在任何一次查詢結果中出現過，就會自動補上完整資料與最新的顯示文字。需要完整資料的話，請改用寫回後欄位上的值自己查。

---

## Blade：`<x-backend.lookup-modal />`

- **每頁放一個**，只有骨架：標題、一般／進階頁籤、一般欄位容器、進階條件列容器、結果表（表頭由 JS 產生）、分頁、關閉／確認
- **放在 `<form>` 之外**（`</form>` 之後、`@endsection` 之前）。結果列的 radio／checkbox 有 `name="lookup_choice"`，放在表單內會被一起送出
- 同一頁多個 lookup 欄位共用這一個彈窗，每次開啟依該欄位設定重新配置
- 使用固定的 id 與名稱：`lookupModal`、`lookup_` 開頭的一組 id、結果列 radio 的 name `lookup_choice`、class 前綴 `lookup-`。移植前先確認目標專案沒有同名的 id 或 class
- 要用進階搜尋時傳入 `metadata-url`（欄位池 API 的網址樣板，`__LINK__` 會被換成欄位池名稱）。請用綁定寫法，避免網址被跳脫兩次：`<x-backend.lookup-modal :metadata-url="route('backend.search.metadata', ['link' => '__LINK__'])" />`。不用進階搜尋就不要傳；設定了 `advanced` 卻沒傳時，瀏覽器 console 會出現錯誤訊息

---

## 後端 API

### `LookupResponseTrait::lookupResponse()`

```php
protected function lookupResponse(Builder $query, Request $request, array $filters = [], ?string $link = null): JsonResponse
```

呼叫端負責：**基底範圍**（狀態、權限、業務限制）、**eager load**、**排序**，trait 不改動這些。

```php
public function customer_lookup(Request $request)
{
    $query = Customer::where('status', 1)->orderBy('no');

    return $this->lookupResponse($query, $request, [
        'no'   => 'like:no',
        'name' => 'like:name',
    ], 'customer');
}
```

### `$filters` 語法

鍵是查詢參數名（對應前端 `generalFields[].name`），值是 `運算:欄位`：

| 寫法 | 意義 |
|---|---|
| `like:no` | `no LIKE %值%`，自動跳脫 `%`、`_` |
| `like:product.name` | 點記法 → `whereHas('product', name LIKE %值%)` |
| `like:product.product_serial,product.name` | 逗號 → 任一欄位符合（OR） |
| `eq:status_id` | 等於 |
| `date_gte:date` / `date_lte:date` | 日期區間（`whereDate`） |

參數沒帶、空字串或陣列就略過。

- 點記法只能指 model 上的關聯（會交給 `whereHas()`），**不能用來指 join 進來的 `table.column`**。例如查詢已經 `leftJoin` 了別的表、想避免欄位名稱歧義而寫 `'no' => 'like:customers.no'`，這裡的 `customers` 會被當成關聯名稱去呼叫 `Customer::customers()`，因為沒有這個關聯方法而丟 `BadMethodCallException`。這種情況下，只要欄位名稱在 join 的幾張表之間不重複，直接寫欄位名（不加前綴）即可：`'no' => 'like:no'`
- **關聯名稱要去 model 確認，不能從欄位名推**。`product_categories_id` 的關聯常常叫 `category` 而不是 `product_category`；寫錯會在查詢時丟 `BadMethodCallException`（不是安靜失敗，但要跑到那一步才會發現）。查法：`grep -n 'public function' app/Models/Xxx.php`
- **`$filters` 與 `$link` 必須是程式碼裡寫死的常數，不可以用請求參數組出來**：關聯名稱會被拿去呼叫 model 上的方法，等於讓使用者決定呼叫哪個方法

### `$link` 與進階條件

- 有給 `$link`：把請求的 `search_conditions` 交給 `SearchQueryService::applyConditions()`，欄位池用 `SearchRegistry::get($link)`。條件整組包成一層巢狀 `where`，只會跟基底範圍做 AND 交集，**不會蓋掉呼叫端的範圍限制**。
- 沒給 `$link`：完全不碰搜尋引擎，沒有引擎的專案也能用。
- 欄位或運算子不在欄位池內會丟 `ValidationException`，也就是回應 422。

### 請求參數

| 參數 | 來源 |
|---|---|
| `generalFields[].name` 各欄位 | 一般頁籤 |
| `params()` 回傳的欄位 | 前端設定 |
| `search_conditions` | 進階頁籤，JSON 字串 |
| `page` | 分頁 |

### 回應格式（契約，不要任意變動）

```json
{
  "datas": [ { "id": 1, "no": "C001", "name": "某客戶", "product": { "name": "..." } } ],
  "current_page": 1,
  "last_page": 3,
  "total": 25
}
```

每頁固定 10 筆。頁碼不是數字時退回第 1 頁。`datas` 的每一列就是 model 的 JSON，前端用 `columns[].key` 的點記法取值。

---

## 進階搜尋（選配）

### metadata API：`GET backend.search.metadata?link=xxx`

需要登入（`auth:backend`）。回應：

```json
{
  "link": "customer",
  "title": "客戶",
  "fields": [
    { "key": "no", "label": "客戶編號", "type": "string", "operators": ["contains", "eq", "between"], "options": [] },
    { "key": "status_id", "label": "狀態", "type": "select", "operators": ["eq", "neq", "between"], "options": [{ "value": 1, "name": "啟用" }] }
  ],
  "operators": { "eq": "等於", "neq": "不等於", "gt": "大於", "gte": "大於等於", "lt": "小於", "lte": "小於等於", "contains": "包含", "between": "介於" }
}
```

metadata 的 `operators` 每種型別都會帶 `between`，那是給列表頁一般模式的區間查詢用的，進階頁籤的運算子下拉會自行濾掉。`select`／`boolean` 欄位只有在 `eq`、`neq` 時才顯示下拉選單，其他運算子一律改成文字輸入。

### 條件 JSON（`search_conditions`）

```json
[
  { "boolean": "and", "field": "no", "operator": "contains", "value": "C0" },
  { "boolean": "or",  "field": "status_id", "operator": "eq", "value": "1" }
]
```

由上往下依序用 AND／OR 組合，第一條的 `boolean` 固定視為 `and`。進階頁籤的第一列不顯示 AND／OR 開關；刪掉第一列後，下一列會補位成第一列，它的開關也會跟著拿掉。

### 新增一種資料的欄位池

1. 新增 `app/Service/Search/Definitions/XxxSearchDefinition.php`，繼承 `AbstractSearchDefinition`，實作 `link()`、`title()`、`modelClass()`、`fields()`；可以用 `fieldsFromFormConfig()` 從表單設定產生欄位
2. 在 `SearchRegistry` 註冊 link
3. 前端設定 `advanced.link`，後端 `lookupResponse()` 傳同一個 `$link`

---

## 開工前盤點（先花十分鐘，省掉大半時間）

實測最花時間的事全部發生在「複製檔案」之前。先確認這七件：

| 要確認的事 | 怎麼查 | 為什麼 |
|---|---|---|
| 目標主檔**有沒有資料** | `select count(*) from <主檔>` | 要驗證搜尋與分頁，至少需要 11 筆（每頁 10）。實務上曾遇到整個開發資料庫是空的，光灌資料就佔掉三分之一時間 |
| 那行預載是寫在 controller 還是**共用 trait** | `grep -rn 'XxxTrait' app/Http/Controllers/` | 預載常被抽進 `OrderTrait::init()` 這種共用方法，實務上曾遇到被 9 個 controller 共用。改 trait 會一次把所有單據的欄位清空 |
| 目標 `<select>` **真的有 `required`** 屬性嗎 | 瀏覽器 Console：`document.querySelectorAll('select[required]')` | 表單設定寫了 `required` 不代表 Blade 有輸出。沒有的話「視覺隱藏 vs display:none」沒差別 |
| 目標欄位**是不是已經 AJAX 化**了 | 在 Blade 搜 `data-url` | 已經是 AJAX select2 的欄位不是好目標（不屬於「一次撈全部」），換一個 |
| `php artisan route:list` 跑不跑得動 | 直接跑一次 | 只要專案有任何一個 controller 類別不存在、或建構子查了不存在的表，整個指令就會爆掉。不能跑就改用 tinker 列路由 |
| PHP 版本 | 看 `vendor/composer/platform_check.php`，**不是** `composer.json` | `composer.json` 常寫 `^8.1`，但 vendor 是用更新的版本裝的，用錯版本第一個指令就 fatal |
| 目標頁面**原本就有的** console 錯誤 | 開頁面看一次並記下來 | 收工時才分得清哪些錯誤是你造成的。實務上曾遇到本來就有三個既有錯誤 |

---

## 移植步驟

### 只要核心

- [ ] 複製 `public/js/lookup.js`、`resources/views/components/backend/lookup-modal.blade.php`、`app/Traits/LookupResponseTrait.php`
- [ ] 確認目標專案已有 jQuery、Bootstrap 5；確認沒有 `lookupModal` 開頭的 id 衝突
- [ ] 需要的頁面放 `<x-backend.lookup-modal />`，並載入 `lookup.js`
- [ ] 替要查的資料寫一支查詢 API（controller 使用 `LookupResponseTrait`），加路由
- [ ] **確認路由的完整名稱**：各專案的路由群組不一定有名稱前綴（有的是 `products.xxx`，有的是 `backend.products.xxx`）。`route()` 寫錯會在畫面渲染時就直接丟 `RouteNotFoundException`。**優先用 tinker，不要依賴 `route:list`**（只要專案有任何一個 controller 類別不存在或建構子查了不存在的表，整個 `route:list` 就會爆掉，加上 `| grep` 之後症狀是「沒有任何輸出」，看起來像路由沒註冊）：
  ```php
  php artisan tinker --execute="foreach (Route::getRoutes() as \$r) { \$n = \$r->getName(); if (\$n && str_contains(\$n, 'product')) echo \$n.PHP_EOL; }"
  ```
- [ ] 欄位上加一行 `Lookup.attach(...)`，不要設定 `advanced`
- [ ] 手動驗證：開彈窗、一般搜尋、分頁、選取後頁面既有聯動有執行、必填欄位送出驗證

### 加上進階搜尋

- [ ] 確認有 select2
- [ ] 複製進階層的檔案（見檔案清單），在路由群組加 `search/metadata`；路由的完整名稱依該專案的群組前綴而定，`:metadata-url` 要用實際名稱
- [ ] 替每種資料寫 SearchDefinition 並在 `SearchRegistry` 註冊
- [ ] 頁面上的 `<x-backend.lookup-modal>` 用 `:metadata-url` 傳入欄位池網址樣板
- [ ] 前端設定 `advanced.link`、後端傳 `$link`
- [ ] 跑引擎的單元測試

---

## 移植時的坑（實際移植後整理）

### 1. 拆掉舊的預載，記得補回編輯頁的顯示文字

要接 Lookup 的欄位，原本通常是「controller 把整張表塞進 `options`」。把預載拿掉之後，**新增頁沒問題，但編輯／檢視頁會變空白**——欄位靠 option 的文字才顯示得出目前選的是什麼，選項沒了就沒東西可顯示。

拆預載有三步，指南原本只寫了中間那一步：

**改之前**：確認那行預載的**歸屬**。各專案常把表單欄位初始化抽進共用方法（例如 `OrderTrait::init()`），實務上曾遇到被 **9 個 controller** 共用——直接改那一行會一次把所有單據的該欄位變空白，而其中 8 張還沒接 Lookup。查法 `grep -rn 'OrderTrait' app/Http/Controllers/`。只導入一張單時，要在**該 controller 呼叫 `init()` 之後覆寫**，不要動 trait。

順便確認有沒有人依賴那份 options 的**額外鍵**：有些 Service 的 `select()` 會一起回傳 `company_id`、`invoice_title` 這類欄位給前端 JS 用，清空 options 會把它們一起拿掉。

**改的本身**：預載改成空陣列，編輯／檢視時只補目前這一筆。

**改之後**：新增、編輯、**檢視**三個頁面都要各開一次。檢視頁走的是 disabled 路徑（顯示框跟著 disabled、選擇按鈕不出現），跟編輯頁不同。

```php
// 原本：每次開表單都撈整張表（這正是要消滅的）
$this->form['fields']['products_id']['options'] = $this->ProductService->query();

// 改成：不預載，改由 Lookup 彈窗查
$this->form['fields']['products_id']['options'] = [];
```

```php
/**
 * 改用 Lookup 後不再預載全部選項，
 * 編輯／檢視時補上目前這一筆，欄位才顯示得出文字。
 */
private function setSelectedProductOption($productId): void
{
    if (empty($productId)) {
        return;
    }

    $product = Product::find($productId);
    if (! $product) {
        return;
    }

    $this->form['fields']['products_id']['options'] = [[
        'value' => $product->id,
        'name' => "{$product->product_serial} - {$product->name}",
    ]];
}
```

在 `edit()`／`show()` 裡準備完表單資料之後呼叫它（欄位名稱、顯示格式依各專案調整）。驗證方式：開一張既有單據的編輯頁，欄位要顯示原本的值，不能是空白。

### 2. `LookupResponseTrait` 會留著搜尋引擎的 `use`

核心 trait 檔案開頭有這兩行：

```php
use App\Service\Search\SearchQueryService;
use App\Service\Search\SearchRegistry;
```

**沒有搜尋引擎的專案照樣能跑**——PHP 的 `use` 只是別名，沒傳 `$link` 就不會走到 `app(SearchQueryService::class)`，不會有錯誤。但 IDE 與靜態分析會標成「找不到類別」。

兩種處理方式：

- **留著**（建議）：之後要加進階搜尋不用再改核心，跟其他專案的檔案也保持一致
- **刪掉**：把那兩行連同 `lookupResponse()` 裡 `if ($link !== null) { ... }` 整段移除。這樣就跟其他專案的核心檔案不同了，之後同步要自己處理差異

### 3. PHP 版本與靜態檔載入慣例，各專案不一樣

- **PHP 版本**：跑指令前先看該專案的 `vendor/composer/platform_check.php` 要求哪個版本，用對應的完整路徑執行，不要用裸 `php`
- **載入 JS 的寫法**：跟著你要改的那個檔案裡既有的寫法走。常見兩種：

  ```blade
  <script src="{{ asset('js/lookup.js?'.time()) }}"></script>        {{-- 每次載入都換網址：永遠不吃快取 --}}
  <script src="{{ asset('js/lookup.js') }}"></script>  {{-- 檔案改了才換網址 --}}
  ```

  若專案有自訂版本號 helper（內容通常是把 `filemtime()` 接成 `?v=`），可以改用它；沒有的專案就用 `asset()`。兩種都能動，但 `time()` 等於關掉快取，能用 `filemtime` 的就用。

### 4. 核心沒有可以直接搬的測試

檔案清單裡的測試只涵蓋進階搜尋引擎。`LookupResponseTraitTest` 綁著來源專案的 model（拿它的資料表當查詢對象），**搬過去不能直接跑**。所以移植完成的專案，核心是零自動化測試的狀態。

建議至少補一個：拿目標專案任一張有資料的表，照 `LookupResponseTraitTest` 的結構改寫，驗 `like` 篩選、點記法關聯、分頁格式這三項就夠。

**動手前先確認兩件事**：

1. **測試跑的是哪個資料庫**。`phpunit.xml` 裡的 `DB_CONNECTION`／`DB_DATABASE` 可能是**被註解掉的**，又沒有 `.env.testing` —— 那測試會直接打**開發資料庫**。實測兩個專案都是這樣
2. **有沒有 factory**。沒有 factory 的專案只能寫成**唯讀**測試（依賴開發資料庫既有的資料），要在測試檔開頭註明這件事，不然下一個人會以為測試是自給自足的

另外：trait 測試裡的輔助方法**不要叫 `call()`**，會跟 `TestCase::call()` 撞簽章直接 fatal error。前端要測的話，用 jsdom 載入 `lookup.js` 寫一組腳本會比讀程式碼可靠——這個元件的兩個真實 bug（預勾項目沒更新、`multiple` 掛錯目標靜默失敗）都是這樣抓到的，讀碼看不出來。

### 5. 值寫回之後消失（三種成因，要先分辨是哪一種）

**症狀**：值明明設進去了，`trigger('change')` 之後就變空白，畫面上什麼都沒選。**不會有任何錯誤訊息**。

三種成因，對策完全不同，不要看到症狀就直接套結論。

#### 成因 ①：全域 change 處理器把 `selected` 屬性清掉

這類頁面常見一個綁在**所有 `select`** 上的處理器，長得像這樣——

```js
$(document).on('change', 'select', function () {
    let options = $(this).find('option');
    let temp_value = $(this).val();
    options.removeAttr('selected');            // 先清掉全部 option 的 selected 屬性
    if (typeof $(this).attr('multiple') === 'undefined') {
        let value = $(this).val();              // ← 重新讀一次，不是用上面存的 temp_value
        $(this).find(`[value="${value}"]`).attr('selected', true);
    }
});
```

關鍵是 HTML 規格的行為，**不是** jQuery 的怪癖：

- `new Option(text, value, true, true)` 只設 option 的 **selectedness**，**不會**設 dirtiness flag
- 移除 `selected` 內容屬性會觸發「ask for a reset」演算法，對 dirtiness 為 false 的 option **重算** selectedness
- 用 `select.value = x` 或 `option.selected = true`（IDL setter）設值**會**設 dirtiness，因此免疫

實測（在瀏覽器跑過，不是推論）：

| 寫法 | 移除 `selected` 屬性後 |
|---|---|
| 後端渲染的 `<option selected>` | 值丟掉 |
| `new Option(t, v, true, true)` | **值丟掉** |
| `new Option(t, v, false, false)` + `select.value = v` | **值保住** |
| `append(new Option(t, v, false, false))` + `option.selected = true` | **值保住** |

還有一個容易誤判的地方：**單選 select 有「沒有任何 option 被選中時選第一個」的 fallback**。所以在 `empty()` 之後只剩目標那一個 option 的情況下，連 `true, true` 都看起來沒事——那是巧合。一旦 select 裡還有 placeholder（頁面程式 append 到既有 select 時的常態），第一個就是 placeholder，值就沒了。`<select multiple>` 沒有這個 fallback，**被重算後是「全部沒選」**。

**對策**：插入時不要預先選取，插完再設值。

```js
// 不要這樣
$select.append(new Option(text, id, true, true)).trigger('change');

// 單選
if (!$select.find('option[value="' + id + '"]').length) {
    $select.append(new Option(text, id, false, false));
}
$select.val(id).trigger('change');

// 複選
var option = new Option(text, id, false, false);
$select.append(option);
option.selected = true;
```

核心的 `pick()`／`pickMany()` 已經是這個寫法，所以 `attach()` 不必自己處理；**需要注意的是你自己在 `onPick` 裡寫回其他欄位的程式**。

#### 成因 ②：頁面的業務前置條件把值清掉（表身批次帶入最常踩）

實際遇過：表身產品欄位的 change 處理器長這樣——

```js
if ($("#customers_id").val() == "") {
    $(this).val("");      // 還沒選客戶就把產品清掉
    return false;
}
```

症狀跟成因 ① 一模一樣，但**照成因 ① 的寫法改完仍然是空的**。`attachButton` 的 `onPick` 不會幫你檢查這些前置條件。

**對策**：移植前先確認表身欄位的 change 處理器有沒有依賴表頭欄位；有的話在 `onPick` 開頭自己擋（或要求使用者先選表頭）。

#### 成因 ③：select2 接管了欄位

如果頁面原本對該欄位套了 select2，而你的寫回沒有觸發 select2 更新，畫面會顯示舊值或空白（但 `.val()` 其實是對的）。

**對策**：確認 `attach()` 有把 select2 `destroy` 掉（核心會做，但專案主題可能在 ready 之後又套一次）。

#### 怎麼分辨是哪一種

先在 Console 列出所有會吃到這個欄位的委派處理器：

```js
var el = document.querySelector('select[name="items[1][products_id]"]');
($._data(document, 'events').change || [])
    .filter(function (h) {
        if (!h.selector) { return false; }
        try { return el.matches(h.selector); } catch (e) { return false; }   // 頁面上有非標準 selector 時 matches() 會丟 SyntaxError
    })
    .forEach(function (h) { console.log(h.selector, String(h.handler)); });
```

看到誰在動 `selected` → 成因 ①；看到誰在檢查別的欄位然後 `val("")` → 成因 ②；都沒有就往 select2 查。

也可以逐步縮小範圍：只 `trigger('change.select2')` 如果值留得住、但 `trigger('change')` 就消失，那就確定是頁面自己的 change 處理器（① 或 ②）。

### 6. 靠 `<option data-xxx>` 反查的欄位，改用 `onPick` 讀後端資料，不要想辦法讓動態 option 帶 data 屬性

延續坑 1「額外鍵」那段提到的情境：整批預載時，`<option>` 上常會手刻 `data-currency`、`data-company_id` 這類屬性，change handler 靠 `$(this).children('option:selected').data('xxx')` 反查幣別、公司別等衍生資料。改用 Lookup 後，`pick()` 是用 `new Option(text, value, false, false)` 動態建立唯一那個 option，**不會帶這些 data 屬性**——change handler 讀到的是 `undefined`。

**不要**試著讓 `pick()` 也塞入 data 屬性（那是核心邏輯，塞了只會讓這個情境變成特例，往後每個欄位需要的額外資料都不一樣）。正確做法是讓查詢 API 多回傳這些欄位，前端在 `attach()` 的 `onPick(row)` 直接讀：

```php
// 查詢 API：select() 多加幾個欄位（都是同一張表的欄位，不需要 join 就有）
$query = Customer::query()
    ->where('customer_type_id', 2)->where('status', 1)
    ->select(['id', 'no', 'name', 'phone', 'currency_id', 'company_id'])
    ->orderBy('no');
```

```js
// 原本：change handler 讀 data-currency
$(document).on('change', '#customer_id', function() {
    var currencyId = $(this).children('option:selected').data('currency');
    $('#currency_id').val(currencyId).trigger('change');
});

// 改成：onPick 直接讀後端回傳的完整資料列，這段 change handler 可以整個拿掉
Lookup.attach('select[name="customer_id"]', {
    /* ...其餘設定... */
    onPick: function (row) {
        $('#currency_id').val(row.currency_id).trigger('change');
    },
});
```

`onPick` 拿到的 `row` 就是後端 `select()` 出來的那一列完整資料（不限於 `columns` 設定要顯示的欄位），`pick()` 內部是先 `trigger('change')` 再呼叫 `onPick(row)`——如果原本的 change handler 除了讀 `data-*` 之外還有別的邏輯（例如依 id 查詢其他關聯資料），那段不用搬，`change` 事件一樣會觸發，只需要把「讀 `data-*`」那一步改成 `onPick`。

**加欄位前先確認真的有人在用**：擴充共用查詢 API 的 `select()` 之前，去讀一次原本的 change handler 在幹嘛——有可能那個 `data-*` 屬性本身就是死的（欄位名稱寫錯、或關聯的資料表根本沒有那個欄位），一直回傳 `undefined`，功能從來沒真的運作過，這種情況不需要在查詢 API 裡補這個欄位。

**如果衍生欄位要用子查詢/JOIN 從別的表拉平成單一欄位**（一對多關聯，不能直接 `leftJoin` 會讓分頁結果同一筆主檔重複出現多列），MySQL 對子查詢裡的欄位如果跟外層別名同名、且沒加表前綴，會丟 `forward reference in item list` 錯誤（把子查詢裡的欄位誤判成在引用外層正在定義的同名別名）：

```php
// 會報錯：子查詢裡的 check_title 沒加表前綴，跟外層 as check_title 同名
->addSelect(\DB::raw('(SELECT check_title FROM customer_banks WHERE customer_banks.customer_id = customers.id ORDER BY id LIMIT 1) as check_title'))

// 正確：子查詢裡的欄位一律加表前綴
->addSelect(\DB::raw('(SELECT customer_banks.check_title FROM customer_banks WHERE customer_banks.customer_id = customers.id ORDER BY customer_banks.id LIMIT 1) as check_title'))
```

「選 A 欄位 → 篩選 B 欄位的查詢範圍」這種級聯情境（例如選公司別後客戶清單只顯示該公司的），用 `params()` 動態帶目前選定的值當查詢參數（見前端 API 表格），對應到後端 `$filters` 加一條 `eq:` 規則；未選時參數是空字串，`lookupResponse()` 會自動略過不篩選，不需要额外判斷「有沒有選」。

---

## 維護規則（改核心前必讀）

- 核心檔案（`lookup.js`、`lookup-modal`、`LookupResponseTrait`）**不能引用任何專案的路由、model 或業務字串**。業務設定只放在 preset、專案 trait、查詢 API
- 進階搜尋必須維持可拔除：沒設定 `advanced`／`$link` 時，前後端都不能碰到搜尋引擎
- 回應格式、`$filters` 語法、`attach()` 設定項是跨專案契約，要變更就在下方變更紀錄寫明，並提供相容做法
- 選配依賴（Swal、Font Awesome）不能變成必要依賴

---

## 已知限制

- 進階搜尋用到關聯欄位（例如表身 `items.*`）當條件時，結果表多出來的那一欄會是空白，因為前端直接讀資料列的欄位值。要補的話，改成由後端依欄位池組 `extra_fields` 回傳
- 同一頁多個 lookup 欄位共用一個彈窗，不能同時開兩個
- 每頁 10 筆固定不可調；分頁列只顯示目前頁前後 5 頁與首末頁
- `like` 的萬用字元跳脫依賴資料庫以 `\` 為預設跳脫字元：MySQL、PostgreSQL 可用；SQLite、SQL Server 需要另外處理
- 目標如果是原本就有值的 `<input type="hidden">`（例如編輯頁），顯示框會是空白，目前沒有設定初始顯示文字的選項；`<select>` 目標會自動帶出已選取選項的文字
- 複選模式的「全選本頁」只選目前這一頁的結果，不會選取全部符合條件的資料
- 批次帶進表身沒有預勾，重複選同一筆的去重要由頁面處理
- 複選欄位模式的目標必須是 `<select multiple>`；不支援用 hidden input 存逗號字串（誤用時 console 會出現錯誤訊息，欄位不會被寫入）
- 複選欄位沒有任何選取時按確認，目標 `<select multiple>` 會一個 option 都不剩，表單送出時不會帶這個參數（不是送空陣列），後端要自己處理沒帶參數的情況
- 目標 `<select multiple>` 如果由後端渲染了完整選項清單，第一次確認會把沒選取的 option 一併清掉——這符合「取代整組」的語意，但第一次看到會意外

---

## 變更紀錄

| 日期 | 版本 | 內容 |
|---|---|---|
| 2026-09-11 | 0（設計） | 初版規格。由單據彈窗通用化而來 |
| 2026-09-11 | 1 | 實作核心（`LookupResponseTrait`、`lookup.js`、`lookup-modal`）；補上 `:metadata-url`、目標 selector、hidden 必填、tabindex、分頁、`$filters` 須為常數等說明 |
| 2026-09-12 | 2 | 新增複選模式（`multiple`）與 `Lookup.attachButton()`；彈窗加入全選本頁與「已選 N 筆」區；結果表改成點整列即可選取 |
| 2026-09-12 | 2（文件） | 實際移植到另一個專案後補上：路由名稱前綴的檢查、「移植時的坑」四點（拆預載要補編輯頁顯示、trait 保留搜尋引擎 `use`、PHP 版本與靜態檔載入慣例、核心沒有可搬的測試） |
| 2026-09-12 | 2（文件） | 移植到第三個專案後補上「移植時的坑」第 5 點：專案的全域 `select` change 處理器會吃掉程式化寫回的值，插入 option 時不要預先選取 |
| 2026-09-13 | 3 | **核心 `pick()`／`pickMany()` 改成不依賴巧合的寫回方式**（原本的 `new Option(..., true, true)` 只設 selectedness 不設 dirtiness，遇到移除 `selected` 屬性的全域處理器會被重算掉；單選靠「沒選中就選第一個」的 fallback 僥倖過關，複選則是全部丟失）|
| 2026-09-13 | 3（文件） | 獨立驗證後大改：新增「開工前盤點」七項；坑 5 重寫為「值寫回後消失」的三種成因與除錯流程（含實測對照表）；坑 1 升級為拆預載的三步（共用 trait 的歸屬）；坑 4 補測試資料庫與 factory 的前置確認；補彈窗要放在 `<form>` 之外、目標要先確認真的有 `required`、關聯名稱要去 model 確認、`route:list` 不可靠、依賴表兩條澄清 |
| 2026-09-22 | 3 | **顯示框本身也能點開彈窗**，不用精準點在按鈕上；停用狀態不綁這個 click，游標維持 `default`。使用者實測既有做法「只有按鈕能點」不符合直覺後改的 |
| 2026-09-23 | 3（文件） | 一口氣把 Lookup 導入 23 張單據後補上「移植時的坑」第 6 點：`onPick` 讀後端多回傳欄位取代 `<option data-xxx>` 反查（含 MySQL 子查詢別名 forward reference 陷阱）、`params()` 級聯查詢的既定用法——這是 `onPick`／`params()` 兩個機制第一次真正被使用，先前只在設定表格裡有說明沒有實戰案例；`$filters` 語法補一個「點記法當成表前綴誤用」的具體例子（自己踩過這個坑） |
| 2026-09-29 | 4 | 新增 `searchOnOpen` 選項（預設 `true`，既有頁面行為不變）；設 `false` 時開窗不自動查詢，要按搜尋才出結果；`generalFields` 的 `select` 新增 `emptyLabel`（空值選項顯示文字，未設定維持空白）；`columns` 新增 `align`／`headAlign` 欄位對齊（未設定維持原樣）；新增 `searchOnInput`（預設 `true`；設 `false` 時一般頁籤改條件不自動查詢）；新增 `extraFieldAlign`（預設 `false`；設 `true` 時進階條件額外欄依型別對齊） |
| 2026-10-02 | 4（移植版） | 移植較新的 `lookup.js`、`lookup-modal`、`LookupResponseTrait`（`lookup_id` 回查）、`AbstractSearchDefinition`（boolean 型別、`no`／`*_no` 欄位開放比較運算子），新增選項 `searchOnOpen`、`searchOnInput`、`extraFieldAlign`、`columns` 的 `align`／`headAlign`、`generalFields` select 的 `emptyLabel`、`advanced.allowAddCondition`（簡化模式）、欄位型 Lookup 的清除鈕。**與 原始專案 的差異**：①保留 參考版 獨有的 `infiniteScroll`（全選已載入、捲動載入）；②沒設定 `advanced` 的呼叫端仍隱藏「進階」頁籤；③彈窗維持 `modal-xl`，只有簡化模式才縮成 60vw；④進階條件的欄位若已是固定欄位就不重複長一欄；⑤`ProductController@lookup` 不再限制 select 欄位並接上 `product.product` 欄位池。多選產品（`ProductBatchLookup`）預設開啟「一般／進階」雙頁籤（`allowAddCondition: true`），頁面的 `<x-backend.lookup-modal>` 需傳 `:metadata-url`，沒傳就維持只有一般搜尋；另有 `chunkSize`（分段新增並顯示載入中）、`template`（批次新增期間暫時拿掉模板產品選項）|
| 2026-10-02 | 4（移植版） | 新增 `advanced.dynamicGeneral`（預設 `false`，既有頁面行為不變）：一般頁籤改成挑欄位加條件列，採用一般頁籤的挑欄位模式。與原始版本不同處：文字欄位用「包含」而不是起始～結束；數字／日期可只填單邊；開窗時依 `generalFields` 預設帶入對應欄位並沿用其名稱。多選產品（`ProductBatchLookup`）預設開啟 |
