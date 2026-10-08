/**
 * 單據表身產品批次選取。
 *
 * 只負責把萬用 Lookup 選到的產品，逐筆交給頁面既有的「新增表身」流程，
 * 再將產品寫入新列。這樣各單據原本的預設值與 change 聯動都能繼續沿用。
 */
window.ProductBatchLookup = (function ($) {
    'use strict';

    var instanceCount = 0;

    function productText(row) {
        var serial = row && row.product_serial ? String(row.product_serial) : '';
        var name = row && row.name ? String(row.name) : '';

        return [serial, name].filter(Boolean).join(' - ');
    }

    function firstUsableButton(selector) {
        var $visible = $(selector).filter(':visible').first();

        return $visible.length ? $visible : $(selector).first();
    }

    function attach(options) {
        var cfg = $.extend({
            button: '.batch-add-products',
            addButton: '.add-template[data-target="product"]',
            area: '#product_area',
            row: '.product_item',
            productSelect: 'select[name$="[products_id]"]',
            // 模板列選擇器（選用）。模板的產品選單若內嵌全部產品選項，批次新增時
            // 每列都會複製一份，數百列會讓 DOM 與 layout 成本呈平方成長而卡死。
            // 有設定時，批次新增期間暫時拿掉模板的選項，新列只保留被選的產品，
            // 使用者要換產品時才在展開下拉當下補回完整選項。
            template: null,
            // 表身分成多個區塊（例如一張單據內的分區）時，新列要加到哪個區塊由頁面決定：
            // areaResolver 回傳「目前要加入的表身容器」，addButtonResolver 回傳該區塊的「新增」按鈕。
            // 沒設定就維持原行為（固定用 area / addButton）。
            areaResolver: null,
            addButtonResolver: null,
            // 每段新增的筆數，超過才會分段並顯示載入中
            chunkSize: 20,
            // 進階搜尋（一般／進階雙頁籤，可自選欄位、運算子與 AND／OR 條件）。
            // 預設接 product.product 欄位池；傳 false 可關閉，傳物件可覆寫 lookup.js 的 advanced 設定
            advanced: null,
            // 搜尋欄位、結果欄位與顯示文字由頁面決定（預設對應本專案的產品欄位）
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
            infiniteScroll: true,
            beforeOpen: null,
            afterInsert: null,
            afterBatch: null,
        }, options || {});

        if (!window.Lookup || typeof window.Lookup.attachButton !== 'function') {
            console.error('[ProductBatchLookup] Lookup.attachButton 尚未載入');
            return null;
        }

        if (!cfg.url) {
            console.error('[ProductBatchLookup] 缺少產品 Lookup URL');
            return null;
        }

        instanceCount += 1;
        var namespace = '.productBatchLookup' + instanceCount;

        // 頁面的 <x-backend.lookup-modal> 有傳 metadata-url 才能載入欄位池；沒傳就維持只有一般搜尋，
        // 不會出現壞掉的進階頁籤
        function advancedConfig() {
            var modal = document.getElementById('lookupModal');
            if (cfg.advanced === false || !modal || !modal.getAttribute('data-metadata-url')) {
                return undefined;
            }

            // dynamicGeneral：一般頁籤也是挑欄位加條件列（n 個條件 AND），不是固定的編號／名稱／規格
            return $.extend({ link: 'product.product', allowAddCondition: true, dynamicGeneral: true }, cfg.advanced);
        }

        function templateSelect() {
            return cfg.template ? $(cfg.template).find(cfg.productSelect).first() : $();
        }

        // 暫時移除模板產品選單的選項（保留空白選項），回傳被移除的節點供事後接回
        function detachTemplateOptions() {
            return templateSelect().find('option').filter(function () {
                return this.value !== '';
            }).detach();
        }

        // 使用不存在的內部 selector 建立 Lookup instance，實際按鈕由下方自行攔截，
        // 才能在開啟彈窗前先執行各單據自己的表頭檢查。
        var lookup = window.Lookup.attachButton(
            '#__product_batch_lookup_internal_' + instanceCount,
            {
                multiple: true,
                infiniteScroll: cfg.infiniteScroll,
                title: cfg.title || '選擇產品',
                multipleConfirmText: cfg.multipleConfirmText || '取回',
                url: cfg.url,
                params: cfg.params,
                advanced: advancedConfig(),
                generalFields: cfg.generalFields,
                columns: cfg.columns,
                display: cfg.display,
                onPick: runBatch,
            }
        );

        // 載入中遮罩：蓋住整頁避免分段期間被操作，並顯示已處理筆數
        function showLoading(total) {
            var $overlay = $(
                '<div class="product-batch-loading" style="position:fixed;inset:0;z-index:2000;'
                + 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);">'
                + '<div style="background:#fff;border-radius:.5rem;padding:1.5rem 2rem;min-width:280px;text-align:center;">'
                + '<div class="spinner-border text-primary mb-3" role="status"></div>'
                + '<div class="fw-bold">表身載入中，請稍候…</div>'
                + '<div class="product-batch-loading-text mt-1"></div>'
                + '<div class="progress mt-3" style="height:8px;">'
                + '<div class="progress-bar" style="width:0%;"></div></div>'
                + '</div></div>'
            ).appendTo(document.body);

            return {
                update: function (done) {
                    $overlay.find('.product-batch-loading-text').text('已載入 ' + done + ' / ' + total + ' 筆');
                    $overlay.find('.progress-bar').css('width', Math.round(done / total * 100) + '%');
                },
                close: function () {
                    $overlay.remove();
                },
            };
        }

        // 分段新增表身：筆數少時一次做完（與原本相同）；筆數多時每段 chunkSize 筆，
        // 段與段之間先讓瀏覽器重繪再繼續，避免一次佔住主執行緒造成網頁無回應。
        function runBatch(rows) {
            var total = rows.length;
            var chunkSize = Math.max(1, parseInt(cfg.chunkSize, 10) || 20);
            var $detachedOptions = detachTemplateOptions();
            var loading = total > chunkSize ? showLoading(total) : null;
            var index = 0;

            function finish() {
                // 無論中途是否出錯，都要把完整選項接回模板，手動「新增」才不會拿到空選單
                templateSelect().append($detachedOptions);
                if (loading) {
                    loading.close();
                }
            }

            function step() {
                try {
                    insertRows(rows.slice(index, index + chunkSize));
                    index += chunkSize;
                } catch (error) {
                    finish();
                    throw error;
                }

                if (index < total) {
                    loading.update(index);
                    requestAnimationFrame(function () {
                        setTimeout(step, 0);
                    });
                    return;
                }

                finish();
                if (typeof cfg.afterBatch === 'function') {
                    cfg.afterBatch(rows);
                }
            }

            if (!loading) {
                step();
                return;
            }

            loading.update(0);
            requestAnimationFrame(function () {
                setTimeout(step, 0);
            });
        }

        function insertRows(rows) {
            var slimmed = templateSelect().length > 0;

            rows.forEach(function (row) {
                if (!row || row.id === undefined || row.id === null) {
                    return;
                }

                var $area = cfg.areaResolver ? cfg.areaResolver() : $(cfg.area);
                var beforeCount = $area.find(cfg.row).length;
                var $addButton = cfg.addButtonResolver ? cfg.addButtonResolver() : firstUsableButton(cfg.addButton);
                if (!$addButton || !$addButton.length) {
                    return;
                }

                $addButton.trigger('click');

                var $rows = $area.find(cfg.row);
                if ($rows.length <= beforeCount) {
                    return;
                }

                var $newRow = $rows.last();
                var $select = $newRow.find(cfg.productSelect).first();
                if (!$select.length) {
                    return;
                }

                var id = String(row.id);
                var hasOption = $select.find('option').filter(function () {
                    return String(this.value) === id;
                }).length > 0;

                if (!hasOption) {
                    $select.append(new Option(productText(row), id, false, false));
                }

                if (slimmed) {
                    $select.data('slimOptions', true);
                }

                $select.val(id).trigger('change');

                if (typeof cfg.afterInsert === 'function') {
                    cfg.afterInsert(row, $newRow, $select);
                }
            });
        }

        // 被精簡過選項的列，使用者展開下拉要換產品時，才把模板的完整選項補回該列
        $(document).on('select2:opening' + namespace, cfg.area + ' ' + cfg.productSelect, function () {
            var $select = $(this);
            var $templateSelect = templateSelect();
            if (!$select.data('slimOptions') || !$templateSelect.length) {
                return;
            }

            var $current = $select.find('option:selected').clone();
            $select.html($templateSelect.html());

            // 被選的產品若不在完整選項內（例如已停用的產品），要補回去才不會被清掉
            var currentValue = $current.val();
            var stillThere = $select.find('option').filter(function () {
                return this.value === currentValue;
            }).length > 0;
            if (!stillThere) {
                $select.append($current);
            }

            $select.val(currentValue).removeData('slimOptions');
        });

        $(document).on('click' + namespace, cfg.button, function (event) {
            event.preventDefault();

            if (typeof cfg.beforeOpen === 'function' && cfg.beforeOpen() === false) {
                return;
            }

            lookup.open();
        });

        return {
            open: lookup.open,
            destroy: function () {
                $(document).off(namespace);
                lookup.destroy();
            },
        };
    }

    return {
        attach: attach,
    };
})(jQuery);
