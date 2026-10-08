<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 建立訂單資料表，customer_id 透過彈窗選取客戶後寫入。
     */
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $table->string('note')->nullable();
            $table->timestamps();
        });
    }

    /**
     * 刪除訂單資料表。
     */
    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
