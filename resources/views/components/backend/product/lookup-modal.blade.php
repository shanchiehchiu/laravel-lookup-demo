@props([
    'id' => 'productLookupModal',
    'confirmId' => 'product_lookup_confirm',
    'resultsId' => 'product_lookup_results',
    'title' => '產品基本資料',
])
{{--
    產品基本資料查詢 Modal（共用元件）

    畫面規格採用「簡化單一搜尋框」樣式：
    只有一組欄位／運算子／值的搜尋條件，固定吃 product.product 欄位池
    （見 ProductSearchDefinition），不分一般／進階頁籤、不做多條件 AND/OR。

    行為邏輯不在這裡，全部由 public/js/product-lookup.js 提供。
    使用方式：

        <x-backend.product.lookup-modal />

        @push('javascript')
        <script src="{{ asset('js/product-lookup.js') }}"></script>
        <script>
            ProductLookup.init({
                infoUrl:   '{{ route("products.lookup-info") }}',
                lookupUrl: '{{ route("backend.products.lookup") }}',
                metadataUrl: '{{ route("backend.search.metadata", ["link" => "product.product"]) }}',
                fieldOptionsUrl: '{{ route("backend.products.field_options") }}',
            });
        </script>
        @endpush

    同一頁若需要兩組查詢視窗，必須傳入不同的 id / confirmId / resultsId，
    並在 ProductLookup.init() 以同名參數對應，避免事件互相搶奪。
--}}
<div class="modal fade" id="{{ $id }}" tabindex="-1" aria-labelledby="{{ $id }}Label" aria-hidden="true">
    <div class="modal-dialog product-lookup-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content bg-light">
            <div class="modal-header">
                <h5 class="modal-title" id="{{ $id }}Label">{{ $title }}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="關閉"></button>
            </div>
            <div class="modal-body product-lookup-modal-body">
                <div class="product-lookup-panel">
                    <p class="text-muted small mb-2">請選擇欄位、運算子並輸入搜尋值。</p>
                    <div class="row g-3">
                        <div class="col-md-4">
                            <select class="form-select" id="{{ $id }}_advanced_field">
                                <option value="">選擇欄位</option>
                            </select>
                        </div>
                        <div class="col-md-3">
                            <select class="form-select" id="{{ $id }}_advanced_operator" disabled></select>
                        </div>
                        <div class="col-md-3">
                            <input type="text" class="form-control" id="{{ $id }}_advanced_value" disabled>
                        </div>
                        <div class="col-md-2 d-flex align-items-start">
                            <button type="button" class="btn btn-primary btn-sm w-100" id="{{ $id }}_advanced_search">搜尋</button>
                        </div>
                    </div>
                </div>
                {{-- product-lookup-scroll：捲動載入時只有結果表捲動，表頭固定（樣式見下方） --}}
                <div class="table-responsive mt-3 product-lookup-scroll">
                    <table class="table table-striped table-vcenter">
                        {{-- 表頭只固定「選取」＋「產品編號」，第三欄是這次搜尋用到的欄位，由
                             public/js/product-lookup.js 的 renderResultsHead() 動態長出 --}}
                        <thead>
                            <tr id="{{ $id }}_results_head"></tr>
                        </thead>
                        <tbody id="{{ $resultsId }}"></tbody>
                    </table>
                </div>
                <div class="d-flex flex-wrap justify-content-center gap-2 mt-2" id="{{ $id }}_pager"></div>
                {{-- 確認區塊：多選模式才顯示，列出已勾選的產品，可個別移除；按確認才寫回明細 --}}
                <div class="product-lookup-selected mt-3 d-none" id="{{ $id }}_selected"></div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">關閉</button>
                <button type="button" class="btn btn-primary" id="{{ $confirmId }}">確認</button>
            </div>
        </div>
    </div>
</div>
@once
@push('style')
<style>
    .modal .product-lookup-dialog {
        max-width: 60vw;
    }
    .modal .product-lookup-modal-body {
        background-color: #f1f3f5;
    }
    .modal .product-lookup-panel {
        background-color: #e9ecef;
        border: 1px solid #ced4da;
        border-radius: 4px;
        padding: 16px;
    }
    .modal .product-lookup-modal-body .table-responsive {
        background-color: #ffffff;
        border: 1px solid #dee2e6;
    }
    .modal .product-lookup-modal-body .table {
        margin-bottom: 0;
    }
    /* 整列都可以點選，游標要提示可互動；比照 lookup-modal.blade.php */
    .modal .product-lookup-modal-body tbody tr {
        cursor: pointer;
    }
    /* Bootstrap 5 的 modal 是 1055、backdrop 是 1050，開啟中的 Select2 下拉要疊在 modal 之上
        */
    .select2-container--open {
        z-index: 1056;
    }
    /* 捲動載入：結果表有固定高度，只有它捲動；表頭黏在上方 */
    .modal .product-lookup-scroll {
        max-height: 50vh;
        overflow-y: auto;
    }
    .modal .product-lookup-scroll thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        background-color: #fff;
    }
    /* 確認區塊（已選清單） */
    .modal .product-lookup-selected {
        background-color: #fff;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        padding: 8px 12px;
    }
    .modal .product-lookup-chip {
        font-size: .85rem;
        font-weight: normal;
    }
</style>
@endpush
@endonce
