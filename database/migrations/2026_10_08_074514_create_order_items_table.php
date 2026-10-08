<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 建立訂單明細表。price 是下單當下的單價快照，之後改產品單價不影響歷史訂單。
     */
    public function up(): void
    {
        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained();
            $table->unsignedInteger('qty');
            $table->decimal('price', 10, 2);
            $table->timestamps();
        });
    }

    /**
     * 刪除訂單明細表。
     */
    public function down(): void
    {
        Schema::dropIfExists('order_items');
    }
};
