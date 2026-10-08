/**
 * 萬用 Lookup：彈窗選擇＋一般／進階搜尋（規格見 docs/lookup-contract.md）
 *
 * 核心檔案：不可引用任何專案的路由、model 或業務字串，業務設定放在 preset（lookup-presets.js）。
 * 頁面上只有一個 #lookupModal（<x-backend.lookup-modal />），每次開啟依該欄位的設定重新配置。
 *
 *   Lookup.attach(target, config)        在欄位上掛上 lookup，回傳 { open, clear, destroy }
 *   Lookup.attachButton(selector, config) 掛在按鈕上，沒有目標欄位，確認後只呼叫 onPick，回傳 { open, destroy }
 *   Lookup.definePreset(name, factory)   註冊設定組，factory(options) 回傳 config
 *   Lookup.preset(name, options)         取得設定組
 */
window.Lookup = (function ($) {
    'use strict';

    var MODAL_ID = 'lookupModal';
    var SEL = {
        title: '#lookupModalLabel',
        generalTab: '#lookup_mode_general_tab',
        advancedTab: '#lookup_mode_advanced_tab',
        advancedTabItem: '#lookup_mode_advanced_tab_item',
        generalFields: '#lookup_general_fields',
        generalSearch: '#lookup_general_search',
        generalPicker: '#lookup_general_picker',
        generalRows: '#lookup_general_rows',
        generalHint: '#lookup_general_hint',
        advancedHint: '#lookup_advanced_hint',
        advancedRows: '#lookup_advanced_rows',
        advancedAdd: '#lookup_advanced_add',
        advancedSearch: '#lookup_advanced_search',
        resultsHead: '#lookup_results_head',
        results: '#lookup_results',
        selected: '#lookup_selected',
        pager: '#lookup_pager',
        confirm: '#lookup_confirm',
    };
    var DEFAULT_HINT = '可依欄位新增條件並用 AND／OR 組合。';
    // advanced.allowAddCondition 預設不開放，進階頁籤收斂成單一條件搜尋框
    var SIMPLE_HINT = '請選擇欄位、運算子並輸入搜尋值。';

    var presets = {};
    var metadataCache = {}; // link => { fields: {key: field}, operators: {...} }
    var instanceCount = 0;
    var eventsBound = false;

    // 目前開啟中的彈窗狀態（同一時間只會開一個）
    var active = null;
    var currentRows = [];
    var currentExtraFieldKeys = [];
    var selectedItems = []; // 複選模式的已選項目：{ value, label, row }；row 為 null 代表來自欄位既有值
    var advancedRowCount = 0;
    var dynamicRowCount = 0;
    var lookupXhr = null;
    var lookupTimer = null;
    var lastParams = null; // 上次實際送出查詢的條件，翻頁／捲動載入時重用
    var currentPageNum = 0;
    var lastPageNum = 0;

    function escapeHtml(value) {
        // 也會被放進屬性值（如 data-lookup-field="..."），雙引號要一併轉義
        return $('<div>').text(value === null || value === undefined ? '' : String(value)).html().split('"').join('&quot;');
    }

    function resolve(value) {
        return typeof value === 'function' ? value() : value;
    }

    function getPath(row, path) {
        return String(path).split('.').reduce(function (carry, key) {
            return carry === null || carry === undefined ? undefined : carry[key];
        }, row);
    }

    function renderDisplay(display, row) {
        if (typeof display === 'function') {
            return display(row);
        }

        // 用 RegExp 字串寫法而非正規表示式字面值，括號配對檢查才不會把 {} 誤判成程式區塊
        return String(display).replace(new RegExp('\\{([^}]+)\\}', 'g'), function (match, path) {
            var value = getPath(row, path.trim());
            return value === null || value === undefined ? '' : value;
        });
    }

    function inputTypeForFieldType(type) {
        if (type === 'date') return 'date';
        if (type === 'number') return 'number';
        return 'text';
    }

    function modalElement() {
        return document.getElementById(MODAL_ID);
    }

    function notifyError(message) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({ icon: 'error', title: message, text: '請稍後再試' });
        } else {
            alert(message);
        }
    }

    // 頁面若在載入時對全部 <select> 套用 select2，動態產生在彈窗裡的下拉選單要手動
    // 初始化，並固定綁 dropdownParent，避免選單定位跟彈窗堆疊層級對不起來。
    function reinitSelect2($el, placeholder) {
        if ($el.hasClass('select2-hidden-accessible')) {
            $el.select2('destroy');
        }
        $el.select2({
            placeholder: placeholder || undefined,
            allowClear: !!placeholder,
            width: '100%',
            dropdownParent: $(modalElement()),
        });
    }

    // ==========================================
    // 欄位池 metadata（進階搜尋）
    // ==========================================

    function currentLink() {
        return active && active.cfg.advanced ? resolve(active.cfg.advanced.link) : null;
    }

    function currentMetadata() {
        return metadataCache[currentLink()] || { fields: {}, operators: {} };
    }

    // 進階頁籤預設不給「新增條件」，只保留一行搜尋框
    function allowAddCondition() {
        return !!(active && active.cfg.advanced && active.cfg.advanced.allowAddCondition);
    }

    // 「簡化模式」＝有設定 advanced 但沒開 allowAddCondition，才是這次改動要收斂的對象
    // （隱藏一般頁籤、頁籤列、結果表只留識別欄＋搜尋欄位）。單純只有 generalFields、
    // 從沒設定過 advanced 的呼叫端本來就簡單，不受影響、維持原樣。
    function simplified() {
        return !!(active && active.cfg.advanced) && !allowAddCondition();
    }

    // 一般／進階頁籤各自的欄位設定長在不同地方（generalFields 是呼叫端給的靜態清單，
    // 進階欄位池來自 metadata API），結果表的額外欄位要跟著目前模式去對應的地方找 label／options
    function currentModeField(key) {
        if (isAdvancedModeActive() || dynamicGeneral()) {
            return currentMetadata().fields[key];
        }
        return (active.cfg.generalFields || []).filter(function (f) { return f.name === key; })[0];
    }

    function loadMetadata(done) {
        var link = currentLink();
        if (!link || metadataCache[link]) {
            done(currentMetadata());
            return;
        }

        var template = $(modalElement()).data('metadataUrl');
        if (!template) {
            console.error('[Lookup] 設定了 advanced，但彈窗元件沒有傳入 metadata-url');
            return;
        }

        $.getJSON(String(template).replace('__LINK__', encodeURIComponent(link))).done(function (metadata) {
            var fields = {};
            (metadata.fields || []).forEach(function (field) {
                fields[field.key] = field;
            });
            metadataCache[link] = { fields: fields, operators: metadata.operators || {} };
            done(metadataCache[link]);
        }).fail(function () {
            notifyError('無法載入搜尋欄位');
        });
    }

    // ==========================================
    // 一般頁籤
    // ==========================================

    function renderGeneralFields(fields) {
        if (dynamicGeneral()) {
            renderDynamicGeneralSkeleton();
            return;
        }

        var html = (fields || []).map(function (field) {
            var type = field.type || 'text';
            var control;

            if (type === 'select') {
                // emptyLabel：空值選項（代表不限）要顯示的文字，未設定維持空白；false＝必須擇一，不給空值選項
                var emptyOption = field.emptyLabel === false ? '' : '<option value="">' + escapeHtml(field.emptyLabel || '') + '</option>';
                var options = emptyOption + (field.options || []).map(function (option) {
                    return '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.name) + '</option>';
                }).join('');
                control = '<select class="form-select lookup-general-field" data-lookup-field="' + escapeHtml(field.name) + '">' + options + '</select>';
            } else {
                control = '<input type="' + (type === 'date' ? 'date' : 'text') + '" class="form-control lookup-general-field" data-lookup-field="' + escapeHtml(field.name) + '">';
            }

            return '<div class="' + (type === 'text' ? 'col-md-3' : 'col-md-2') + '">'
                + '<label class="form-label">' + escapeHtml(field.label) + '</label>'
                + control
                + '</div>';
        }).join('');

        html += '<div class="col-md-2 d-flex align-items-end">'
            + '<button type="button" class="btn btn-primary btn-sm w-100" id="lookup_general_search">搜尋</button>'
            + '</div>';

        $(SEL.generalFields).html(html);
    }

    // ==========================================
    // 一般頁籤（動態欄位）：挑欄位加條件列，條件之間一律 AND
    // ==========================================

    // advanced.dynamicGeneral：一般頁籤不用呼叫端的 generalFields 固定欄位，改成從進階欄位池
    // 挑欄位加條件列（採用一般頁籤的挑欄位模式）。沒開的呼叫端維持固定欄位。
    function dynamicGeneral() {
        return !!(active && active.cfg.advanced && active.cfg.advanced.dynamicGeneral);
    }

    // 欄位在動態一般頁籤的輸入方式；回傳 null 代表這種欄位在一般頁籤沒有合理的輸入方式（不給挑）：
    //   contains     文字：單一輸入框、包含比對（產品名稱做字典序區間沒有意義，所以不用起始～結束）
    //   range        數字／日期：起始～結束，可只填單邊
    //   range-select 有固定編碼可比範圍的下拉：起始～結束的下拉
    //   eq-select    固定選項（含是／否）：單一下拉、等於比對
    function dynamicRowKind(field) {
        if (field.type === 'select' || field.type === 'boolean') {
            if (field.rangeOptions && field.rangeOptions.length) {
                return 'range-select';
            }
            return field.options && field.options.length ? 'eq-select' : null;
        }
        return (field.type === 'number' || field.type === 'date') ? 'range' : 'contains';
    }

    function renderDynamicGeneralSkeleton() {
        dynamicRowCount = 0;
        $(SEL.generalFields).html(
            '<div class="col-12">'
                + '<div class="lookup-dyn-toolbar">'
                    + '<div class="lookup-dyn-picker"><select class="form-select" id="lookup_general_picker"><option value=""></option></select></div>'
                    + '<button type="button" class="btn btn-primary btn-sm px-4" id="lookup_general_search">搜尋</button>'
                + '</div>'
            + '</div>'
            + '<div class="col-12">'
                + '<p class="text-muted small mb-2" id="lookup_general_hint">尚未加入任何條件，請從上方選擇欄位開始。</p>'
                + '<div class="lookup-dyn-rows" id="lookup_general_rows"></div>'
            + '</div>'
        );
    }

    function optionsHtml(list) {
        return (list || []).map(function (option) {
            return '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.name) + '</option>';
        }).join('');
    }

    function usedDynamicFieldKeys() {
        return $(SEL.generalRows + ' .lookup-dyn-row').map(function () {
            return String($(this).data('field'));
        }).get();
    }

    // 已加入條件的欄位不再出現在挑選器；每次加入／移除後重建，欄位順序維持欄位池的順序
    function refreshDynamicPicker() {
        var fields = currentMetadata().fields;
        var used = usedDynamicFieldKeys();
        var html = '<option value=""></option>' + Object.keys(fields).filter(function (key) {
            return dynamicRowKind(fields[key]) && used.indexOf(key) === -1;
        }).map(function (key) {
            return '<option value="' + escapeHtml(key) + '">' + escapeHtml(fields[key].label) + '</option>';
        }).join('');

        reinitSelect2($(SEL.generalPicker).html(html), '選擇欄位加入條件…');
        $(SEL.generalHint).toggleClass('d-none', used.length > 0);
    }

    // label：覆寫欄位池的名稱（預設帶入的列沿用呼叫端 generalFields 的名稱，跟結果表欄名一致）
    function addDynamicRow(fieldKey, label) {
        var field = currentMetadata().fields[fieldKey];
        var kind = field ? dynamicRowKind(field) : null;
        if (!kind || usedDynamicFieldKeys().indexOf(String(fieldKey)) !== -1) {
            return;
        }

        dynamicRowCount++;
        var control = function (html) { return '<div class="lookup-dyn-control">' + html + '</div>'; };
        var separator = '<span class="lookup-dyn-sep">~</span>';
        var controls;
        if (kind === 'range-select') {
            var rangeOptions = optionsHtml(field.rangeOptions);
            controls = control('<select class="form-select lookup-dyn-from"><option value="">起始</option>' + rangeOptions + '</select>')
                + separator
                + control('<select class="form-select lookup-dyn-to"><option value="">結束</option>' + rangeOptions + '</select>');
        } else if (kind === 'eq-select') {
            controls = control('<select class="form-select lookup-dyn-eq"><option value="">請選擇</option>' + optionsHtml(field.options) + '</select>');
        } else if (kind === 'range') {
            var type = inputTypeForFieldType(field.type);
            controls = control('<input type="' + type + '" class="form-control lookup-dyn-from" placeholder="起始值">')
                + separator
                + control('<input type="' + type + '" class="form-control lookup-dyn-to" placeholder="結束值">');
        } else {
            controls = control('<input type="text" class="form-control lookup-dyn-contains" placeholder="包含…">');
        }

        var labelText = label || field.label;
        var $row = $(
            '<div class="lookup-dyn-row" id="lookup-dyn-row-' + dynamicRowCount + '" data-field="' + escapeHtml(fieldKey) + '">'
                + '<div class="lookup-dyn-head">'
                    + '<input type="checkbox" class="form-check-input lookup-dyn-enabled" checked title="取消勾選可暫時停用這個條件">'
                    + '<span class="lookup-dyn-label" title="' + escapeHtml(labelText) + '">' + escapeHtml(labelText) + '</span>'
                    + '<button type="button" class="lookup-dyn-remove" title="移除這個條件"><i class="fa fa-times"></i></button>'
                + '</div>'
                + '<div class="lookup-dyn-controls">' + controls + '</div>'
            + '</div>'
        );

        $(SEL.generalRows).append($row);
        reinitSelect2($row.find('.lookup-dyn-from'), '起始');
        reinitSelect2($row.find('.lookup-dyn-to'), '結束');
        reinitSelect2($row.find('.lookup-dyn-eq'), '請選擇');
    }

    // 開窗時先帶入呼叫端 generalFields 對應的欄位，維持原本「編號、名稱、規格」現成可輸入的操作，
    // 不用每次都先去挑欄位；對不到欄位池的 name 就略過
    function seedDynamicRows() {
        if (!dynamicGeneral() || !$(SEL.generalPicker).length) {
            return;
        }

        (active.cfg.generalFields || []).forEach(function (field) {
            addDynamicRow(field.name, field.label);
        });
        refreshDynamicPicker();
    }

    // 數字／日期只填單邊用 gte／lte，兩邊都填才用 between；有固定編碼的下拉沒有 gte／lte，
    // 只選一邊就當作那一筆（起始＝結束）
    function buildDynamicConditions() {
        var conditions = [];
        var filled = function (value) { return value !== '' && value !== null && value !== undefined; };

        $(SEL.generalRows + ' .lookup-dyn-row').each(function () {
            var $row = $(this);
            if (!$row.find('.lookup-dyn-enabled').is(':checked')) {
                return;
            }

            var field = String($row.data('field'));
            var meta = currentMetadata().fields[field];
            var push = function (operator, value, valueTo) {
                var condition = { boolean: 'and', field: field, operator: operator, value: value };
                if (valueTo !== undefined) {
                    condition.value_to = valueTo;
                }
                conditions.push(condition);
            };

            var $eq = $row.find('.lookup-dyn-eq');
            if ($eq.length) {
                if (filled($eq.val())) {
                    push('eq', $eq.val());
                }
                return;
            }

            var $contains = $row.find('.lookup-dyn-contains');
            if ($contains.length) {
                var text = $.trim($contains.val());
                if (text !== '') {
                    push('contains', text);
                }
                return;
            }

            var from = $row.find('.lookup-dyn-from').val();
            var to = $row.find('.lookup-dyn-to').val();
            if (filled(from) && filled(to)) {
                push('between', from, to);
            } else if (filled(from) || filled(to)) {
                var single = filled(from) ? from : to;
                if (meta && dynamicRowKind(meta) === 'range-select') {
                    push('between', single, single);
                } else {
                    push(filled(from) ? 'gte' : 'lte', single);
                }
            }
        });

        return conditions;
    }

    // ==========================================
    // 進階頁籤（欄位／運算子／AND-OR 條件列）
    // ==========================================

    function advancedBooleanToggleHtml() {
        return '<div class="btn-group btn-group-sm lookup-advanced-boolean-group me-2" role="group">'
            + '<button type="button" class="btn btn-secondary lookup-advanced-boolean-btn active" data-value="and">AND</button>'
            + '<button type="button" class="btn btn-outline-secondary lookup-advanced-boolean-btn" data-value="or">OR</button>'
            + '</div>';
    }

    // 第一列前面沒有條件可以組合，不顯示 AND／OR；刪掉第一列後原本的第二列會補位，
    // 所以新增、刪除後都要重新校正
    function renumberAdvancedRows() {
        $(SEL.advancedRows + ' .lookup-advanced-row').each(function (index) {
            var $head = $(this).find('.lookup-advanced-row-head');
            var $toggle = $head.find('.lookup-advanced-boolean-group');
            if (index === 0) {
                $toggle.remove();
            } else if (!$toggle.length) {
                $head.prepend(advancedBooleanToggleHtml());
            }
        });
    }

    function addAdvancedRow(fields) {
        advancedRowCount++;

        var fieldOptions = Object.keys(fields).map(function (key) {
            return '<option value="' + escapeHtml(key) + '">' + escapeHtml(fields[key].label) + '</option>';
        }).join('');

        // 不給新增條件時只會有這一行，沒有「刪除」的意義（刪了也拿不回來，按鈕藏著）
        var removeButtonHtml = allowAddCondition()
            ? '<button type="button" class="btn btn-sm btn-outline-danger lookup-advanced-remove"><i class="fa fa-trash me-1"></i>刪除</button>'
            : '';

        var $row = $(
            '<div class="border rounded-3 p-3 mb-3 lookup-advanced-row" id="lookup-advanced-row-' + advancedRowCount + '">'
                + '<div class="d-flex justify-content-between align-items-center mb-2">'
                    + '<div class="d-flex align-items-center lookup-advanced-row-head">' + advancedBooleanToggleHtml() + '</div>'
                    + removeButtonHtml
                + '</div>'
                + '<div class="row g-2">'
                    + '<div class="col-12 col-sm-5">'
                        + '<select class="form-select lookup-advanced-field"><option value="">選擇欄位</option>' + fieldOptions + '</select>'
                    + '</div>'
                    + '<div class="col-12 col-sm-3">'
                        + '<select class="form-select lookup-advanced-operator" disabled></select>'
                    + '</div>'
                    + '<div class="col-12 col-sm-4">'
                        + '<input type="text" class="form-control lookup-advanced-value" disabled>'
                    + '</div>'
                + '</div>'
            + '</div>'
        );

        $(SEL.advancedRows).append($row);
        reinitSelect2($row.find('.lookup-advanced-field'), '選擇欄位');
        renumberAdvancedRows();
    }

    function refreshRowOperators($row) {
        var metadata = currentMetadata();
        var field = metadata.fields[$row.find('.lookup-advanced-field').val()];
        var $operator = $row.find('.lookup-advanced-operator');

        $operator.empty();

        if (!field) {
            $operator.prop('disabled', true);
            $row.find('.lookup-advanced-value').prop('disabled', true);
            reinitSelect2($operator, null);
            return;
        }

        (field.operators || []).filter(function (op) { return op !== 'between'; }).forEach(function (op) {
            $operator.append('<option value="' + escapeHtml(op) + '">' + escapeHtml(metadata.operators[op] || op) + '</option>');
        });
        $operator.prop('disabled', false);
        reinitSelect2($operator, null);

        refreshRowValueInput($row);
    }

    // select／boolean 欄位只有「等於」「不等於」用下拉選單；其他運算子（包含、大於…）要打的是
    // 字串本身，不會剛好是選項清單裡的某一筆，一律改成文字輸入框。
    function refreshRowValueInput($row) {
        var field = currentMetadata().fields[$row.find('.lookup-advanced-field').val()];
        var $value = $row.find('.lookup-advanced-value');
        if (!field) {
            return;
        }

        var operator = $row.find('.lookup-advanced-operator').val();
        var useSelect = (field.type === 'select' || field.type === 'boolean') && field.options && field.options.length
            && (operator === 'eq' || operator === 'neq');

        if (useSelect) {
            var optionsHtml = field.options.map(function (option) {
                return '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.name) + '</option>';
            }).join('');

            var $target;
            if ($value.is('select')) {
                if ($value.hasClass('select2-hidden-accessible')) {
                    $value.select2('destroy');
                }
                $target = $value.html(optionsHtml).prop('disabled', false);
            } else {
                $target = $('<select class="form-select lookup-advanced-value">' + optionsHtml + '</select>');
                $value.replaceWith($target);
            }
            reinitSelect2($target, '請選擇');
        } else if ($value.is('select')) {
            if ($value.hasClass('select2-hidden-accessible')) {
                $value.select2('destroy');
            }
            $value.replaceWith('<input type="' + inputTypeForFieldType(field.type) + '" class="form-control lookup-advanced-value">');
        } else {
            $value.prop('type', inputTypeForFieldType(field.type)).prop('disabled', false);
        }
    }

    function resetAdvancedRows() {
        $(SEL.advancedRows).empty();
        advancedRowCount = 0;
    }

    function ensureFirstAdvancedRow() {
        loadMetadata(function (metadata) {
            if (!$(SEL.advancedRows + ' .lookup-advanced-row').length) {
                addAdvancedRow(metadata.fields);
            }
        });
    }

    function buildAdvancedConditions() {
        var conditions = [];
        $(SEL.advancedRows + ' .lookup-advanced-row').each(function () {
            var $row = $(this);
            var field = $row.find('.lookup-advanced-field').val();
            var operator = $row.find('.lookup-advanced-operator').val();
            var value = $row.find('.lookup-advanced-value').val();

            if (!field || !operator || value === '' || value === undefined || value === null) {
                return;
            }

            conditions.push({
                // 第一條沒有前一條可以組合，一律視為 and（前面有空白列被略過時也一樣）
                boolean: conditions.length === 0 ? 'and' : ($row.find('.lookup-advanced-boolean-btn.active').data('value') || 'and'),
                field: field,
                operator: operator,
                value: value,
            });
        });
        return conditions;
    }

    function isAdvancedModeActive() {
        return $(SEL.advancedTab).hasClass('active');
    }

    // 額外欄位是 select／boolean 時，資料列存的是選項 value，用 metadata 的 options 換成名稱；
    // 換不到就顯示原始值，避免整格空白讓人誤以為查詢有誤。
    function formatExtraFieldValue(fieldKey, rawValue) {
        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return '';
        }

        var field = currentModeField(fieldKey);
        if (field && (field.type === 'select' || field.type === 'boolean') && field.options && field.options.length) {
            var option = field.options.filter(function (o) { return String(o.value) === String(rawValue); })[0];
            if (option) {
                return escapeHtml(option.name);
            }
        }

        return escapeHtml(rawValue);
    }

    // ==========================================
    // 結果表與分頁
    // ==========================================

    function isMultiple() {
        return !!(active && active.cfg.multiple);
    }

    // 捲動載入模式：結果不分頁顯示，捲到底自動抓下一頁接在後面（後端照舊分頁回傳）
    function isInfiniteScroll() {
        return !!(active && active.cfg.infiniteScroll);
    }

    function rowValue(row) {
        return getPath(row, active.cfg.valueKey);
    }

    function selectedIndexOf(value) {
        for (var i = 0; i < selectedItems.length; i++) {
            if (String(selectedItems[i].value) === String(value)) {
                return i;
            }
        }
        return -1;
    }

    function toggleSelected(row, checked) {
        if (!row) {
            return;
        }

        var index = selectedIndexOf(rowValue(row));
        if (checked && index < 0) {
            selectedItems.push({
                value: rowValue(row),
                label: active.cfg.display ? renderDisplay(active.cfg.display, row) : String(rowValue(row)),
                row: row,
            });
        } else if (!checked && index >= 0) {
            selectedItems.splice(index, 1);
        }
    }

    // 目前這一頁的 checkbox 勾選狀態要跟已選清單同步（換頁、移除已選項目後都要重算）
    function syncChoiceCheckboxes() {
        $(SEL.results + ' .lookup-choice').each(function () {
            var row = currentRows[parseInt($(this).val(), 10)];
            var index = row ? selectedIndexOf(rowValue(row)) : -1;
            // 預勾項目（row 為 null）在查詢結果中被找到時，補上完整資料列與最新顯示文字
            if (index >= 0 && !selectedItems[index].row) {
                selectedItems[index] = {
                    value: rowValue(row),
                    label: active.cfg.display ? renderDisplay(active.cfg.display, row) : String(rowValue(row)),
                    row: row,
                };
            }
            $(this).prop('checked', index >= 0);
        });
        syncSelectAll();
    }

    function syncSelectAll() {
        var $all = $('#lookup_select_all');
        if (!$all.length) {
            return;
        }

        var $choices = $(SEL.results + ' .lookup-choice');
        $all.prop('checked', $choices.length > 0 && $choices.length === $choices.filter(':checked').length);
    }

    function renderSelected() {
        var $area = $(SEL.selected);
        var selectedConfirmText = isMultiple() && active.cfg.multipleConfirmText
            ? active.cfg.multipleConfirmText
            : (active.cfg.confirmText || '確認');
        $(SEL.confirm).text(selectedConfirmText);

        if (!isMultiple()) {
            $area.addClass('d-none').empty();
            return;
        }

        $area.removeClass('d-none');

        if (!selectedItems.length) {
            $area.html('<span class="text-muted small">尚未選取</span>');
            return;
        }

        var chips = selectedItems.map(function (item, index) {
            return '<span class="badge bg-secondary d-inline-flex align-items-center gap-1 lookup-selected-chip">'
                + escapeHtml(item.label)
                + '<button type="button" class="btn-close btn-close-white lookup-selected-remove" data-index="' + index + '" aria-label="移除"></button>'
                + '</span>';
        }).join('');

        $area.html('<div class="d-flex flex-wrap align-items-center gap-2">'
            + '<span class="fw-semibold small">已選 ' + selectedItems.length + ' 筆</span>'
            + chips
            + '<button type="button" class="btn btn-sm btn-outline-secondary" id="lookup_selected_clear">清除全部</button>'
            + '</div>');
    }

    // 欄位對齊只接受 start／center／end，轉成 Bootstrap 的 text-* class；未設定回傳空字串（維持原樣）
    function alignClass(align) {
        return ['start', 'center', 'end'].indexOf(align) >= 0 ? 'text-' + align : '';
    }

    // extraFieldAlign: true 時，進階條件額外欄依欄位型別對齊（表頭與內容一致）：
    // 數字置右、日期置中、其他（下拉、文字）置左；未開啟回傳空字串，維持原本的表頭置中、內容不加對齊
    function extraFieldAlign(fieldKey) {
        if (!active || !active.cfg.extraFieldAlign) {
            return '';
        }

        var field = currentModeField(fieldKey);
        var type = field ? field.type : '';
        if (type === 'number') {
            return 'end';
        }

        return type === 'date' ? 'center' : 'start';
    }

    // 結果表只留識別欄(no／單號)＋使用者實際搜尋的欄位，其餘呼叫端設定的 columns 不顯示；
    // 只有「簡化模式」才收斂成單欄，沒設定 advanced、或 legacy（allowAddCondition:true，
    // 例如單號欄位）都維持原本完整的 cfg.columns
    function resultColumns() {
        return simplified() ? [active.cfg.columns[0]] : active.cfg.columns;
    }

    function isFixedColumn(key) {
        return resultColumns().some(function (column) { return column.key === key; });
    }

    function columnCount() {
        return 1 + resultColumns().length + currentExtraFieldKeys.length;
    }

    // 表頭＝選取＋固定欄位＋這次搜尋用到的欄位；每次搜尋都重建
    function renderResultsHead() {
        var selectAllLabel = isInfiniteScroll() ? '全選已載入' : '全選本頁';
        var html = '<th class="text-center" style="width:80px;">'
            + (isMultiple() ? '<input type="checkbox" class="form-check-input" id="lookup_select_all" aria-label="' + selectAllLabel + '" title="' + selectAllLabel + '">' : '選取')
            + '</th>'
            + resultColumns().map(function (column) {
                return '<th class="' + (alignClass(column.headAlign) || 'text-center') + '">' + escapeHtml(column.label) + '</th>';
            }).join('')
            + currentExtraFieldKeys.map(function (key) {
                var field = currentModeField(key);
                return '<th class="' + (alignClass(extraFieldAlign(key)) || 'text-center') + '">' + escapeHtml(field ? field.label : key) + '</th>';
            }).join('');

        $(SEL.resultsHead).html(html);
    }

    function renderStatus(message, className) {
        $(SEL.results).html('<tr><td colspan="' + columnCount() + '" class="text-center ' + className + '">' + escapeHtml(message) + '</td></tr>');
    }

    // append=true 時把新頁資料接在已載入的列後面（捲動載入模式）；checkbox 的 value
    // 是 currentRows 的全域索引，重新渲染整個 tbody 索引才不會錯位
    function renderResults(rows, append) {
        currentRows = append ? currentRows.concat(rows) : rows;
        renderResultsHead();

        if (!currentRows.length) {
            renderStatus('查無資料', 'text-muted');
            return;
        }

        var columns = resultColumns();
        var html = currentRows.map(function (row, index) {
            var cells = columns.map(function (column) {
                var cellClass = alignClass(column.align);
                return '<td' + (cellClass ? ' class="' + cellClass + '"' : '') + '>' + escapeHtml(getPath(row, column.key)) + '</td>';
            }).join('');
            var extraCells = currentExtraFieldKeys.map(function (key) {
                var extraClass = alignClass(extraFieldAlign(key));
                return '<td' + (extraClass ? ' class="' + extraClass + '"' : '') + '>' + formatExtraFieldValue(key, getPath(row, key)) + '</td>';
            }).join('');

            var choice = isMultiple()
                ? '<input type="checkbox" class="form-check-input lookup-choice" value="' + index + '">'
                : '<input type="radio" class="form-check-input lookup-choice" name="lookup_choice" value="' + index + '">';

            return '<tr>'
                + '<td class="text-center">' + choice + '</td>'
                + cells
                + extraCells
                + '</tr>';
        }).join('');

        $(SEL.results).html(html);

        if (isMultiple()) {
            syncChoiceCheckboxes();
            renderSelected();
        }
    }

    // 資料量大時只顯示目前頁前後 5 頁與首末頁，避免產生上千顆按鈕
    function renderPager(currentPage, lastPage) {
        var $pager = $(SEL.pager);
        if (!lastPage || lastPage <= 1) {
            $pager.empty();
            return;
        }

        function pageButton(page) {
            return '<button type="button" class="btn btn-sm ' + (page === currentPage ? 'btn-primary' : 'btn-outline-secondary') + ' lookup-page" data-page="' + page + '">' + page + '</button>';
        }

        var ellipsis = '<span class="px-1 align-self-center">…</span>';
        var windowStart = Math.max(1, currentPage - 5);
        var windowEnd = Math.min(lastPage, currentPage + 5);
        var buttons = [];

        if (windowStart > 1) {
            buttons.push(pageButton(1));
            if (windowStart > 2) {
                buttons.push(ellipsis);
            }
        }

        for (var page = windowStart; page <= windowEnd; page++) {
            buttons.push(pageButton(page));
        }

        if (windowEnd < lastPage) {
            if (windowEnd < lastPage - 1) {
                buttons.push(ellipsis);
            }
            buttons.push(pageButton(lastPage));
        }

        $pager.html(buttons.join(''));
    }

    // 捲動載入的底部判斷：用 getBoundingClientRect 而不是 scrollTop/clientHeight/
    // scrollHeight 的算術比較——後者在瀏覽器頁面縮放（Ctrl+-/+，非 100%）時，各瀏覽器
    // 對這幾個屬性的捨入方式不一致，縮放比例越極端（實測 80% 以下會發生）誤差就可能
    // 長期卡在原本的緩衝值之外，使用者怎麼捲都捲不到「視為到底」的門檻。
    // getBoundingClientRect 回傳的是當下實際渲染出來的 CSS px 矩形，兩個元素同一次
    // layout 算出來，縮放不影響兩者的相對關係，比較穩。
    function isScrollBoxNearBottom() {
        var box = document.querySelector('#' + MODAL_ID + ' .table-responsive');
        var sentinel = document.getElementById('lookup_scroll_sentinel');
        if (!box || !sentinel) {
            return false;
        }
        return sentinel.getBoundingClientRect().top <= box.getBoundingClientRect().bottom + 100;
    }

    // 捲動載入的共用判斷：有開 infiniteScroll、彈窗開著、沒有請求在飛、還有下一頁、
    // 且畫面已經（或內容本來就不足一屏、天生）貼近底部，才用上次查詢條件抓下一頁
    // append。每次查詢完成（見 runSearch 的 always）都會重新呼叫一次，藉此處理
    // 「內容不足一屏」的狀況：自動續載直到可捲動或全部載完為止。
    function maybeLoadNextPage() {
        if (!active || !isInfiniteScroll() || lookupXhr || !lastParams) {
            return;
        }
        if (!modalElement().classList.contains('show')) {
            return;
        }
        if (currentPageNum >= lastPageNum) {
            return;
        }
        if (!isScrollBoxNearBottom()) {
            return;
        }
        runSearch($.extend({}, lastParams, { page: currentPageNum + 1 }), true);
    }

    // 實際送出查詢；翻頁與捲動載入都重用這個函式，帶入上次送出的條件＋新頁碼。
    // append=true（捲動載入下一頁）時不清空列表，只在底部掛一列載入提示
    function runSearch(params, append) {
        if (!active) {
            return;
        }

        if (lookupXhr) {
            lookupXhr.abort();
        }

        if (append) {
            $(SEL.results).append('<tr class="lookup-loading-more"><td colspan="' + columnCount() + '" class="text-center text-muted">載入中...</td></tr>');
        } else {
            renderResultsHead();
            renderStatus('搜尋中...', 'text-muted');
        }

        var request = $.ajax({
            url: active.cfg.url,
            type: 'GET',
            dataType: 'json',
            data: params,
        }).done(function (response) {
            currentPageNum = response.current_page || 1;
            lastPageNum = response.last_page || 1;
            renderResults(response.datas || [], append);
            if (isInfiniteScroll()) {
                $(SEL.pager).empty();
            } else {
                renderPager(response.current_page, response.last_page);
            }
        }).fail(function (xhr, status) {
            if (status === 'abort') return;
            if (append) {
                $(SEL.results + ' .lookup-loading-more').remove();
            } else {
                renderStatus('查詢失敗', 'text-danger');
            }
        }).always(function () {
            if (lookupXhr === request) {
                lookupXhr = null;
            }
            // 內容不足一屏時不會觸發 scroll 事件，查詢完成後主動檢查一次，
            // 貼著底部就自動續載下一頁（maybeLoadNextPage 內部已擋非捲動載入模式）
            maybeLoadNextPage();
        });

        lookupXhr = request;
    }

    // 這次條件用到、且還不是固定欄位的欄位，結果表要多長一欄顯示它
    function extraKeysFor(conditions) {
        var seen = {};
        return conditions.map(function (c) { return c.field; }).filter(function (key) {
            if (seen[key]) return false;
            seen[key] = true;
            // 已經是固定欄位的就不重複長一欄（例如固定欄有「產品名稱」，搜尋名稱不用再多一欄）
            return !isFixedColumn(key);
        });
    }

    function search(page) {
        if (!active) {
            return;
        }

        var params = $.extend({}, resolve(active.cfg.params) || {}, { page: page || 1 });

        if (isAdvancedModeActive()) {
            var conditions = buildAdvancedConditions();
            currentExtraFieldKeys = extraKeysFor(conditions);
            params.search_conditions = JSON.stringify(conditions);
        } else if (dynamicGeneral()) {
            var dynamicConditions = buildDynamicConditions();
            currentExtraFieldKeys = extraKeysFor(dynamicConditions);
            params.search_conditions = JSON.stringify(dynamicConditions);
        } else {
            var isSimplified = simplified();
            currentExtraFieldKeys = [];
            $(SEL.generalFields + ' .lookup-general-field').each(function () {
                var value = $(this).val();
                if (value !== '' && value !== null && value !== undefined) {
                    var key = $(this).data('lookupField');
                    params[key] = String(value).trim();
                    // 沒設定 advanced、或 legacy（例如單號欄位）都維持固定 columns，
                    // 不額外長出搜尋欄位的欄（resultColumns() 已經是完整 cfg.columns 了）
                    if (isSimplified && !isFixedColumn(key)) {
                        currentExtraFieldKeys.push(key);
                    }
                }
            });
        }

        lastParams = params;
        runSearch(params);
    }

    // ==========================================
    // 開啟／關閉／選取
    // ==========================================

    function open(instance) {
        active = instance;
        var cfg = instance.cfg;

        $(SEL.title).text(cfg.title || '');
        renderGeneralFields(cfg.generalFields);
        resetAdvancedRows();
        currentRows = [];
        currentExtraFieldKeys = [];
        lastParams = null;
        currentPageNum = 0;
        lastPageNum = 0;
        // 複選欄位模式：把欄位現有的值預先勾起來，確認＝取代整組；
        // 帶進表身模式（attachButton）沒有 initialSelection，確認＝附加
        selectedItems = (cfg.multiple && typeof instance.initialSelection === 'function')
            ? instance.initialSelection()
            : [];
        renderSelected();
        $(SEL.pager).empty();

        // 捲動載入模式：只讓結果表本身捲動，上方搜尋欄位與已選區固定不動
        $('#' + MODAL_ID + ' .table-responsive').toggleClass('lookup-scroll-results', !!cfg.infiniteScroll);

        // allowAddCondition:true（例如單號欄位）＝維持原本一般／進階雙模式＋可新增多條件；
        // 有設定 advanced 的多數呼叫端收斂成只有進階單條件搜尋框，頁籤列也不用顯示；
        // 沒設定 advanced 的呼叫端（單純 generalFields）本來就只有一般頁籤，不受影響
        var legacy = allowAddCondition();
        var isSimplified = simplified();
        $(SEL.advancedAdd).toggleClass('d-none', !legacy);
        $('#lookup_mode_tabs').toggleClass('d-none', isSimplified);
        // 沒設定 advanced 的呼叫端只有一般頁籤，進階頁籤不能露出來（沒有欄位池可用）
        $(SEL.advancedTabItem).toggleClass('d-none', !cfg.advanced);
        // 簡化模式結果表只有識別欄＋搜尋欄位，彈窗縮窄；其他維持原本寬度（樣式見 lookup-modal）
        $('#' + MODAL_ID).toggleClass('lookup-simplified', isSimplified);
        $(SEL.advancedHint).text(cfg.advanced
            ? (resolve(cfg.advanced.hint) || (legacy ? DEFAULT_HINT : SIMPLE_HINT))
            : '');
        var showAdvancedByDefault = cfg.advanced && !legacy;
        var $targetTab = showAdvancedByDefault ? $(SEL.advancedTab) : $(SEL.generalTab);
        // 非 legacy 模式下，每次開窗都固定停在進階頁籤：若上次關閉前就已經是進階頁籤，
        // 這次 tab('show') 對 Bootstrap 來說不是真的切換（目標本來就是 active），
        // 不會觸發 shown.bs.tab，所以不能只靠那個事件處理器來補第一列搜尋條件，
        // 這裡要自己確保至少有一列（resetAdvancedRows() 剛清空過）。
        var isAlreadyActive = $targetTab.hasClass('active');
        $targetTab.tab('show');

        bootstrap.Modal.getOrCreateInstance(modalElement()).show();

        if (cfg.advanced) {
            if (showAdvancedByDefault && isAlreadyActive) {
                ensureFirstAdvancedRow();
            } else {
                loadMetadata(function () {});
            }

            if (dynamicGeneral()) {
                loadMetadata(seedDynamicRows);
            }
        }
        // searchOnOpen: false 時開窗不查詢，等使用者按搜尋；未設定維持開窗即搜尋
        if (cfg.searchOnOpen === false) {
            renderResultsHead();
            renderStatus('請輸入條件後搜尋', 'text-muted');
            return;
        }
        search(1);
    }

    function close() {
        var instance = bootstrap.Modal.getInstance(modalElement());
        if (instance) {
            instance.hide();
        }
    }

    function confirmChoice() {
        if (!active) {
            return;
        }

        if (isMultiple()) {
            active.pickMany(selectedItems);
            close();
            return;
        }

        var $choice = $(SEL.results).find('.lookup-choice:checked');
        if (!$choice.length) {
            return;
        }

        active.pick(currentRows[parseInt($choice.val(), 10)]);
        close();
    }

    // searchOnInput: false 時改條件不自動查詢，只有按搜尋（或文字欄按 Enter）才查
    function searchIfLive() {
        if (active && active.cfg.searchOnInput === false) {
            return;
        }
        search(1);
    }

    function bindEventsOnce() {
        if (eventsBound) {
            return;
        }
        eventsBound = true;

        $(document)
            .on('click.lookup', SEL.generalSearch, function () {
                search(1);
            })
            // searchOnInput: false 時改條件不自動查詢，只有按搜尋（或文字欄按 Enter）才查
            .on('input.lookup', SEL.generalFields + ' input[type="text"].lookup-general-field', function () {
                if (active && active.cfg.searchOnInput === false) {
                    return;
                }
                clearTimeout(lookupTimer);
                lookupTimer = setTimeout(function () { search(1); }, 300);
            })
            .on('change.lookup', SEL.generalFields + ' input[type="date"].lookup-general-field, ' + SEL.generalFields + ' select.lookup-general-field', function () {
                if (active && active.cfg.searchOnInput === false) {
                    return;
                }
                search(1);
            })
            .on('keydown.lookup', SEL.generalFields + ' input[type="text"].lookup-general-field', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    clearTimeout(lookupTimer);
                    search(1);
                }
            })
            // 動態一般頁籤：挑欄位加條件列；條件改變時的查詢節奏比照固定欄位（searchOnInput）
            .on('change.lookup', SEL.generalPicker, function () {
                if ($(this).val()) {
                    addDynamicRow($(this).val());
                    refreshDynamicPicker();
                }
            })
            .on('click.lookup', SEL.generalRows + ' .lookup-dyn-remove', function () {
                $(this).closest('.lookup-dyn-row').remove();
                refreshDynamicPicker();
                searchIfLive();
            })
            .on('input.lookup', SEL.generalRows + ' input[type="text"], ' + SEL.generalRows + ' input[type="number"]', function () {
                if (active && active.cfg.searchOnInput === false) {
                    return;
                }
                clearTimeout(lookupTimer);
                lookupTimer = setTimeout(function () { search(1); }, 300);
            })
            .on('change.lookup', SEL.generalRows + ' input[type="date"], ' + SEL.generalRows + ' select, ' + SEL.generalRows + ' .lookup-dyn-enabled', searchIfLive)
            .on('keydown.lookup', SEL.generalRows + ' input', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    clearTimeout(lookupTimer);
                    search(1);
                }
            })
            .on('click.lookup', SEL.pager + ' .lookup-page', function () {
                var page = parseInt($(this).data('page'), 10) || 1;
                if (lastParams) {
                    runSearch($.extend({}, lastParams, { page: page }));
                } else {
                    search(page);
                }
            })
            .on('change.lookup', SEL.results + ' .lookup-choice', function () {
                if (!isMultiple()) {
                    return;
                }

                toggleSelected(currentRows[parseInt($(this).val(), 10)], $(this).is(':checked'));
                renderSelected();
                syncSelectAll();
            })
            .on('change.lookup', '#lookup_select_all', function () {
                var checked = $(this).is(':checked');
                $(SEL.results + ' .lookup-choice').each(function () {
                    $(this).prop('checked', checked);
                    toggleSelected(currentRows[parseInt($(this).val(), 10)], checked);
                });
                renderSelected();
                syncSelectAll();
            })
            .on('click.lookup', SEL.selected + ' .lookup-selected-remove', function () {
                selectedItems.splice(parseInt($(this).data('index'), 10), 1);
                renderSelected();
                syncChoiceCheckboxes();
            })
            .on('click.lookup', '#lookup_selected_clear', function () {
                selectedItems = [];
                renderSelected();
                syncChoiceCheckboxes();
            })
            // 點整列都能選，不用精準點到那顆 checkbox／radio；
            // 點在控制項本身時不處理，交給瀏覽器原本的行為，避免切換兩次
            .on('click.lookup', SEL.results + ' tr', function (event) {
                if ($(event.target).is('input, label, a, button')) {
                    return;
                }

                var $choice = $(this).find('.lookup-choice');
                if (!$choice.length) {
                    return;
                }

                if (isMultiple()) {
                    $choice.prop('checked', !$choice.prop('checked')).trigger('change');
                    return;
                }

                $choice.prop('checked', true);
            })
            // 單選雙擊＝選取並關閉；複選已經靠單擊切換，不需要雙擊
            .on('dblclick.lookup', SEL.results + ' tr', function () {
                if (isMultiple()) {
                    return;
                }

                var $choice = $(this).find('.lookup-choice');
                if (!$choice.length) {
                    return;
                }

                $choice.prop('checked', true);
                confirmChoice();
            })
            .on('click.lookup', SEL.confirm, confirmChoice)
            .on('shown.bs.tab.lookup', SEL.advancedTab, function () {
                ensureFirstAdvancedRow();
            })
            .on('click.lookup', SEL.advancedAdd, function () {
                loadMetadata(function (metadata) {
                    addAdvancedRow(metadata.fields);
                });
            })
            .on('click.lookup', SEL.advancedSearch, function () {
                search(1);
            })
            .on('click.lookup', SEL.advancedRows + ' .lookup-advanced-remove', function () {
                $(this).closest('.lookup-advanced-row').remove();
                renumberAdvancedRows();
            })
            .on('change.lookup', SEL.advancedRows + ' .lookup-advanced-field', function () {
                refreshRowOperators($(this).closest('.lookup-advanced-row'));
            })
            .on('change.lookup', SEL.advancedRows + ' .lookup-advanced-operator', function () {
                refreshRowValueInput($(this).closest('.lookup-advanced-row'));
            })
            .on('click.lookup', SEL.advancedRows + ' .lookup-advanced-boolean-btn', function () {
                var $group = $(this).closest('.lookup-advanced-boolean-group');
                $group.find('.lookup-advanced-boolean-btn').removeClass('active btn-secondary').addClass('btn-outline-secondary');
                $(this).removeClass('btn-outline-secondary').addClass('active btn-secondary');
            });

        // 捲動載入：scroll 綁在實際捲動的 .table-responsive 上；哨兵元素（用來跟
        // 捲動容器底部比對位置，見 isScrollBoxNearBottom）只需要插入 DOM 一次。
        // 底部判斷邏輯本身在 maybeLoadNextPage / isScrollBoxNearBottom（模組層級函式），
        // 這裡只負責觸發時機。
        var $scrollBox = $('#' + MODAL_ID + ' .table-responsive');
        $scrollBox.append('<div id="lookup_scroll_sentinel" style="height:1px;"></div>');

        $scrollBox.on('scroll.lookup', function () {
            maybeLoadNextPage();
        });
    }

    // ==========================================
    // 對外 API
    // ==========================================

    /**
     * 欄位本身（隱藏的目標＋顯示框）的樣式
     *
     * 放在這裡注入而不是 lookup-modal 元件：檢視頁不載入彈窗元件，樣式跟著不見的話，
     * 原本的 select 會跟顯示框同時出現成兩個框。
     */
    function injectFieldStyle() {
        if (document.getElementById('lookup-field-style')) {
            return;
        }
        // 目標欄位用視覺隱藏而不是 display:none：<select required> 被 display:none 會讓瀏覽器
        // 送出時報 "An invalid form control is not focusable"，視覺隱藏才能繼續參與原生必填驗證
        var css = '.lookup-target-hidden{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}'
            // 隱藏的目標排在 input-group 第一個，主題會把顯示框左側變直角，這裡補回圓角
            + '.lookup-input-group>.lookup-display{margin-left:0!important;border-top-left-radius:var(--bs-border-radius)!important;border-bottom-left-radius:var(--bs-border-radius)!important}'
            // 顯示框本身也能點開彈窗；停用狀態沒有綁 click，維持瀏覽器預設的停用游標
            + '.lookup-input-group>.lookup-display:not(:disabled){cursor:pointer}'
            // 清除鈕故意做得比「選擇」低調：邊框跟表單欄位同色、無底色填滿，
            // 視覺上像顯示框的延伸，不要跟真正的主要動作「選擇」搶重量
            + '.lookup-input-group>.lookup-clear-btn{padding:0 .5rem;color:#6c757d;background-color:#fff;border-color:var(--bs-border-color,#ced4da);font-size:1.1rem;line-height:1}'
            + '.lookup-input-group>.lookup-clear-btn:hover{color:#495057;background-color:#f8f9fa}';
        $('<style>', { id: 'lookup-field-style', text: css }).appendTo('head');
    }

    // select 的 val() 設值時，若目標是單選 Lookup 且沒有對應的 option，先交給 setByValue 補上
    var originalSelectValHook = $.valHooks.select;
    $.valHooks.select = $.extend({}, originalSelectValHook, {
        set: function (elem, value) {
            var setByValue = $.data(elem, 'lookupSetByValue');
            if (setByValue && value !== null && value !== undefined && value !== '' && !Array.isArray(value)) {
                var exists = $(elem).find('option').filter(function () {
                    return this.value === String(value);
                }).length;
                if (!exists) {
                    setByValue(String(value));
                }
            }
            return originalSelectValHook.set(elem, value);
        },
    });

    function attach(target, config) {
        var $target = $(target).first();
        if (!$target.length) {
            return null;
        }

        injectFieldStyle();

        bindEventsOnce();
        instanceCount++;
        var ns = '.lookupInstance' + instanceCount;
        var cfg = $.extend({ valueKey: 'id', columns: [] }, config);
        var disabled = $target.prop('disabled');

        if (cfg.multiple && !$target.is('select')) {
            console.error('[Lookup] multiple 模式的目標必須是 <select multiple>');
        }

        if ($target.hasClass('select2-hidden-accessible')) {
            $target.select2('destroy');
        }

        // 頁面若在 document ready 才對全部 <select> 套 select2，attach 可能更早執行，ready 後再拆一次
        $(function () {
            if ($target.hasClass('select2-hidden-accessible')) {
                $target.select2('destroy');
            }
        });

        var originalTabindex = $target.attr('tabindex');

        var $display = $('<input type="text" class="form-control lookup-display" readonly>')
            .attr('placeholder', $target.data('placeholder') || '')
            .prop('disabled', disabled);
        if ($target.attr('id')) {
            $display.attr('id', $target.attr('id') + '_display');
        }

        var $clearBtn; // 只有非停用欄位才會建立，見下方 if (!disabled) 區塊

        var $group = $('<div class="input-group lookup-input-group"></div>').append($display);
        $target.after($group);
        // 目標搬進 input-group（本身是 position:relative），視覺隱藏後瀏覽器的必填提示才會出現在欄位附近；
        // 同時移出 tab 順序，避免鍵盤 tab 停在看不到的欄位上
        $group.prepend($target.addClass('lookup-target-hidden').attr('tabindex', '-1'));

        // 複選欄位的已選項目＝目標 <select multiple> 目前選取的 option，文字直接沿用不用打 API
        function initialSelection() {
            return $target.find('option:selected').filter(function () {
                return $(this).val() !== '';
            }).map(function () {
                return { value: $(this).val(), label: $(this).text(), row: null };
            }).get();
        }

        function refreshDisplay() {
            if (cfg.multiple) {
                var count = initialSelection().length;
                $display.val(count ? '已選 ' + count + ' 筆' : '');
                return;
            }

            var $selected = $target.find('option:selected');
            $display.val($selected.length && $selected.val() ? $selected.text() : '');
        }

        if ($target.is('select')) {
            refreshDisplay();
        }

        // 清除鈕只在「目前有值」時顯示；停用欄位沒有清除鈕，$clearBtn 會是 undefined
        function refreshClear() {
            if (!$clearBtn) {
                return;
            }
            var hasValue = cfg.multiple ? initialSelection().length > 0 : !!$target.val();
            $clearBtn.toggle(hasValue);
        }

        // 有些頁面會繞過 pick()，直接重建 option、設值、trigger('change')
        // （例如由其他欄位帶入值）。訂閱 $target 的 change 事件，不管是誰改的值，
        // 清除鈕都能跟著同步，不用每個呼叫端自己記得補一次 refreshClear()。
        $target.on('change', refreshClear);

        function pick(row) {
            var value = getPath(row, cfg.valueKey);
            var text = renderDisplay(cfg.display, row);

            if ($target.is('select')) {
                // 不用 new Option(text, value, true, true)：那個寫法只設 option 的
                // selectedness，不會設 dirtiness flag，所以頁面上若有「移除所有 option 的
                // selected 屬性再重讀值」的全域 change 處理器（全域套用 select2 的頁面常見），
                // HTML 的 reset 演算法會把 selectedness 重算掉。單選剛好有「沒有任何
                // option 被選中時選第一個」的 fallback，在 empty() 之後只剩一個 option 的
                // 情況下看起來沒事——但那是巧合，不是設計。改用 val() 設值會設 dirtiness，
                // 不依賴 option 數量。（複選見 pickMany()）
                $target.empty().append(new Option(text, value, false, false));
                $target.val(value);
            } else {
                $target.val(value);
            }
            $display.val(text);
            refreshClear();
            $target.trigger('change');

            if (typeof cfg.onPick === 'function') {
                cfg.onPick(row);
            }
        }

        // 複選欄位：確認＝取代整組。重建 option 後觸發一次 change，頁面既有的聯動照舊
        function pickMany(items) {
            if ($target.is('select')) {
                $target.empty();
                items.forEach(function (item) {
                    // 同 pick() 的理由，但複選沒有「選第一個」的 fallback，用
                    // new Option(..., true, true) 的話被重算後會是「全部沒選」。
                    // option.selected = true 走的是 IDL setter，會設 dirtiness。
                    var option = new Option(item.label, item.value, false, false);
                    $target.append(option);
                    option.selected = true;
                });
            }

            $display.val(items.length ? '已選 ' + items.length + ' 筆' : '');
            refreshClear();
            $target.trigger('change');

            if (typeof cfg.onPick === 'function') {
                cfg.onPick(items.map(function (item) { return item.row; }));
            }
        }

        // 清空不觸發 change：頁面自己在切換類別時通常已經在清下游欄位
        function clear() {
            if ($target.is('select')) {
                $target.empty();
                if (!cfg.multiple) {
                    $target.append('<option value=""></option>');
                }
            } else {
                $target.val('');
            }
            $display.val('');
            refreshClear();
        }

        function destroy() {
            $(document).off(ns);
            $target.off(ns).removeData('lookupSetByValue');
            if (originalTabindex === undefined) {
                $target.removeAttr('tabindex');
            } else {
                $target.attr('tabindex', originalTabindex);
            }
            $group.before($target.removeClass('lookup-target-hidden'));
            $group.remove();
        }

        var instance = { cfg: cfg, pick: pick, pickMany: pickMany, initialSelection: initialSelection };

        // 頁面用程式塞值（$select.val(id).trigger('change')，例如選了上層品項後帶出下游欄位）：
        // 目標只有目前選到的那個 option，val() 對不到會變成沒選。由 valHooks 呼叫這裡先補
        // option，再用 lookup_id 回查顯示文字（valueKey 不是 id 時查不到，就只顯示值）
        function setByValue(value) {
            var option = new Option(value, value, false, false);
            $target.empty().append(option);
            if (cfg.valueKey !== 'id') {
                return;
            }
            $.getJSON(resolve(cfg.url), $.extend({}, resolve(cfg.params) || {}, { lookup_id: value }))
                .done(function (response) {
                    var row = (response.datas || [])[0];
                    if (!row || String($target.val()) !== String(value)) {
                        return;
                    }
                    option.text = renderDisplay(cfg.display, row);
                    refreshDisplay();
                });
        }

        if ($target.is('select') && !cfg.multiple) {
            $target.data('lookupSetByValue', setByValue);
            $target.on('change' + ns, refreshDisplay);
        }

        if (!disabled) {
            // 顯示框本身也能點開彈窗，不用精準點在按鈕上——跟結果列「點整列即可選取」
            // 是同一個「擴大可點擊範圍」的考量。顯示框仍是 readonly，只是多一個入口。
            // 游標樣式見 lookup-modal.blade.php 的 .lookup-input-group > .lookup-display 規則。
            $display.on('click', function () { open(instance); });

            // 清除鈕跟 clear()：後者刻意不觸發 change（給 clearOn 的聯動用），這裡是使用者
            // 主動點擊的新動作，要觸發 change 讓頁面上依賴這個欄位的下游邏輯照樣反應
            $clearBtn = $('<button type="button" class="btn lookup-clear-btn" tabindex="-1" title="清除">&times;</button>')
                .on('click', function () {
                    clear();
                    $target.trigger('change');
                })
                .appendTo($group);
            refreshClear();

            $('<button type="button" class="btn btn-outline-secondary">選擇</button>')
                .on('click', function () { open(instance); })
                .appendTo($group);
        }

        if (cfg.clearOn) {
            $(document).on('change' + ns, cfg.clearOn, clear);
        }

        return {
            open: function () { open(instance); },
            clear: clear,
            destroy: destroy,
        };
    }

    /**
     * 掛在按鈕上：沒有目標欄位，也不產生顯示框，確認後只呼叫 onPick。
     * 用在「批次帶入表身」這種沒有欄位可以掛的情境；不給 multiple 時 onPick 收到單一資料列。
     */
    function attachButton(selector, config) {
        bindEventsOnce();
        instanceCount++;
        var ns = '.lookupInstance' + instanceCount;
        var cfg = $.extend({ valueKey: 'id', columns: [] }, config);

        function pick(row) {
            if (typeof cfg.onPick === 'function') {
                cfg.onPick(row);
            }
        }

        function pickMany(items) {
            if (!items.length || typeof cfg.onPick !== 'function') {
                return;
            }

            cfg.onPick(items.map(function (item) { return item.row; }));
        }

        var instance = { cfg: cfg, pick: pick, pickMany: pickMany };

        $(document).on('click' + ns, selector, function (event) {
            event.preventDefault();
            open(instance);
        });

        return {
            open: function () { open(instance); },
            destroy: function () { $(document).off(ns); },
        };
    }

    function definePreset(name, factory) {
        presets[name] = factory;
    }

    function preset(name, options) {
        return presets[name](options || {});
    }

    return {
        attach: attach,
        attachButton: attachButton,
        definePreset: definePreset,
        preset: preset,
    };
})(jQuery);
