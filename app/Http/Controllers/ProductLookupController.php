<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Traits\LookupResponseTrait;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * 產品快速輸入（ProductLookup）用到的四支 API：精確查詢、彈窗分頁查詢、欄位 metadata、
 * 遠端選項。所有可搜尋欄位與運算子都是寫死的白名單，請求參數無法指定其他欄位。
 */
class ProductLookupController extends Controller
{
    use LookupResponseTrait;

    /**
     * 可搜尋欄位白名單：欄位名稱 => 型別與允許的運算子。
     * 欄位名稱同時就是 products 資料表的欄位，所以白名單內的 key 可以直接當作 SQL 欄位使用。
     */
    private const SEARCH_FIELDS = [
        'product_serial' => ['label' => '產品編號', 'type' => 'text', 'operators' => ['contains', 'eq', 'neq']],
        'name' => ['label' => '產品名稱', 'type' => 'text', 'operators' => ['contains', 'eq', 'neq']],
        'price' => ['label' => '單價', 'type' => 'number', 'operators' => ['eq', 'neq', 'gte', 'lte']],
    ];

    // 運算子的顯示名稱（給前端下拉選單用）
    private const OPERATOR_LABELS = [
        'contains' => '包含',
        'eq' => '等於',
        'neq' => '不等於',
        'gte' => '大於等於',
        'lte' => '小於等於',
    ];

    // 比較類運算子對應的 SQL 運算子；contains 另外用 LIKE 處理
    private const SQL_OPERATORS = [
        'eq' => '=',
        'neq' => '!=',
        'gte' => '>=',
        'lte' => '<=',
    ];

    // 允許用「遠端下拉」搜尋選項的欄位（值太多，不能一次全部塞進前端）
    private const REMOTE_FIELDS = ['name'];

    // 進階條件最多幾筆（前端目前只送一筆，這裡避免被塞入超長陣列）
    private const MAX_CONDITIONS = 5;

    /**
     * 精確查詢：依產品編號或 id 取單筆。查無或停用時回 result: null，前端會改開彈窗。
     */
    public function info(Request $request): JsonResponse
    {
        $data = $request->validate([
            'product_serial' => ['nullable', 'string', 'max:100', 'required_without:id'],
            'id' => ['nullable', 'integer', 'required_without:product_serial'],
        ]);

        $query = Product::query()->where('status', true);

        if (isset($data['product_serial'])) {
            $query->where('product_serial', $data['product_serial']);
        } else {
            $query->whereKey($data['id']);
        }

        $product = $query->first();

        return response()->json([
            'result' => $product?->only(['id', 'product_serial', 'name', 'price']),
        ]);
    }

    /**
     * 彈窗的分頁查詢。search_conditions 是 JSON 陣列，每筆 {boolean, field, operator, value}。
     */
    public function lookup(Request $request): JsonResponse
    {
        $request->validate([
            'search_conditions' => ['nullable', 'string', 'max:4000'],
        ]);

        $conditions = $this->parseConditions((string) $request->input('search_conditions', '[]'));

        $query = Product::query()
            ->where('status', true)
            ->orderBy('product_serial');

        foreach ($conditions as $condition) {
            $this->applyCondition($query, $condition);
        }

        // 一般頁籤（Lookup 核心）送出的 product_serial、name 也是白名單欄位
        return $this->lookupResponse($query, $request, [
            'product_serial' => 'like:product_serial',
            'name' => 'like:name',
        ]);
    }

    /**
     * 欄位 metadata：前端用來產生「欄位／運算子」下拉選單。
     */
    public function metadata(): JsonResponse
    {
        $fields = [];
        foreach (self::SEARCH_FIELDS as $key => $definition) {
            $fields[] = [
                'key' => $key,
                'label' => $definition['label'],
                'type' => $definition['type'],
                'operators' => $definition['operators'],
                'options' => [],
            ];
        }

        return response()->json([
            'fields' => $fields,
            'operators' => self::OPERATOR_LABELS,
        ]);
    }

    /**
     * 遠端下拉選項（Select2 ajax）：依關鍵字回傳不重複的值，每頁 20 筆。
     */
    public function fieldOptions(Request $request): JsonResponse
    {
        $data = $request->validate([
            'field' => ['required', 'string', Rule::in(self::REMOTE_FIELDS)],
            'term' => ['nullable', 'string', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        // 欄位已經過白名單，可以直接當作欄位名稱
        $field = $data['field'];

        $query = Product::query()
            ->where('status', true)
            ->select($field)
            ->distinct()
            ->orderBy($field);

        if (! empty($data['term'])) {
            $query->where($field, 'like', '%'.addcslashes($data['term'], '%_\\').'%');
        }

        $paginator = $query->paginate(20, ['*'], 'page', (int) ($data['page'] ?? 1));

        return response()->json([
            'results' => collect($paginator->items())
                ->map(fn (Product $product) => ['id' => $product->{$field}, 'text' => $product->{$field}])
                ->values(),
            'pagination' => ['more' => $paginator->hasMorePages()],
        ]);
    }

    /**
     * 解析並驗證 search_conditions。任何不在白名單內的欄位、運算子或值都會丟出 422。
     *
     * @return array<int, array{field: string, operator: string, value: string}>
     */
    private function parseConditions(string $json): array
    {
        $decoded = json_decode($json, true);

        if (! is_array($decoded) || count($decoded) > self::MAX_CONDITIONS) {
            throw ValidationException::withMessages(['search_conditions' => '搜尋條件格式不正確']);
        }

        $conditions = [];
        foreach ($decoded as $item) {
            $field = is_array($item) ? ($item['field'] ?? null) : null;
            $operator = is_array($item) ? ($item['operator'] ?? null) : null;
            $value = is_array($item) ? ($item['value'] ?? null) : null;

            $definition = is_string($field) ? (self::SEARCH_FIELDS[$field] ?? null) : null;
            if ($definition === null) {
                throw ValidationException::withMessages(['search_conditions' => '不允許搜尋的欄位']);
            }

            if (! in_array($operator, $definition['operators'], true)) {
                throw ValidationException::withMessages(['search_conditions' => '不允許的運算子']);
            }

            if (! is_scalar($value) || (string) $value === '') {
                throw ValidationException::withMessages(['search_conditions' => '請輸入搜尋值']);
            }

            if ($definition['type'] === 'number' && ! is_numeric($value)) {
                throw ValidationException::withMessages(['search_conditions' => '數值欄位只能輸入數字']);
            }

            if ($definition['type'] === 'text' && mb_strlen((string) $value) > 100) {
                throw ValidationException::withMessages(['search_conditions' => '搜尋值過長']);
            }

            $conditions[] = ['field' => $field, 'operator' => $operator, 'value' => (string) $value];
        }

        return $conditions;
    }

    /**
     * 把一筆已驗證的條件套到查詢上（多筆之間是 AND）。
     *
     * @param  array{field: string, operator: string, value: string}  $condition
     */
    private function applyCondition(Builder $query, array $condition): void
    {
        // 欄位已經過白名單，可以直接當作 SQL 欄位使用
        $column = $condition['field'];

        if ($condition['operator'] === 'contains') {
            $query->where($column, 'like', '%'.addcslashes($condition['value'], '%_\\').'%');

            return;
        }

        $query->where($column, self::SQL_OPERATORS[$condition['operator']], $condition['value']);
    }
}
