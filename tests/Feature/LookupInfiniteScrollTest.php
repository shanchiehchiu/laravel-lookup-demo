<?php

namespace Tests\Feature;

use Database\Seeders\ProductSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * 延遲載入（捲動載入）與多選（批次選取）共用的產品查詢 API 行為。
 * 示範資料：500 筆產品，其中 P498～P500 停用，因此啟用中共 497 筆、每頁 10 筆、共 50 頁。
 */
class LookupInfiniteScrollTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(ProductSeeder::class);
    }

    public function test_second_page_is_available_for_infinite_scroll(): void
    {
        $this->getJson(route('products.lookup', ['page' => 2]))
            ->assertOk()
            ->assertJsonPath('current_page', 2)
            ->assertJsonPath('last_page', 50)
            ->assertJsonCount(10, 'datas');
    }

    public function test_last_page_is_partial_for_infinite_scroll(): void
    {
        // 497 筆 = 49 頁 × 10 + 7，最後一頁只剩 7 筆
        $this->getJson(route('products.lookup', ['page' => 50]))
            ->assertOk()
            ->assertJsonPath('current_page', 50)
            ->assertJsonCount(7, 'datas');
    }

    public function test_general_tab_serial_filter_uses_contains(): void
    {
        // 產品編號包含 P02 → P020～P029，共 10 筆（全部啟用）
        $this->getJson(route('products.lookup', ['product_serial' => 'P02']))
            ->assertOk()
            ->assertJsonPath('total', 10);
    }

    public function test_general_tab_name_filter_uses_contains(): void
    {
        // 名稱包含「示範產品 1」→ 1、10～19、100～199 共 111 筆，全部啟用
        $this->getJson(route('products.lookup', ['name' => '示範產品 1']))
            ->assertOk()
            ->assertJsonPath('total', 111);
    }

    public function test_general_tab_ignores_disabled_products(): void
    {
        // P499 停用，即使編號符合也不會出現
        $this->getJson(route('products.lookup', ['product_serial' => 'P499']))
            ->assertOk()
            ->assertJsonPath('total', 0);
    }
}
