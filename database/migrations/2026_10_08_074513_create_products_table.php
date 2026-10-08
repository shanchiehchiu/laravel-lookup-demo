<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 建立產品資料表（產品快速輸入與彈窗搜尋的資料來源）。
     */
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('product_serial')->unique(); // 產品編號，快速輸入時按 Enter 精確查詢的依據
            $table->string('name');                     // 產品名稱
            $table->decimal('price', 10, 2)->default(0); // 單價
            $table->boolean('status')->default(true);    // 是否啟用；停用產品不能被選取
            $table->timestamps();
        });
    }

    /**
     * 刪除產品資料表。
     */
    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
