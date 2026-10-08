<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * 建立示範資料。執行：php artisan migrate:fresh --seed
     */
    public function run(): void
    {
        $this->call([
            CustomerSeeder::class,
            ProductSeeder::class,
        ]);
    }
}
