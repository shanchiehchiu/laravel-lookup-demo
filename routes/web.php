<?php

use App\Http\Controllers\LookupController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\ProductLookupController;
use Illuminate\Support\Facades\Route;

// 首頁直接導到訂單列表
Route::redirect('/', '/orders');

Route::get('/orders', [OrderController::class, 'index'])->name('orders.index');
Route::get('/orders/create', [OrderController::class, 'create'])->name('orders.create');
Route::post('/orders', [OrderController::class, 'store'])->name('orders.store');

// 彈窗搜尋（客戶）的查詢 API
Route::get('/lookup/customers', [LookupController::class, 'customers'])->name('customers.lookup');

// 產品快速輸入（ProductLookup）的四支 API
Route::get('/lookup/products/info', [ProductLookupController::class, 'info'])->name('products.lookup-info');
Route::get('/lookup/products', [ProductLookupController::class, 'lookup'])->name('products.lookup');
Route::get('/lookup/products/metadata', [ProductLookupController::class, 'metadata'])->name('products.lookup-metadata');
Route::get('/lookup/products/field-options', [ProductLookupController::class, 'fieldOptions'])->name('products.lookup-field-options');
