<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderItem extends Model
{
    // 允許批次寫入的欄位（下單時使用）
    protected $fillable = ['order_id', 'product_id', 'qty', 'price'];

    /**
     * 明細所屬的訂單。
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * 明細對應的產品。
     */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
