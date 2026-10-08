<?php

namespace Database\Seeders;

use App\Models\Product;
use Illuminate\Database\Seeder;

class ProductSeeder extends Seeder
{
    /**
     * 產生 500 筆示範產品，足以測試分頁與捲動載入（每頁 10 筆）。
     * 最後 3 筆（P498～P500）設為停用，用來驗證停用產品不能被選取。
     */
    public function run(): void
    {
        for ($i = 1; $i <= 500; $i++) {
            Product::create([
                'product_serial' => sprintf('P%03d', $i),
                'name' => "示範產品 {$i}",
                'price' => 100 + $i * 10,
                'status' => $i <= 497,
            ]);
        }
    }
}
