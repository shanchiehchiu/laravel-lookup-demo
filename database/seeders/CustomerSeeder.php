<?php

namespace Database\Seeders;

use App\Models\Customer;
use Illuminate\Database\Seeder;

class CustomerSeeder extends Seeder
{
    /**
     * 產生 30 筆示範客戶，足以測試分頁（每頁 10 筆）。
     * 第 25 筆之後設為停用，用來驗證停用客戶不會出現在彈窗裡。
     */
    public function run(): void
    {
        for ($i = 1; $i <= 30; $i++) {
            Customer::create([
                'no' => sprintf('C%03d', $i),
                'name' => "示範客戶 {$i}",
                'status' => $i <= 25,
            ]);
        }
    }
}
