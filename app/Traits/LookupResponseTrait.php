<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * 萬用 Lookup 的後端共用回應（規格見 docs/lookup-contract.md）。
 *
 * 這是「核心版」：只做一般篩選與分頁，不含進階搜尋引擎。
 * 基底範圍、eager load、排序由呼叫端套好再傳進來，這裡只疊加一般篩選，
 * 所以不會蓋掉呼叫端的範圍限制。
 */
trait LookupResponseTrait
{
    /**
     * $filters 必須是程式碼中的常數，不可由請求參數組出（關聯名稱會被拿去呼叫 model 方法）。
     *
     * @param  array<string, string>  $filters  查詢參數名 => "運算:欄位[,欄位...]"，
     *                                          運算為 like／eq／date_gte／date_lte，欄位可用點記法指關聯
     */
    protected function lookupResponse(Builder $query, Request $request, array $filters = []): JsonResponse
    {
        // 頁面用程式塞值（$select.val(id)）時，lookup.js 帶 lookup_id 回查該筆的顯示文字
        $lookupId = $request->input('lookup_id');
        if (is_scalar($lookupId) && (string) $lookupId !== '') {
            $query->whereKey($lookupId);
        }

        foreach ($filters as $param => $rule) {
            $value = $request->input($param);
            // null、空字串、陣列一律略過；陣列會在 (string) 轉型時丟「Array to string conversion」
            if (! is_scalar($value) || (string) $value === '') {
                continue;
            }

            [$operator, $columns] = explode(':', $rule, 2);

            // 逗號分隔的多個欄位包成一組 OR，再跟其他條件 AND
            $query->where(function (Builder $group) use ($operator, $columns, $value) {
                foreach (explode(',', $columns) as $column) {
                    $this->lookupOrWhere($group, trim($column), $operator, $value);
                }
            });
        }

        // 頁碼要從傳入的 $request 讀，避免分頁永遠停在第 1 頁
        $paginator = $query->paginate(10, ['*'], 'page', max(1, (int) $request->input('page')));

        return response()->json([
            'datas' => $paginator->items(),
            'current_page' => $paginator->currentPage(),
            'last_page' => $paginator->lastPage(),
            'total' => $paginator->total(),
        ]);
    }

    private function lookupOrWhere(Builder $query, string $column, string $operator, mixed $value): void
    {
        if (str_contains($column, '.')) {
            $field = Str::afterLast($column, '.');

            // callback 內一定要用 where（AND），不能用 orWhere：whereHas 會先自動加上關聯鍵比對，
            // 若 callback 裡再 orWhere，整個 EXISTS 幾乎必定為真。多欄位的 OR 交給外層各自 orWhereHas。
            $query->orWhereHas(Str::beforeLast($column, '.'), function (Builder $related) use ($field, $operator, $value) {
                $this->lookupWhere($related, $field, $operator, $value);
            });

            return;
        }

        $this->lookupWhere($query, $column, $operator, $value, or: true);
    }

    private function lookupWhere(Builder $query, string $column, string $operator, mixed $value, bool $or = false): void
    {
        $whereMethod = $or ? 'orWhere' : 'where';
        $whereDateMethod = $or ? 'orWhereDate' : 'whereDate';

        match ($operator) {
            'like' => $query->{$whereMethod}($column, 'like', '%'.addcslashes((string) $value, '%_\\').'%'),
            'eq' => $query->{$whereMethod}($column, $value),
            'date_gte' => $query->{$whereDateMethod}($column, '>=', $value),
            'date_lte' => $query->{$whereDateMethod}($column, '<=', $value),
        };
    }
}
