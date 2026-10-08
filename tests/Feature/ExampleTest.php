<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExampleTest extends TestCase
{
    use RefreshDatabase;

    /**
     * 首頁導向訂單列表，列表頁應可正常開啟。
     */
    public function test_the_order_list_page_loads(): void
    {
        $this->get('/')->assertRedirect('/orders');

        $this->get('/orders')->assertOk();
    }
}
