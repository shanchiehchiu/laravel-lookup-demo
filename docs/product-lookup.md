# ProductLookup integration contract

`ProductLookup` is for product quick-entry in form detail rows. The bundled JavaScript and Blade component provide the interaction and modal. A destination project still supplies product APIs, metadata, row markup, and any business-specific dependent fields.

## Requirements

- jQuery and Bootstrap 5 Modal.
- Select2 when using the advanced field/value controls or `idMode: 'select2'`.
- Four endpoints configured in `ProductLookup.init()`:
  - `infoUrl`: exact lookup by product serial or ID, returning `{ "result": { "id": ..., ... } }`; no match may return an empty/null result.
  - `lookupUrl`: paginated picker query. ProductLookup sends `search_conditions` as a JSON array containing one `{ boolean, field, operator, value }` condition (or an empty array for the special “all results” option), plus `page`. Return `{ "datas": [...], "current_page": 1, "last_page": 1, "total": 0 }`.
  - `metadataUrl`: field metadata returning `{ "fields": [{ "key": ..., "label": ..., "type": ..., "operators": [...], "options": [...] }], "operators": { ... } }`.
  - `fieldOptionsUrl`: used for large distinct-value fields configured for remote Select2 search; return Select2's `{ "results": [{ "id": ..., "text": ... }], "pagination": { "more": false } }` shape. If no remote fields are needed, adapt this code path or provide an allowlisted endpoint.

The source uses a generic lookup response and Search metadata service, but those services are not bundled as a complete search engine. Reuse the destination project's engine if compatible. Otherwise expose only fields the current user may search and validate field/operator/value server-side. Scope the Eloquent query for tenant/status/authorization before applying search conditions.

## Product field mapping

The source implementation assumes these row fields in API results:

- `id`: product primary key.
- `product_serial`: product code shown in the result and copied to the quick-entry field.
- `name` (fallback `product_name`): display name.

The source also uses `product_serial` as the exact-lookup input and advanced-search field key, and `name` as the default result detail field. If the target schema uses other names, update every related reference in `product-lookup.js` consistently: `NAME_FIELD_KEY`/`NAME_FIELD_LABEL`, `REMOTE_OPTION_FIELDS`, the serial resolution and search field keys, `renderRows()`, and `applyProduct()`. The current search flow selects the `product_serial` field when opening from a typed code and sends it in the exact-lookup request. Keep metadata keys and JSON response keys consistent with the mapping. Escape rendered values; do not interpolate untrusted product data into HTML.

In `idMode: 'select2'`, the source's default `selectSelector` targets `select[name$="[products_id]"]`; it also synchronizes a hidden `products_id` input when present. Adapt both selectors to the target form. In `idMode: 'hidden'`, set `hiddenSelector` to the project's product ID field. Confirm that ID changes still trigger the intended form recalculation handlers. The source also sends `depots_id` (from `depotsId`) with exact lookup requests; remove or map it if the target API uses another context parameter or does not accept it.

## Row and modal wiring

The default selectors are `#product_area`, `.product_item`, `.quick-product-serial`, `.quick-product-name`, and `.add-template[data-target="product"]`. Pass the target form's actual container, row, code/name fields, ID field, and add-row button selectors to `ProductLookup.init()`. Delegated handlers then work for rows added later.

The Blade component uses `productLookupModal`, `product_lookup_results`, and `product_lookup_confirm` by default. If multiple product modals appear on a page, pass distinct `id`, `resultsId`, and `confirmId` props and the matching `modalId`, `modalResultsId`, and `modalConfirmId` JS options.

Typical setup:

```blade
<x-backend.product.lookup-modal />

@push('javascript')
    <script src="{{ asset('js/product-lookup.js') }}"></script>
    <script>
        ProductLookup.init({
            infoUrl: @json(route('products.lookup-info')),
            lookupUrl: @json(route('products.lookup')),
            metadataUrl: @json(route('search.metadata', ['link' => 'product'])),
            fieldOptionsUrl: @json(route('products.lookup-field-options')),
            containerSelector: '#items',
            rowSelector: '.item-row',
            serialSelector: '.product-code',
            nameSelector: '.product-name',
            selectSelector: 'select[name$="[product_id]"]',
            addRowSelector: '.add-item-row',
            onApply: function ($row, product) {
                // Only fill project-specific fields that existing change handlers do not own.
            }
        });
    </script>
@endpush
```

Use the project's actual script stack and route names. If Blade quoting is awkward, use `@json` or the project's established safe URL serialization pattern.

## Behavior to preserve

- Enter on the serial field first calls `infoUrl` for an exact match. A match is applied directly; a miss opens the modal with the entered serial prefilled as a contains search. Double-click opens the picker, and ArrowDown can activate the configured add-row control.
- Selecting a result fetches the full record by ID before applying it. The picker falls back to the row's ID/code/name if the info endpoint returns no full record.
- In select2 mode, the selected product option is replaced and `change` is triggered. This is the handoff to existing unit, price, warehouse, and tax logic; do not duplicate those effects in `onApply`.
- The module binds delegated events within `containerSelector`. Avoid using the same modal IDs for two instances, and call `destroy()` if the form lifecycle mounts/unmounts picker instances dynamically.
- The optional `validateFormSelector` checks entered serials before submit. Confirm its behavior matches the destination form's empty-row and validation rules before enabling it.

## Backend safeguards

- Validate the advanced-search field and operator against a server-side allowlist. Never use a requested field key directly as a SQL column.
- Apply the same authorization and base status/tenant scope to exact lookup, paginated lookup, and field options.
- Bound results and paginate on the server; do not load the full product table into the browser.
- For remote field options, allowlist the columns, escape LIKE wildcards where supported by the database, and bound each page.

---

## 本專案擴充：多選與延遲載入

以下兩個選項是本專案在 `public/js/product-lookup.js` 上新增的，預設值讓既有單選行為不變。

| 選項 | 預設 | 說明 |
|---|---|---|
| `multiple` | `false` | 結果列改為勾選框，彈窗底部出現「已選」確認區塊（列出已勾選產品，可個別移除）。確認鈕顯示「加入 N 筆」。按確認時，**第一筆填入開窗的那一列，其餘各新增一列**（透過 `addRowSelector`，新列加在表身最後）。沒有設定 `addRowSelector` 時只會填入第一筆。 |
| `infiniteScroll` | `true` | 結果不分頁，捲到結果表底部自動載入下一頁（延遲載入）。`false` 時改回上一頁／下一頁按鈕。 |

多選的互動：

- 點整列切換勾選；雙擊不會直接送出（避免誤觸）。
- 標題列的「全選已載入」只勾選目前已載入的列（含捲動載入的部分）。
- 確認區塊的 ✕ 會移除該筆，並同步取消結果列上的勾選。
- 每次開窗都會清空已選。
- 沒有任何已選時按確認，視窗保持開啟、明細不變。

延遲載入的實作重點：

- 捲動的是結果表的 `.product-lookup-scroll` 容器，表頭固定不動。
- 底部判斷用 `getBoundingClientRect`（不用 `scrollTop` 算術），瀏覽器縮放時較穩定。
- 翻頁與捲動載入都重用同一組查詢條件（`lastSearch`），使用者改了欄位也不會查錯。
- 每次新查詢遞增 `searchToken`，已過期的回應會被丟棄，避免舊頁資料接到新結果後面。

後端不需要改：多選與延遲載入都沿用同一支 `lookupUrl` 的分頁回應（`datas`、`current_page`、`last_page`）。
