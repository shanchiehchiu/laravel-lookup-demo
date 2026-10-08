<?php

namespace App\Http\Controllers;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\View\View;

class OrderController extends Controller
{
    /**
     * 訂單列表。
     */
    public function index(): View
    {
        $orders = Order::with(['customer', 'items'])->latest()->get();

        return view('orders.index', compact('orders'));
    }

    /**
     * 新增訂單表單。
     */
    public function create(): View
    {
        return view('orders.create');
    }

    /**
     * 儲存訂單與明細。
     *
     * customer_id、product_id 都必須是存在且啟用中的資料；單價一律以資料庫的值為準，
     * 不採用前端送來的價格，避免被竄改。
     */
    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'customer_id' => [
                'required',
                Rule::exists('customers', 'id')->where('status', true),
            ],
            'note' => ['nullable', 'string', 'max:255'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => [
                'required',
                Rule::exists('products', 'id')->where('status', true),
            ],
            'items.*.qty' => ['required', 'integer', 'min:1', 'max:9999'],
        ], [
            'customer_id.required' => '請選擇客戶',
            'customer_id.exists' => '客戶不存在或已停用',
            'items.required' => '請至少新增一筆產品',
            'items.*.product_id.required' => '請選擇產品',
            'items.*.product_id.exists' => '產品不存在或已停用',
            'items.*.qty.min' => '數量至少為 1',
        ]);

        DB::transaction(function () use ($validated) {
            $order = Order::create([
                'customer_id' => $validated['customer_id'],
                'note' => $validated['note'] ?? null,
            ]);

            foreach ($validated['items'] as $item) {
                // 單價取自產品目前的資料，寫入明細作為下單當下的快照
                $product = Product::findOrFail($item['product_id']);

                OrderItem::create([
                    'order_id' => $order->id,
                    'product_id' => $product->id,
                    'qty' => $item['qty'],
                    'price' => $product->price,
                ]);
            }
        });

        return redirect()->route('orders.index')->with('success', '訂單已建立');
    }
}
