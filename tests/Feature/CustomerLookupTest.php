<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Product;
use Database\Seeders\CustomerSeeder;
use Database\Seeders\ProductSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CustomerLookupTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(CustomerSeeder::class);
    }

    public function test_lookup_returns_only_active_customers_in_pages_of_ten(): void
    {
        // 30 筆中停用 5 筆（C026～C030），應剩 25 筆、3 頁
        $this->getJson(route('customers.lookup'))
            ->assertOk()
            ->assertJsonPath('total', 25)
            ->assertJsonPath('last_page', 3)
            ->assertJsonPath('current_page', 1)
            ->assertJsonCount(10, 'datas');
    }

    public function test_lookup_page_parameter_moves_to_next_page(): void
    {
        $this->getJson(route('customers.lookup', ['page' => 3]))
            ->assertOk()
            ->assertJsonPath('current_page', 3)
            ->assertJsonCount(5, 'datas');
    }

    public function test_lookup_filters_by_allowlisted_fields(): void
    {
        // C001～C009 皆啟用
        $this->getJson(route('customers.lookup', ['no' => 'C00']))
            ->assertOk()
            ->assertJsonPath('total', 9);

        // 名稱含「示範客戶 2」的：2、20～25 啟用；26～29 停用不算 → 共 7 筆
        $this->getJson(route('customers.lookup', ['name' => '示範客戶 2']))
            ->assertOk()
            ->assertJsonPath('total', 7);
    }

    public function test_lookup_ignores_unknown_parameters_and_array_input(): void
    {
        // 非白名單參數不會影響查詢；陣列輸入會被略過而不是報錯
        $this->getJson(route('customers.lookup', ['status' => 0, 'no' => ['C001']]))
            ->assertOk()
            ->assertJsonPath('total', 25);
    }

    public function test_lookup_id_returns_single_customer_for_prefill(): void
    {
        $customer = Customer::where('no', 'C002')->firstOrFail();

        $this->getJson(route('customers.lookup', ['lookup_id' => $customer->id]))
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('datas.0.no', 'C002');
    }

    public function test_order_cannot_be_saved_for_disabled_customer(): void
    {
        $disabled = Customer::where('status', false)->firstOrFail();

        $this->post(route('orders.store'), ['customer_id' => $disabled->id])
            ->assertSessionHasErrors('customer_id');

        $this->assertDatabaseCount('orders', 0);
    }

    public function test_order_can_be_saved_for_active_customer(): void
    {
        $this->seed(ProductSeeder::class);

        $active = Customer::where('no', 'C001')->firstOrFail();

        $product = Product::where('status', true)->firstOrFail();

        $this->post(route('orders.store'), [
            'customer_id' => $active->id,
            'note' => '測試',
            'items' => [['product_id' => $product->id, 'qty' => 1]],
        ])
            ->assertRedirect(route('orders.index'));

        $this->assertDatabaseHas('orders', ['customer_id' => $active->id, 'note' => '測試']);
    }
}
