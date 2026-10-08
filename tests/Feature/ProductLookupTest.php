<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\OrderItem;
use App\Models\Product;
use Database\Seeders\CustomerSeeder;
use Database\Seeders\ProductSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * 示範資料：500 筆產品，P498～P500 停用，啟用中共 497 筆；價格 = 100 + 序號 × 10。
 */
class ProductLookupTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(CustomerSeeder::class);
        $this->seed(ProductSeeder::class);
    }

    public function test_info_returns_active_product_by_serial(): void
    {
        $this->getJson(route('products.lookup-info', ['product_serial' => 'P005']))
            ->assertOk()
            ->assertJsonPath('result.product_serial', 'P005')
            ->assertJsonPath('result.name', '示範產品 5');
    }

    public function test_info_returns_null_for_missing_or_disabled_product(): void
    {
        // 查無
        $this->getJson(route('products.lookup-info', ['product_serial' => 'NOPE']))
            ->assertOk()
            ->assertJsonPath('result', null);

        // 停用的 P499 也視為查無
        $this->getJson(route('products.lookup-info', ['product_serial' => 'P499']))
            ->assertOk()
            ->assertJsonPath('result', null);
    }

    public function test_info_requires_serial_or_id(): void
    {
        $this->getJson(route('products.lookup-info'))->assertStatus(422);
    }

    public function test_lookup_lists_active_products_in_pages_of_ten(): void
    {
        // 500 筆中停用 3 筆，應剩 497 筆、50 頁
        $this->getJson(route('products.lookup'))
            ->assertOk()
            ->assertJsonPath('total', 497)
            ->assertJsonPath('last_page', 50)
            ->assertJsonPath('current_page', 1)
            ->assertJsonCount(10, 'datas');
    }

    public function test_lookup_applies_contains_condition_from_json(): void
    {
        $conditions = json_encode([
            ['boolean' => 'and', 'field' => 'product_serial', 'operator' => 'contains', 'value' => 'P01'],
        ]);

        // P010～P019 共 10 筆
        $this->getJson(route('products.lookup', ['search_conditions' => $conditions]))
            ->assertOk()
            ->assertJsonPath('total', 10);
    }

    public function test_lookup_applies_numeric_condition(): void
    {
        // 價格 >= 250 → 序號 >= 15；啟用中為 15～497，共 483 筆
        $conditions = json_encode([
            ['boolean' => 'and', 'field' => 'price', 'operator' => 'gte', 'value' => '250'],
        ]);

        $this->getJson(route('products.lookup', ['search_conditions' => $conditions]))
            ->assertOk()
            ->assertJsonPath('total', 483);
    }

    public function test_lookup_empty_conditions_returns_everything_active(): void
    {
        $this->getJson(route('products.lookup', ['search_conditions' => '[]']))
            ->assertOk()
            ->assertJsonPath('total', 497);
    }

    public function test_lookup_rejects_fields_outside_allowlist(): void
    {
        // 想搜尋資料表裡不允許的欄位（例如 status）必須被拒絕，不能直接拿來當 SQL 欄位
        $conditions = json_encode([
            ['boolean' => 'and', 'field' => 'status', 'operator' => 'eq', 'value' => '0'],
        ]);

        $this->getJson(route('products.lookup', ['search_conditions' => $conditions]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('search_conditions');
    }

    public function test_lookup_rejects_operator_not_allowed_for_field(): void
    {
        // 產品編號不支援「大於等於」
        $conditions = json_encode([
            ['boolean' => 'and', 'field' => 'product_serial', 'operator' => 'gte', 'value' => 'P01'],
        ]);

        $this->getJson(route('products.lookup', ['search_conditions' => $conditions]))
            ->assertStatus(422);
    }

    public function test_lookup_rejects_malformed_json(): void
    {
        $this->getJson(route('products.lookup', ['search_conditions' => '{not json']))
            ->assertStatus(422);
    }

    public function test_metadata_lists_allowlisted_fields(): void
    {
        $this->getJson(route('products.lookup-metadata'))
            ->assertOk()
            ->assertJsonPath('fields.0.key', 'product_serial')
            ->assertJsonPath('fields.1.key', 'name')
            ->assertJsonPath('fields.2.key', 'price')
            ->assertJsonPath('operators.contains', '包含');
    }

    public function test_field_options_returns_distinct_names_matching_term(): void
    {
        // 名稱包含「示範產品 1」共 111 筆，每頁 20 筆，所以還有下一頁
        $this->getJson(route('products.lookup-field-options', ['field' => 'name', 'term' => '示範產品 1']))
            ->assertOk()
            ->assertJsonPath('results.0.id', '示範產品 1')
            ->assertJsonPath('pagination.more', true);
    }

    public function test_field_options_rejects_fields_outside_allowlist(): void
    {
        $this->getJson(route('products.lookup-field-options', ['field' => 'status']))
            ->assertStatus(422);
    }

    public function test_order_is_saved_with_items_and_price_snapshot(): void
    {
        $customer = Customer::where('no', 'C001')->firstOrFail();
        $product = Product::where('product_serial', 'P002')->firstOrFail();

        $this->post(route('orders.store'), [
            'customer_id' => $customer->id,
            'items' => [
                ['product_id' => $product->id, 'qty' => 3],
            ],
        ])->assertRedirect(route('orders.index'));

        $item = OrderItem::firstOrFail();
        $this->assertSame(3, $item->qty);
        $this->assertSame($product->id, $item->product_id);
        $this->assertEquals($product->price, $item->price);
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_order_rejects_disabled_product(): void
    {
        $customer = Customer::where('no', 'C001')->firstOrFail();
        $disabled = Product::where('product_serial', 'P499')->firstOrFail();

        $this->post(route('orders.store'), [
            'customer_id' => $customer->id,
            'items' => [
                ['product_id' => $disabled->id, 'qty' => 1],
            ],
        ])->assertSessionHasErrors('items.0.product_id');

        $this->assertDatabaseCount('orders', 0);
        $this->assertDatabaseCount('order_items', 0);
    }

    public function test_order_requires_at_least_one_item(): void
    {
        $customer = Customer::where('no', 'C001')->firstOrFail();

        $this->post(route('orders.store'), ['customer_id' => $customer->id, 'items' => []])
            ->assertSessionHasErrors('items');

        $this->assertDatabaseCount('orders', 0);
    }

    public function test_order_rejects_zero_quantity(): void
    {
        $customer = Customer::where('no', 'C001')->firstOrFail();
        $product = Product::where('product_serial', 'P001')->firstOrFail();

        $this->post(route('orders.store'), [
            'customer_id' => $customer->id,
            'items' => [['product_id' => $product->id, 'qty' => 0]],
        ])->assertSessionHasErrors('items.0.qty');

        $this->assertDatabaseCount('orders', 0);
    }
}
