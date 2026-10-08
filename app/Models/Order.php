<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Order extends Model
{
    // 允許批次寫入的欄位（表單送出使用）
    protected $fillable = ['customer_id', 'note'];

    /**
     * 訂單所屬的客戶。
     */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /**
     * 訂單的明細列。
     */
    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }
}
