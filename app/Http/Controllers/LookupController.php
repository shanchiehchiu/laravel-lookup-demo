<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use App\Traits\LookupResponseTrait;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LookupController extends Controller
{
    use LookupResponseTrait;

    /**
     * 客戶彈窗的查詢 API（給 lookup.js 呼叫）。
     *
     * 基底範圍：只查「啟用中」的客戶，停用客戶不會出現在彈窗。
     * 可搜尋欄位是寫死的白名單（no、name），請求參數無法指定其他欄位。
     */
    public function customers(Request $request): JsonResponse
    {
        $query = Customer::query()
            ->where('status', true)
            ->orderBy('no');

        return $this->lookupResponse($query, $request, [
            'no' => 'like:no',
            'name' => 'like:name',
        ]);
    }
}
