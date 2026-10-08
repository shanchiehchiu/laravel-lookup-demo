@extends('layouts.app')

@section('title', '新增訂單')

@section('content')
    <h1 class="h3 mb-3">新增訂單</h1>

    <form method="POST" action="{{ route('orders.store') }}">
        @csrf

        <div class="card mb-3">
            <div class="card-body">
                <div class="mb-3">
                    <label class="form-label">客戶 <span class="text-danger">*</span></label>
                    {{-- 這個 select 會被 lookup.js 接管：使用者在彈窗選取後，寫回這個 select 的值 --}}
                    <select name="customer_id" class="form-select @error('customer_id') is-invalid @enderror" required>
                        <option value="">請選擇客戶</option>
                    </select>
                    @error('customer_id')
                        <div class="invalid-feedback d-block">{{ $message }}</div>
                    @enderror
                </div>

                <div class="mb-0">
                    <label class="form-label">備註</label>
                    <input type="text" name="note" class="form-control @error('note') is-invalid @enderror" value="{{ old('note') }}" maxlength="255">
                    @error('note')
                        <div class="invalid-feedback">{{ $message }}</div>
                    @enderror
                </div>
            </div>
        </div>

        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <h2 class="h5 mb-0">產品明細</h2>
                    <div class="d-flex gap-2">
                        <button type="button" class="btn btn-outline-success btn-sm batch-add-products">批次選取產品</button>
                        <button type="button" class="btn btn-outline-primary btn-sm add-item-row">新增明細</button>
                    </div>
                </div>
                <p class="text-muted small mb-2">輸入產品編號後按 Enter 直接帶入；找不到時會開啟選擇視窗。也可以在編號欄按 ↓ 新增一列。「批次選取產品」可一次勾選多筆產品加入明細，捲到底會自動載入更多。</p>

                @error('items')
                    <div class="alert alert-danger py-2">{{ $message }}</div>
                @enderror

                <div class="table-responsive">
                    <table class="table mb-0 align-middle">
                        <thead>
                            <tr>
                                <th style="width: 22%;">產品編號</th>
                                <th>產品名稱</th>
                                <th style="width: 12%;">數量</th>
                                <th style="width: 8%;"></th>
                            </tr>
                        </thead>
                        <tbody id="items_area"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <button type="submit" class="btn btn-primary">儲存訂單</button>
        <a href="{{ route('orders.index') }}" class="btn btn-secondary">取消</a>
    </form>

    {{-- 兩個彈窗都必須放在 <form> 之外，避免結果列的 radio 被一起送出 --}}
    <x-backend.lookup-modal />
    <x-backend.product.lookup-modal />

    {{-- 明細列範本：由 JS 複製並把 __INDEX__ 換成流水號 --}}
    <template id="item-row-template">
        <tr class="item-row">
            <td>
                <input type="text" class="form-control form-control-sm quick-product-serial" placeholder="產品編號" autocomplete="off">
                {{-- 真正送出的產品 id；由 ProductLookup 寫入，因此用 d-none 隱藏，不需要 select2 --}}
                <select name="items[__INDEX__][product_id]" class="d-none">
                    <option value="">請選擇產品</option>
                </select>
            </td>
            <td>
                <input type="text" class="form-control form-control-sm quick-product-name" readonly tabindex="-1">
            </td>
            <td>
                <input type="number" name="items[__INDEX__][qty]" class="form-control form-control-sm" value="1" min="1" max="9999">
            </td>
            <td class="text-end">
                <button type="button" class="btn btn-outline-danger btn-sm remove-item-row" aria-label="刪除明細">✕</button>
            </td>
        </tr>
    </template>
@endsection

@push('scripts')
<script>
    // 客戶：把欄位掛上彈窗搜尋。設定的意義請見 docs/lookup-contract.md
    Lookup.attach('select[name="customer_id"]', {
        title: '選擇客戶',
        url: '{{ route('customers.lookup') }}',
        generalFields: [
            { name: 'no', label: '客戶編號' },
            { name: 'name', label: '客戶名稱' },
        ],
        columns: [
            { key: 'no', label: '客戶編號', nowrap: true },
            { key: 'name', label: '客戶名稱' },
        ],
        display: '{no} - {name}',
        // 延遲載入：捲到底自動載入下一頁（單選仍是單選，只是結果不分頁）
        infiniteScroll: true,
    });

    // 明細列的新增與刪除
    var itemIndex = 0;
    function addItemRow() {
        var html = document.getElementById('item-row-template').innerHTML.replace(/__INDEX__/g, itemIndex++);
        $('#items_area').append(html);
    }
    $(document).on('click', '.add-item-row', addItemRow);
    $(document).on('click', '.remove-item-row', function () {
        $(this).closest('.item-row').remove();
    });

    // 產品快速輸入：編號按 Enter 精確查詢，找不到開彈窗；選取後寫回該列
    ProductLookup.init({
        infoUrl: '{{ route('products.lookup-info') }}',
        lookupUrl: '{{ route('products.lookup') }}',
        metadataUrl: '{{ route('products.lookup-metadata') }}',
        fieldOptionsUrl: '{{ route('products.lookup-field-options') }}',
        containerSelector: '#items_area',
        rowSelector: '.item-row',
        serialSelector: '.quick-product-serial',
        nameSelector: '.quick-product-name',
        selectSelector: 'select[name$="[product_id]"]',
        addRowSelector: '.add-item-row',
        // 多選：編號找不到或雙擊開窗時可勾選多筆，確認後第一筆填入當列、其餘各新增一列
        multiple: true,
        // 延遲載入：捲到底自動載入下一頁
        infiniteScroll: true,
    });

    // 多選：批次選取產品（延遲載入＋複選），確認後每筆加入一列明細
    ProductBatchLookup.attach({
        button: '.batch-add-products',
        url: '{{ route('products.lookup') }}',
        title: '批次選取產品',
        multipleConfirmText: '加入明細',
        addButton: '.add-item-row',
        area: '#items_area',
        row: '.item-row',
        productSelect: 'select[name$="[product_id]"]',
        infiniteScroll: true,
        chunkSize: 20,
        // 本示範沒有進階搜尋的欄位池，關閉進階頁籤，只用一般搜尋
        advanced: false,
        generalFields: [
            { name: 'product_serial', label: '產品編號' },
            { name: 'name', label: '產品名稱' },
        ],
        columns: [
            { key: 'product_serial', label: '產品編號', nowrap: true },
            { key: 'name', label: '產品名稱' },
            { key: 'price', label: '單價', align: 'end', headAlign: 'end' },
        ],
        display: '{product_serial} - {name}',
    });

    // 頁面載入時先放一列，使用者可以直接輸入
    addItemRow();
</script>
@endpush
