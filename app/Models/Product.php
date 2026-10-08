<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    // 允許批次寫入的欄位（Seeder 使用）
    protected $fillable = ['product_serial', 'name', 'price', 'status'];

    // 使用 $casts 屬性而非 casts() 方法，才能同時相容 Laravel 10 與 11 以上
    protected $casts = [
        'status' => 'boolean',
        'price' => 'decimal:2',
    ];
}
