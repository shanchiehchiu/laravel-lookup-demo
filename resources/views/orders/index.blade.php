@extends('layouts.app')

@section('title', '訂單列表')

@section('content')
    <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h3 mb-0">訂單列表</h1>
        <a class="btn btn-primary" href="{{ route('orders.create') }}">新增訂單</a>
    </div>

    <div class="card">
        <div class="table-responsive">
            <table class="table table-striped mb-0">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>客戶</th>
                        <th>品項數</th>
                        <th class="text-end">金額</th>
                        <th>備註</th>
                        <th>建立時間</th>
                    </tr>
                </thead>
                <tbody>
                    @forelse ($orders as $order)
                        <tr>
                            <td>{{ $order->id }}</td>
                            <td>{{ $order->customer?->no }} - {{ $order->customer?->name }}</td>
                            <td>{{ $order->items->count() }}</td>
                            <td class="text-end">{{ number_format($order->items->sum(fn ($item) => $item->qty * $item->price), 2) }}</td>
                            <td>{{ $order->note }}</td>
                            <td>{{ $order->created_at->format('Y-m-d H:i') }}</td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="6" class="text-center text-muted py-4">目前沒有訂單</td>
                        </tr>
                    @endforelse
                </tbody>
            </table>
        </div>
    </div>
@endsection
