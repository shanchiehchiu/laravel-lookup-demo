/**
 * 產品快速輸入 + 產品基本資料查詢 Modal（共用行為）
 *
 * 由既有單據頁面的產品輸入流程抽取而來。
 *
 * 搭配 <x-backend.product.lookup-modal /> 使用。
 *
 * 核心設計：本模組「只負責把選定的產品寫回該明細列」，
 * 絕不重寫各頁面自己的產品聯動（單價、單位、規格等）。
 * 在 idMode: 'select2' 之下，寫回後會對原本的 <select name="items[i][products_id]">
 * 觸發 change，讓 public/js/order.js 及該頁既有的 change handler 照原樣執行。
 *
 * 用法：
 *   var lookup = ProductLookup.init({
 *       infoUrl:   '{{ route("products.lookup-info") }}',
 *       lookupUrl: '{{ route("backend.products.lookup") }}',
 *       metadataUrl: '{{ route("backend.search.metadata", ["link" => "product.product"]) }}',
 *   });
 *
 * Modal 採用「簡化單一搜尋框」樣式，沒有一般／
 * 進階雙頁籤，只有欄位／運算子／值這組進階搜尋（靠 lookupUrl + metadataUrl 驅動，兩者
 * 都必填）。明細列上快速輸入編號按 Enter 找不到精確符合時，會直接帶著輸入值開窗、
 * 自動代入「產品編號 包含 輸入值」送出查詢，不用使用者再手動選一次欄位。
 *
 * 常用選項見下方 defaults。
 */
window.ProductLookup = (function ($) {
    'use strict';

    var defaults = {
        // --- API ---
        infoUrl: '',              // products.lookup-info（精確查詢，Enter / 確認後補完整資料用）
        depotsId: '',             // 精確查詢需要的倉別，多數表單傳空字串

        // --- 明細列 DOM 契約 ---
        containerSelector: '#product_area',   // 表身 tbody，事件只在此範圍內生效
        rowSelector: '.product_item',         // 單筆明細列
        serialSelector: '.quick-product-serial',
        nameSelector: '.quick-product-name',

        // --- 產品 ID 欄位 ---
        // 'select2'：保留原本的 select2 下拉（既有聯動 100% 不動，建議值）
        // 'hidden'  ：改用隱藏欄位承載 products_id（該作業已無 select2 時才用）
        idMode: 'select2',
        selectSelector: 'select[name$="[products_id]"]',
        hiddenSelector: 'input.product-id',

        // --- Modal DOM 契約（需與 <x-backend.product.lookup-modal /> 的參數一致）---
        modalId: 'productLookupModal',
        modalResultsId: 'product_lookup_results',
        modalConfirmId: 'product_lookup_confirm',

        // --- 進階搜尋（必填，驅動 Modal 內唯一的搜尋框）---
        lookupUrl: '',      // backend.products.lookup（萬用 Lookup 回應格式，搭配 metadataUrl 用）
        metadataUrl: '',    // backend.search.metadata?link=product.product
        fieldOptionsUrl: '', // backend.products.field_options；REMOTE_OPTION_FIELDS 這幾個欄位選「等於/不等於」時用它做即時關鍵字查詢

        // --- 操作行為 ---
        addRowSelector: '.add-template[data-target="product"]', // ArrowDown 觸發新增列；null 可關閉
        openOnEmptyEnter: false,   // 產品編號為空時按 Enter 是否也開 Modal
        syncFromSelect: false,     // select2 被選取後，是否反向把編號/名稱寫回快速欄位

        // --- 送出前驗證 ---
        validateFormSelector: null, // 例：'form[name="order"]'；設定後會擋下查無產品的明細

        // --- 擴充點 ---
        onApply: null,             // function ($row, product) 帶入產品後補寫該作業專屬欄位

        // --- 複選與延遲載入 ---
        // multiple：結果列改為可勾選，彈窗底部出現「已選」確認區塊；按確認時第一筆填入開窗的那一列，
        //           其餘每筆各新增一列（透過 addRowSelector 新增，列會加在表身最後）
        multiple: false,
        // infiniteScroll：結果不分頁，捲到底自動載入下一頁（延遲載入）；false 時維持上一頁／下一頁
        infiniteScroll: true,
    };

    function escapeHtml(value) {
        return $('<div>').text(value === null || value === undefined ? '' : value).html();
    }

    function inputTypeForFieldType(type) {
        if (type === 'date') return 'date';
        if (type === 'number') return 'number';
        return 'text';
    }

    // 進階搜尋值欄位的「所有結果」選項值；比照 lookup.js，特意不用空字串，避免被 select2 當成 placeholder 隱藏起來
    var ADVANCED_ALL_VALUE = '__lookup_all__';
    // 結果表第三欄預設顯示產品名稱（標題不走 metadata label——會帶「（基本資料）」頁籤
    // 後綴，比照「產品編號」寫死）；選到非識別欄的搜尋欄位時第三欄改顯示該欄位
    var NAME_FIELD_KEY = 'name';
    var NAME_FIELD_LABEL = '產品名稱';

    // distinct 值上看幾萬筆，沒辦法像其他欄位把全部選項塞進 metadata 一次性載入下拉
    // （見 docs/product-lookup.md 的欄位池說明），這幾個欄位選「等於/不等於」時改用
    // Select2 ajax 向 cfg.fieldOptionsUrl 查詢，比照後端 ProductLookupController::fieldOptions()
    // 的白名單。
    var REMOTE_OPTION_FIELDS = ['name', 'product_name', 'invoice_name', 'en_name', 'description', 'image_serial'];

    function create(options) {
        var cfg = $.extend({}, defaults, options || {});
        var ns = '.productLookup_' + cfg.modalId;
        var targetRow = null;
        var metadata = null;       // { fields: {key: field}, operators: {op: label} }，載入後整個實例生命週期內重用
        var lookupXhr = null;
        var currentExtraFieldKey = null; // 這次搜尋實際用的欄位；比照 lookup.js 的 currentExtraFieldKeys，
                                          // 結果表固定欄＝選取＋產品編號，第三欄動態長出目前搜尋的欄位；
                                          // 搜 product_serial／name 或尚未搜尋時帶產品名稱輔助辨識

        var $doc = $(document);
        var sel = {
            results: '#' + cfg.modalResultsId,
            resultsHead: '#' + cfg.modalId + '_results_head',
            confirm: '#' + cfg.modalConfirmId,
            advancedField: '#' + cfg.modalId + '_advanced_field',
            advancedOperator: '#' + cfg.modalId + '_advanced_operator',
            advancedValue: '#' + cfg.modalId + '_advanced_value',
            advancedSearch: '#' + cfg.modalId + '_advanced_search',
            pager: '#' + cfg.modalId + '_pager',
            selected: '#' + cfg.modalId + '_selected',
            scrollBox: '#' + cfg.modalId + ' .product-lookup-scroll',
            selectAll: '#' + cfg.modalId + '_select_all',
        };
        // 多選模式會改寫確認鈕文字（顯示筆數），這裡先記下原本的文字，取消選取時還原
        var confirmDefaultText = $('#' + cfg.modalConfirmId).text() || '確認';
        var selectedItems = [];   // 多選的已選產品：{ id, product_serial, name }，每次開窗清空
        var loadedRows = {};      // 目前已載入的結果列：id => 列資料
        var lastSearch = null;    // 上一次送出的查詢 { conditions }，翻頁與捲動載入重用
        var currentPage = 0;
        var lastPage = 0;
        var searchToken = 0;      // 每次新查詢遞增；已過期的回應直接丟棄，避免舊資料蓋過新結果
        // 事件限定在表身容器內，避免同頁其他表格（其他表格）誤觸
        var rowScope = cfg.containerSelector
            ? cfg.containerSelector + ' ' + cfg.serialSelector
            : cfg.serialSelector;

        function modalElement() {
            return document.getElementById(cfg.modalId);
        }

        // 頁面若在載入時對全部 <select> 套用 select2，搜尋值欄位會在執行期間動態
        // 重建成 <select>（見 refreshAdvancedValueInput），要手動初始化；固定綁 dropdownParent
        // 避免選單定位跟彈窗堆疊層級對不起來（比照 lookup.js 的 reinitSelect2）。
        function reinitSelect2($el, placeholder, extraOptions) {
            if ($el.hasClass('select2-hidden-accessible')) {
                $el.select2('destroy');
            }
            $el.select2($.extend({
                placeholder: placeholder || undefined,
                allowClear: !!placeholder,
                width: '100%',
                dropdownParent: $(modalElement()),
            }, extraOptions || {}));
        }

        /**
         * REMOTE_OPTION_FIELDS 專用：開下拉時才依打字關鍵字向 cfg.fieldOptionsUrl 查詢，
         * 不像其他 select 欄位把全部選項一次性塞進 <option>。預先放一個「所有結果」當預設
         * 選取值（select2 對已存在的 <option> 一樣能直接顯示，不會觸發 ajax），跟其他欄位
         * 切換過來時預設「不篩選」的狀態一致。
         */
        function initRemoteSelect($target, fieldKey) {
            $target.html('<option value="' + ADVANCED_ALL_VALUE + '" selected>所有結果</option>');
            reinitSelect2($target, '請選擇或輸入關鍵字搜尋', {
                ajax: {
                    url: cfg.fieldOptionsUrl,
                    dataType: 'json',
                    delay: 250,
                    data: function (params) {
                        return { field: fieldKey, term: params.term || '', page: params.page || 1 };
                    },
                    processResults: function (data) {
                        return data;
                    },
                    cache: true,
                },
            });
        }

        /** 把產品寫回指定明細列。這是整個模組唯一改動表單資料的地方。 */
        function applyProduct($row, product) {
            if (!$row || !$row.length || !product || !product.id) {
                return;
            }

            var serial = product.product_serial || '';
            var name = product.name || product.product_name || '';

            if (cfg.idMode === 'select2') {
                var $select = $row.find(cfg.selectSelector);
                if ($select.length) {
                    // 重建唯一 option 後觸發 change：該作業原有的產品聯動由此接手
                    $select.empty()
                        .append(new Option(serial + ' - ' + name, product.id, true, true))
                        .trigger('change');
                }
                // 由其他單據轉入的列會另外放一個 hidden products_id，一併同步才不會存到舊產品
                $row.find('input[type="hidden"][name$="[products_id]"]').val(product.id);
            } else {
                $row.find(cfg.hiddenSelector).val(product.id).trigger('change');
            }

            $row.find(cfg.serialSelector).val(serial);
            $row.find(cfg.nameSelector).val(name);

            if (typeof cfg.onApply === 'function') {
                cfg.onApply($row, product);
            }
        }

        /** 依 product_serial 或 id 取單筆產品；查無回傳 null。 */
        function fetchProduct(params, callback) {
            $.ajax({
                url: cfg.infoUrl,
                type: 'GET',
                dataType: 'json',
                data: $.extend({ depots_id: cfg.depotsId }, params),
            }).done(function (res) {
                callback(res && res.result && res.result.id ? res.result : null);
            }).fail(function () {
                callback(null);
            });
        }

        // 第三欄實際要顯示的欄位：搜非識別欄時是該欄位，否則帶產品名稱
        function extraFieldKey() {
            return currentExtraFieldKey || NAME_FIELD_KEY;
        }

        // 固定欄＝選取＋產品編號＋第三欄（搜尋欄位或產品名稱）
        function columnCount() {
            return 3;
        }

        // 「選取」固定 80px，產品編號與第三欄平分剩下的寬度
        function renderResultsHead() {
            var dataWidthStyle = ' style="width:50%;"';
            var key = extraFieldKey();
            var field = metadata && metadata.fields[key];
            var label = key === NAME_FIELD_KEY ? NAME_FIELD_LABEL : (field ? field.label : key);
            // 多選時第一欄改成「全選已載入」的勾選框，只勾目前已載入（含捲動載入）的列
            var selectHead = cfg.multiple
                ? '<th class="text-center" style="width:80px;"><input type="checkbox" class="form-check-input" id="' + cfg.modalId + '_select_all" title="全選已載入" aria-label="全選已載入"></th>'
                : '<th class="text-center" style="width:80px;">選取</th>';
            var html = selectHead
                + '<th class="text-start"' + dataWidthStyle + '>產品編號</th>'
                + '<th class="text-start"' + dataWidthStyle + '>' + escapeHtml(label) + '</th>';

            $(sel.resultsHead).html(html);
            $(sel.resultsHead).closest('table').css('table-layout', 'fixed');
        }

        // 額外欄位是 select／boolean 時，資料列存的是選項 value，用 metadata 的 options 換成名稱；
        // 換不到就顯示原始值，避免整格空白讓人誤以為查詢有誤（比照 lookup.js 的 formatExtraFieldValue）
        function formatExtraFieldValue(rawValue) {
            if (rawValue === null || rawValue === undefined || rawValue === '') {
                return '';
            }

            var field = metadata && metadata.fields[extraFieldKey()];
            if (field && (field.type === 'select' || field.type === 'boolean') && field.options && field.options.length) {
                var option = field.options.filter(function (o) { return String(o.value) === String(rawValue); })[0];
                if (option) {
                    return escapeHtml(option.name);
                }
            }

            return escapeHtml(rawValue);
        }

        // append=true：捲動載入的下一頁，接在既有列表後面（不清空，也不重畫表頭）
        function renderRows(list, append) {
            var key = extraFieldKey();
            var rows = (list || []).map(function (p) {
                var name = p.name || p.product_name || '';
                loadedRows[String(p.id)] = { id: p.id, product_serial: p.product_serial, name: name };
                // 多選用勾選框（可同時多筆），單選維持原本的單選鈕
                var checked = cfg.multiple && isSelected(p.id) ? ' checked' : '';
                return '<tr>'
                    + '<td class="text-center">'
                    + '<input type="' + (cfg.multiple ? 'checkbox' : 'radio') + '" class="form-check-input product-lookup-choice"'
                    + ' name="product_lookup_choice"'
                    + ' value="' + escapeHtml(p.id) + '"'
                    + ' data-product-serial="' + escapeHtml(p.product_serial) + '"'
                    + ' data-product-name="' + escapeHtml(name) + '"'
                    + checked + '>'
                    + '</td>'
                    + '<td class="text-start">' + escapeHtml(p.product_serial) + '</td>'
                    + '<td class="text-start">' + formatExtraFieldValue(key === NAME_FIELD_KEY ? name : p[key]) + '</td>'
                    + '</tr>';
            }).join('');

            if (append) {
                $(sel.results).find('.product-lookup-loading-more').remove();
                $(sel.results).append(rows);
            } else {
                $(sel.results).html(rows || '<tr><td colspan="' + columnCount() + '" class="text-center text-muted">查無資料</td></tr>');
            }
            syncSelectAll();
        }

        // ---- 多選：已選清單（確認區塊）----

        function isSelected(id) {
            return selectedItems.some(function (item) { return String(item.id) === String(id); });
        }

        // 從結果列的 data 屬性讀出一筆選取資料（用 attr 而不是 data，避免數字字串被轉型）
        function itemFromCheckbox($box) {
            return {
                id: $box.val(),
                product_serial: $box.attr('data-product-serial'),
                name: $box.attr('data-product-name'),
            };
        }

        // 一次更新多筆的選取狀態，只重畫一次確認區塊
        function setSelectedMany(items, checked) {
            var ids = items.map(function (item) { return String(item.id); });
            selectedItems = selectedItems.filter(function (item) {
                return ids.indexOf(String(item.id)) === -1;
            });
            if (checked) {
                items.forEach(function (item) {
                    selectedItems.push({ id: item.id, product_serial: item.product_serial, name: item.name });
                });
            }
            renderSelected();
            syncSelectAll();
        }

        // 全選框只看目前已載入的列；全部勾起來時才勾選
        function syncSelectAll() {
            if (!cfg.multiple) {
                return;
            }
            var $boxes = $(sel.results).find('.product-lookup-choice');
            $(sel.selectAll).prop('checked', $boxes.length > 0 && $boxes.filter(':not(:checked)').length === 0);
        }

        // 確認區塊：列出已選的產品（可個別移除），確認鈕顯示筆數
        function renderSelected() {
            if (!cfg.multiple) {
                return;
            }
            var $box = $(sel.selected);
            if (!selectedItems.length) {
                $box.addClass('d-none').empty();
            } else {
                var chips = selectedItems.map(function (item) {
                    return '<span class="badge text-bg-light border product-lookup-chip me-1 mb-1">'
                        + escapeHtml(item.product_serial) + ' - ' + escapeHtml(item.name)
                        + '<button type="button" class="btn-close ms-1" data-remove-id="' + escapeHtml(item.id) + '" aria-label="移除"></button>'
                        + '</span>';
                }).join('');
                $box.removeClass('d-none').html(
                    '<div class="small text-muted mb-1">已選 ' + selectedItems.length + ' 筆（按確認加入明細）</div>' + chips
                );
            }
            $(sel.confirm).text(selectedItems.length ? '加入 ' + selectedItems.length + ' 筆' : confirmDefaultText);
        }

        // 多選確認：第一筆填入開窗的那一列，其餘各新增一列；每筆都以 id 取完整資料，取不到就用清單資料
        function confirmMultiple() {
            if (!selectedItems.length || !targetRow) {
                return;
            }
            var picks = selectedItems.slice();
            var $startRow = targetRow;

            Promise.all(picks.map(function (item) {
                return new Promise(function (resolve) {
                    fetchProduct({ id: item.id }, function (product) {
                        resolve(product || item);
                    });
                });
            })).then(function (products) {
                products.forEach(function (product, index) {
                    var $row = index === 0 ? $startRow : addRow();
                    if ($row) {
                        applyProduct($row, product);
                    }
                });
                selectedItems = [];
                renderSelected();
                close();
            });
        }

        // 新增一列明細，回傳新列；沒有設定 addRowSelector 時回傳 null（多選只會填入第一筆）
        function addRow() {
            if (!cfg.addRowSelector) {
                return null;
            }
            var $container = $(cfg.containerSelector);
            var before = $container.find(cfg.rowSelector).length;
            $(cfg.addRowSelector).first().trigger('click');
            var $rows = $container.find(cfg.rowSelector);
            return $rows.length > before ? $rows.last() : null;
        }

        function renderPager(currentPage, lastPage, onPage) {
            var $pager = $(sel.pager);
            if (!lastPage || lastPage <= 1) {
                $pager.empty();
                return;
            }

            $pager.html(
                '<button type="button" class="btn btn-sm btn-outline-secondary" data-page="' + (currentPage - 1) + '"' + (currentPage <= 1 ? ' disabled' : '') + '>上一頁</button>'
                + '<span class="align-self-center small text-muted">第 ' + currentPage + ' / ' + lastPage + ' 頁</span>'
                + '<button type="button" class="btn btn-sm btn-outline-secondary" data-page="' + (currentPage + 1) + '"' + (currentPage >= lastPage ? ' disabled' : '') + '>下一頁</button>'
            );
            $pager.find('button:not(:disabled)').on('click', function () {
                onPage(parseInt($(this).data('page'), 10));
            });
        }

        /** 進階頁籤的欄位池，載入一次後整個 modal 實例共用；field dropdown 的選項也在這裡一併建立 */
        function loadMetadata(callback) {
            if (metadata) {
                callback(metadata);
                return;
            }

            $.getJSON(cfg.metadataUrl).done(function (response) {
                var fields = {};
                (response.fields || []).forEach(function (field) {
                    fields[field.key] = field;
                });
                metadata = { fields: fields, operators: response.operators || {} };

                var options = '<option value="">選擇欄位</option>' + (response.fields || []).map(function (field) {
                    return '<option value="' + escapeHtml(field.key) + '">' + escapeHtml(field.label) + '</option>';
                }).join('');
                $(sel.advancedField).html(options);
                // 頁面若在載入當下就把這顆 <select> 套成 select2，沒有指定
                // dropdownParent，下拉（含搜尋框）會被附加到 <body> 而非 modal 底下。
                // Bootstrap 5 modal 的 _enforceFocus() 偵測到 focus 落在 modal 範圍外時
                // 會強制把焦點拉回 modal 本身，導致搜尋框看起來打開了卻完全打不進字、
                // 看不到游標。比照 advancedValue／initRemoteSelect 用 reinitSelect2()
                // 重新綁定 dropdownParent 到 modal 本身即可解決。
                reinitSelect2($(sel.advancedField), '選擇欄位');

                callback(metadata);
            }).fail(function () {
                callback({ fields: {}, operators: {} });
            });
        }

        // select／boolean 欄位只有「等於」「不等於」用下拉選單，其餘運算子改用文字輸入框
        // （比照 lookup.js 進階頁籤的做法，見 refreshRowValueInput）。REMOTE_OPTION_FIELDS
        // 這幾個欄位 options 刻意是空的（distinct 值太多沒辦法 eager 載入，見
        // 欄位池的說明），要先判斷、優先走 initRemoteSelect()，
        // 不會落入下面 useSelect 的 field.options.length 判斷。
        function refreshAdvancedValueInput() {
            var fieldKey = $(sel.advancedField).val();
            var field = metadata && metadata.fields[fieldKey];
            var $value = $(sel.advancedValue);
            if (!field) {
                $value.val('').prop('disabled', true);
                return;
            }

            var operator = $(sel.advancedOperator).val();
            var isEqOrNeq = operator === 'eq' || operator === 'neq';
            var useRemoteSelect = isEqOrNeq && REMOTE_OPTION_FIELDS.indexOf(fieldKey) !== -1;
            var useSelect = !useRemoteSelect && (field.type === 'select' || field.type === 'boolean')
                && field.options && field.options.length && isEqOrNeq;

            if (useRemoteSelect) {
                var $remoteTarget;
                if ($value.is('select')) {
                    if ($value.hasClass('select2-hidden-accessible')) {
                        $value.select2('destroy');
                    }
                    $remoteTarget = $value;
                } else {
                    $remoteTarget = $('<select class="form-select" id="' + cfg.modalId + '_advanced_value"></select>');
                    $value.replaceWith($remoteTarget);
                }
                initRemoteSelect($remoteTarget, fieldKey);
            } else if (useSelect) {
                // 「所有結果」放最上方，選了等於不篩選這個欄位
                var optionsHtml = '<option value="' + ADVANCED_ALL_VALUE + '">所有結果</option>' + field.options.map(function (option) {
                    return '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.name) + '</option>';
                }).join('');

                var $target;
                if ($value.is('select')) {
                    if ($value.hasClass('select2-hidden-accessible')) {
                        $value.select2('destroy');
                    }
                    $target = $value.html(optionsHtml);
                } else {
                    $target = $('<select class="form-select" id="' + cfg.modalId + '_advanced_value"></select>').html(optionsHtml);
                    $value.replaceWith($target);
                }
                reinitSelect2($target, '請選擇');
            } else if ($value.is('select')) {
                if ($value.hasClass('select2-hidden-accessible')) {
                    $value.select2('destroy');
                }
                $value.replaceWith('<input type="' + inputTypeForFieldType(field.type) + '" class="form-control" id="' + cfg.modalId + '_advanced_value">');
            } else {
                $value.prop('type', inputTypeForFieldType(field.type));
            }

            $(sel.advancedValue).prop('disabled', false);
        }

        function advancedSearch(page) {
            var field = $(sel.advancedField).val();
            var operator = $(sel.advancedOperator).val();
            var value = $(sel.advancedValue).val();

            // 第三欄顯示本次搜尋欄位；搜識別欄（product_serial）或名稱欄本身時不長重複欄，
            // 由 extraFieldKey() 回退成產品名稱；查詢條件不變
            currentExtraFieldKey = (field && field !== 'product_serial' && field !== NAME_FIELD_KEY) ? field : null;
            renderResultsHead();

            var isAllValue = value === ADVANCED_ALL_VALUE;
            if (!field || !operator || (!isAllValue && (value === '' || value === undefined || value === null))) {
                $(sel.results).html('<tr><td colspan="' + columnCount() + '" class="text-center text-muted">請選擇欄位、運算子並輸入搜尋值</td></tr>');
                $(sel.pager).empty();
                lastSearch = null;
                return;
            }

            // 選「所有結果」＝不篩選這個條件，送空陣列給後端就是不加 where，回傳整個欄位池
            var conditions = isAllValue ? [] : [{ boolean: 'and', field: field, operator: operator, value: value }];
            lastSearch = { conditions: conditions };
            runSearch(1, false);
        }

        /**
         * 送出查詢：第一頁（新查詢）、翻頁（非捲動模式）或捲動載入下一頁（append=true）。
         * 查詢條件固定用 lastSearch，所以翻頁與捲動載入不會因為欄位已被使用者改掉而查錯。
         */
        function runSearch(page, append) {
            if (!lastSearch) {
                return;
            }

            // 新查詢才遞增 token；捲動載入沿用目前的 token，才不會把舊查詢的頁接到新結果後面
            var token = append ? searchToken : ++searchToken;

            if (lookupXhr) {
                lookupXhr.abort();
            }

            if (append) {
                $(sel.results).append('<tr class="product-lookup-loading-more"><td colspan="' + columnCount() + '" class="text-center text-muted">載入中...</td></tr>');
            } else {
                $(sel.results).html('<tr><td colspan="' + columnCount() + '" class="text-center text-muted">搜尋中...</td></tr>');
                $(sel.pager).empty();
                loadedRows = {};
            }

            var request = $.ajax({
                url: cfg.lookupUrl,
                type: 'GET',
                dataType: 'json',
                data: {
                    page: page || 1,
                    search_conditions: JSON.stringify(lastSearch.conditions),
                },
            }).done(function (response) {
                if (token !== searchToken) {
                    return;
                }
                currentPage = response.current_page || 1;
                lastPage = response.last_page || 1;
                renderRows(response.datas || [], append);
                if (cfg.infiniteScroll) {
                    $(sel.pager).empty();
                } else {
                    renderPager(currentPage, lastPage, function (nextPage) {
                        runSearch(nextPage, false);
                    });
                }
            }).fail(function (xhr, status) {
                if (status === 'abort') return;
                if (append) {
                    $(sel.results).find('.product-lookup-loading-more').remove();
                    return;
                }
                $(sel.results).html('<tr><td colspan="' + columnCount() + '" class="text-center text-danger">查詢失敗</td></tr>');
            }).always(function () {
                if (lookupXhr === request) {
                    lookupXhr = null;
                }
                maybeLoadNext();
            });

            lookupXhr = request;
        }

        // 捲動載入的底部判斷：用 getBoundingClientRect 比較哨兵與捲動容器底部，
        // 不用 scrollTop/scrollHeight 算術，避免瀏覽器縮放時的捨入誤差（比照 lookup.js）
        function isScrollBoxNearBottom() {
            var box = document.querySelector(sel.scrollBox);
            var sentinel = document.getElementById(cfg.modalId + '_scroll_sentinel');
            if (!box || !sentinel) {
                return false;
            }
            return sentinel.getBoundingClientRect().top <= box.getBoundingClientRect().bottom + 100;
        }

        // 還有下一頁、沒有請求在飛、彈窗開著、且已貼近底部，才自動載入下一頁；
        // 每次查詢完成都會再檢查一次，內容不足一屏時會連續載入直到可以捲動或全部載完
        function maybeLoadNext() {
            if (!cfg.infiniteScroll || !lastSearch || lookupXhr || currentPage >= lastPage) {
                return;
            }
            var el = modalElement();
            if (!el || !el.classList.contains('show')) {
                return;
            }
            if (!isScrollBoxNearBottom()) {
                return;
            }
            runSearch(currentPage + 1, true);
        }

        /** 把下拉選單裡「欄位」對應的運算子重新灌進「運算子」下拉，field 不存在時整組停用 */
        function populateOperators(fieldKey) {
            var field = metadata && metadata.fields[fieldKey];
            var $operator = $(sel.advancedOperator);
            $operator.empty();

            if (!field) {
                $operator.prop('disabled', true);
                $(sel.advancedValue).val('').prop('disabled', true);
                return;
            }

            (field.operators || []).filter(function (op) { return op !== 'between'; }).forEach(function (op) {
                $operator.append('<option value="' + escapeHtml(op) + '">' + escapeHtml((metadata.operators || {})[op] || op) + '</option>');
            });
            $operator.prop('disabled', false);
            refreshAdvancedValueInput();
            // 換欄位後原生 select 預設選到第一個 option（就是「所有結果」），要立刻同步鎖定狀態
            toggleOperatorForAllValue($(sel.advancedValue).val() === ADVANCED_ALL_VALUE);
        }

        // 選「所有結果」等於不篩選這個條件，運算子選什麼都沒意義，鎖住避免誤會
        function toggleOperatorForAllValue(isAll) {
            $(sel.advancedOperator).prop('disabled', isAll);
        }

        /**
         * 開啟 Modal。serial 有值時（雙擊帶入既有輸入、或 Enter 找不到精確符合）
         * 直接代入「產品編號 包含 serial」並自動送出查詢；serial 為空則單純開窗讓使用者
         * 自行選欄位，不自動查詢（沿用簡化搜尋框）。
         */
        function open($row, serial) {
            targetRow = $row;
            $(sel.results).empty();
            $(sel.pager).empty();
            // 每次開窗都是新的選取工作階段；把上一次還在飛的查詢作廢，避免舊結果寫進新視窗
            searchToken++;
            if (lookupXhr) {
                lookupXhr.abort();
            }
            selectedItems = [];
            loadedRows = {};
            lastSearch = null;
            currentPage = 0;
            lastPage = 0;
            renderSelected();

            loadMetadata(function () {
                currentExtraFieldKey = null;
                renderResultsHead();

                // Select2（全站套用於每個 <select>，見 layouts/main.blade.php）只在原生
                // change 事件觸發時才會重繪顯示文字，純 .val() 不會更新畫面，故每次
                // programmatic 設值都要補 .trigger('change')（沿用站內既有慣例）。
                var focusId = cfg.modalId + '_advanced_field';
                if (serial) {
                    $(sel.advancedField).val('product_serial').trigger('change');
                    $(sel.advancedOperator).val('contains').trigger('change');
                    $(sel.advancedValue).val(serial);
                    focusId = cfg.modalId + '_advanced_search';
                } else {
                    $(sel.advancedField).val('').trigger('change');
                    $(sel.advancedValue).val('');
                    $(sel.results).html('<tr><td colspan="' + columnCount() + '" class="text-center text-muted">請選擇欄位、運算子並輸入搜尋值</td></tr>');
                }

                var el = modalElement();
                if (!el) {
                    return;
                }

                el.addEventListener('shown.bs.modal', function () {
                    $('#' + focusId).trigger('focus');
                }, { once: true });
                bootstrap.Modal.getOrCreateInstance(el).show();

                if (serial) {
                    advancedSearch(1);
                }
            });
        }

        function close() {
            var instance = bootstrap.Modal.getInstance(modalElement());
            if (instance) {
                instance.hide();
            }
        }

        /** 產品編號欄按 Enter：精確命中直接帶入，查無則開 Modal 並帶入剛才輸入值。 */
        function resolveSerial($input) {
            var $row = $input.closest(cfg.rowSelector);
            var serial = $input.val().trim();

            if (!serial) {
                $row.find(cfg.nameSelector).val('');
                if (cfg.openOnEmptyEnter) {
                    open($row, '');
                }
                return;
            }

            fetchProduct({ product_serial: serial }, function (product) {
                if (product) {
                    applyProduct($row, product);
                } else {
                    open($row, serial);
                }
            });
        }

        // ---- 事件綁定（全部 delegated，動態新增的明細列自動生效）----
        $doc.on('keydown' + ns, rowScope, function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();   // 避免 Enter 直接送出整張表單
                resolveSerial($(this));
            } else if (event.key === 'ArrowDown' && cfg.addRowSelector) {
                event.preventDefault();
                $(cfg.addRowSelector).trigger('click');
            }
        }).on('dblclick' + ns, rowScope, function () {
            open($(this).closest(cfg.rowSelector), $(this).val().trim());
        // 點整列都能選，不用精準點到那顆 radio；比照 lookup.js 的結果列互動
        }).on('click' + ns, sel.results + ' tr', function (event) {
            if ($(event.target).is('input, label, a, button')) {
                return;
            }
            var $box = $(this).find('.product-lookup-choice');
            if (cfg.multiple) {
                // 多選：點整列切換勾選；勾選變更由下方 change 事件同步到已選清單
                $box.prop('checked', !$box.prop('checked')).trigger('change');
                return;
            }
            $box.prop('checked', true);
        }).on('dblclick' + ns, sel.results + ' tr', function () {
            // 多選不因雙擊直接送出，避免誤觸把剛勾的產品確認掉
            if (cfg.multiple) {
                return;
            }
            $(this).find('.product-lookup-choice').prop('checked', true);
            $(sel.confirm).trigger('click');
        }).on('change' + ns, sel.results + ' .product-lookup-choice', function () {
            if (!cfg.multiple) {
                return;
            }
            setSelectedMany([itemFromCheckbox($(this))], $(this).prop('checked'));
        }).on('change' + ns, sel.selectAll, function () {
            if (!cfg.multiple) {
                return;
            }
            var checked = $(this).prop('checked');
            var $boxes = $(sel.results).find('.product-lookup-choice');
            $boxes.prop('checked', checked);
            setSelectedMany($boxes.map(function () { return itemFromCheckbox($(this)); }).get(), checked);
        }).on('click' + ns, sel.selected + ' [data-remove-id]', function () {
            // 確認區塊的 ✕：移除該筆，並同步取消結果列上的勾選
            var id = String($(this).attr('data-remove-id'));
            $(sel.results).find('.product-lookup-choice').filter(function () {
                return String($(this).val()) === id;
            }).prop('checked', false);
            setSelectedMany([{ id: id }], false);
        }).on('click' + ns, sel.confirm, function () {
            if (cfg.multiple) {
                confirmMultiple();
                return;
            }
            var $choice = $(sel.results).find('.product-lookup-choice:checked');
            if (!$choice.length || !targetRow) {
                return;
            }

            var fallback = {
                id: $choice.val(),
                product_serial: $choice.data('product-serial'),
                name: $choice.data('product-name'),
            };
            var $row = targetRow;

            // 以 id 取完整資料（單位、售價、規格…）；取不到則退回清單提供的編號/名稱
            fetchProduct({ id: fallback.id }, function (product) {
                applyProduct($row, product || fallback);
                close();
            });
        });

        $doc.on('change' + ns, sel.advancedField, function () {
            populateOperators($(this).val());
        }).on('change' + ns, sel.advancedOperator, function () {
            refreshAdvancedValueInput();
        }).on('change' + ns, sel.advancedValue, function () {
            toggleOperatorForAllValue($(this).val() === ADVANCED_ALL_VALUE);
        }).on('click' + ns, sel.advancedSearch, function () {
            advancedSearch(1);
        }).on('keydown' + ns, sel.advancedValue, function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                advancedSearch(1);
            }
        });

        // select2 選取後反向同步快速欄位（附加 handler，不會覆蓋既有聯動）
        if (cfg.syncFromSelect && cfg.idMode === 'select2') {
            var selectScope = cfg.containerSelector
                ? cfg.containerSelector + ' ' + cfg.selectSelector
                : cfg.selectSelector;

            $doc.on('change' + ns, selectScope, function () {
                var $row = $(this).closest(cfg.rowSelector);
                var id = $(this).val();
                if (!id) {
                    return;
                }

                fetchProduct({ id: id }, function (product) {
                    if (!product) {
                        return;
                    }
                    $row.find(cfg.serialSelector).val(product.product_serial || '');
                    $row.find(cfg.nameSelector).val(product.name || product.product_name || '');
                });
            });
        }

        // 延遲載入：scroll 綁在實際捲動的 .product-lookup-scroll 上；哨兵只需要插入一次
        if (cfg.infiniteScroll) {
            var $scrollBox = $(sel.scrollBox);
            if ($scrollBox.length && !document.getElementById(cfg.modalId + '_scroll_sentinel')) {
                $scrollBox.append('<div id="' + cfg.modalId + '_scroll_sentinel" style="height:1px;"></div>');
            }
            $scrollBox.on('scroll' + ns, maybeLoadNext);
        }

        // 送出前擋下「打了編號但查無產品」的明細
        if (cfg.validateFormSelector) {
            $doc.on('submit' + ns, cfg.validateFormSelector, function (event) {
                var $form = $(this);
                if ($form.data('productLookupChecked')) {
                    $form.removeData('productLookupChecked');
                    return;
                }

                var inputs = $form.find(cfg.containerSelector + ' ' + cfg.serialSelector + ':not(:disabled)').get();
                if (!inputs.length) {
                    return;
                }

                event.preventDefault();
                event.stopImmediatePropagation();

                Promise.all(inputs.map(function (input) {
                    var serial = $(input).val().trim();
                    if (!serial) {
                        return Promise.resolve({ input: input, serial: '', valid: false });
                    }
                    return new Promise(function (resolve) {
                        fetchProduct({ product_serial: serial }, function (product) {
                            resolve({ input: input, serial: serial, valid: Boolean(product) });
                        });
                    });
                })).then(function (checks) {
                    var invalid = checks.find(function (check) { return !check.valid; });
                    if (invalid) {
                        alert(invalid.serial ? '此產品編號沒有對應的資訊：' + invalid.serial : '請輸入產品編號');
                        $(invalid.input).trigger('focus');
                        return;
                    }
                    $form.data('productLookupChecked', true).trigger('submit');
                });
            });
        }

        return {
            config: cfg,
            open: open,
            close: close,
            applyProduct: applyProduct,
            fetchProduct: fetchProduct,
            /** 解除本實例綁定的所有事件（同頁重複初始化或熱替換時使用） */
            destroy: function () {
                $doc.off(ns);
                $(sel.scrollBox).off(ns);
                if (lookupXhr) {
                    lookupXhr.abort();
                }
                targetRow = null;
            },
        };
    }

    return {
        defaults: defaults,
        init: create,
    };
})(jQuery);
