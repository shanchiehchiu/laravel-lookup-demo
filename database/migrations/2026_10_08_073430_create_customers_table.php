<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 建立客戶資料表（彈窗搜尋的資料來源）。
     */
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->string('no')->unique();    // 客戶編號
            $table->string('name');            // 客戶名稱
            $table->boolean('status')->default(true); // 是否啟用；停用的客戶不出現在彈窗
            $table->timestamps();
        });
    }

    /**
     * 刪除客戶資料表。
     */
    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};
