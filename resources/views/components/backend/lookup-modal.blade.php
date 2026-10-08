@props(['metadataUrl' => null])
{{--
    萬用 Lookup 彈窗骨架（規格見 docs/lookup-contract.md）。
    每頁放一個；標題、一般欄位、結果欄位、進階欄位池都由 public/js/lookup.js 依各欄位的設定產生。
    要用進階搜尋時傳入 metadata-url（欄位池 API 網址樣板，__LINK__ 會被換成欄位池名稱），
    沒傳就不會碰到搜尋引擎的路由，沒有搜尋引擎的專案也能用。
--}}
<div class="modal fade" id="lookupModal" tabindex="-1" aria-labelledby="lookupModalLabel" aria-hidden="true"
    @if($metadataUrl) data-metadata-url="{{ $metadataUrl }}" @endif>
    <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content bg-light">
            <div class="modal-header">
                <h5 class="modal-title" id="lookupModalLabel"></h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="關閉"></button>
            </div>
            <div class="modal-body lookup-modal-body">
                {{-- 預設一般／進階只會有一個生效（依 Lookup.attach 的 config 是否有 advanced 決定），
                     頁籤列預設不顯示；只有 advanced.allowAddCondition:true 的呼叫端（例如單號欄位
                     Lookup）才需要同時保留兩個模式讓使用者切換，由 lookup.js 的 open() 開關 --}}
                <ul class="nav nav-tabs" role="tablist" id="lookup_mode_tabs">
                    <li class="nav-item" id="lookup_mode_general_tab_item">
                        <button type="button" class="nav-link active" id="lookup_mode_general_tab" data-bs-toggle="tab" data-bs-target="#lookup_mode_general">一般</button>
                    </li>
                    <li class="nav-item" id="lookup_mode_advanced_tab_item">
                        <button type="button" class="nav-link" id="lookup_mode_advanced_tab" data-bs-toggle="tab" data-bs-target="#lookup_mode_advanced">進階</button>
                    </li>
                </ul>
                <div class="tab-content pt-3">
                    <div class="tab-pane fade show active" id="lookup_mode_general">
                        <div class="lookup-panel">
                            <div class="row g-3 mb-3" id="lookup_general_fields"></div>
                        </div>
                    </div>
                    <div class="tab-pane fade" id="lookup_mode_advanced">
                        <div class="lookup-panel">
                            <p class="text-muted small mb-2" id="lookup_advanced_hint"></p>
                            <div id="lookup_advanced_rows"></div>
                            <button type="button" class="btn btn-outline-primary btn-sm" id="lookup_advanced_add">
                                <i class="fa fa-plus me-1"></i>新增條件
                            </button>
                            <div class="text-end mt-2">
                                <button type="button" class="btn btn-primary btn-sm" id="lookup_advanced_search">搜尋</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="table-responsive mt-3">
                    <table class="table table-striped table-vcenter">
                        <thead>
                            <tr id="lookup_results_head"></tr>
                        </thead>
                        <tbody id="lookup_results"></tbody>
                    </table>
                </div>
                {{-- 複選模式的「已選 N 筆」區，內容由 lookup.js 產生；單選模式保持隱藏 --}}
                <div id="lookup_selected" class="lookup-selected mt-2 d-none"></div>
                <div id="lookup_pager" class="d-flex flex-wrap justify-content-center gap-2 mt-2"></div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">關閉</button>
                <button type="button" class="btn btn-primary" id="lookup_confirm">確認</button>
            </div>
        </div>
    </div>
</div>
@push('style')
<style>
    #lookupModal .modal-dialog {
        max-width: 90vw;
    }
    #lookupModal.lookup-simplified .modal-dialog {
        max-width: 60vw;
    }
    #lookupModal .lookup-modal-body {
        background-color: #f1f3f5;
    }
    #lookupModal .lookup-panel {
        background-color: #e9ecef;
        border: 1px solid #ced4da;
        border-radius: 4px;
        padding: 16px;
    }
    #lookupModal .table-responsive {
        background-color: #ffffff;
        border: 1px solid #dee2e6;
    }
    #lookupModal .table {
        margin-bottom: 0;
    }
    /* 整列都可以點選，游標要提示可互動 */
    #lookupModal #lookup_results tr {
        cursor: pointer;
    }
    /* 捲動載入模式：只有結果表本身捲動，上方搜尋欄位與已選區固定不動；
       表頭 sticky 避免捲動後對不上欄位 */
    #lookupModal .table-responsive.lookup-scroll-results {
        max-height: 50vh;
        overflow-y: auto;
    }
    #lookupModal .lookup-scroll-results thead th {
        position: sticky;
        top: 0;
        background-color: #ffffff;
        z-index: 1;
    }
    /* 一般頁籤（動態欄位）：挑選器＋搜尋鈕一行；條件是「欄名在上、輸入在下」的格狀排列，
       跟固定欄位的 form-label 樣式一致，不加卡片框線，灰色面板上只有輸入框是白底 */
    #lookupModal .lookup-panel:has(.lookup-dyn-toolbar) {
        padding: 24px 28px 28px;
    }
    #lookupModal .lookup-dyn-toolbar {
        display: flex;
        align-items: center;
        gap: .75rem;
        margin-bottom: 1.5rem;
    }
    #lookupModal .lookup-dyn-picker {
        flex: 0 1 26rem;
        min-width: 0;
    }
    #lookupModal .lookup-dyn-rows {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(23rem, 100%), 1fr));
        gap: 1.5rem 2rem;
    }
    #lookupModal .lookup-dyn-head {
        display: flex;
        align-items: center;
        gap: .5rem;
        margin-bottom: .5rem;
    }
    #lookupModal .lookup-dyn-label {
        flex: 1 1 auto;
        min-width: 0;
        color: #343a40;
        font-size: .95rem;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    #lookupModal .lookup-dyn-remove {
        flex: 0 0 auto;
        padding: 0 .25rem;
        color: #adb5bd;
        background: transparent;
        border: 0;
        line-height: 1;
    }
    #lookupModal .lookup-dyn-remove:hover {
        color: #dc3545;
    }
    #lookupModal .lookup-dyn-controls {
        display: flex;
        align-items: center;
        gap: .5rem;
    }
    #lookupModal .lookup-dyn-control {
        flex: 1 1 0;
        min-width: 0;
    }
    #lookupModal .lookup-dyn-sep {
        color: #6c757d;
    }
    #lookupModal .lookup-dyn-row:has(.lookup-dyn-enabled:not(:checked)) .lookup-dyn-label {
        color: #868e96;
        text-decoration: line-through;
    }
    #lookupModal .lookup-dyn-row:has(.lookup-dyn-enabled:not(:checked)) .lookup-dyn-controls {
        opacity: .5;
    }
    #lookupModal .lookup-selected {
        background-color: #ffffff;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        padding: 8px 12px;
    }
    #lookupModal .lookup-selected-chip {
        font-size: 0.85rem;
        font-weight: normal;
    }
    /* 欄位本身（.lookup-target-hidden、.lookup-display）的樣式由 lookup.js 注入，檢視頁沒有這個元件也要生效 */
</style>
@endpush
