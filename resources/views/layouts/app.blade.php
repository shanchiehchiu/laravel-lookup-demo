<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', '訂單系統') - 彈窗搜尋示範</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.13/css/select2.min.css">
    @stack('style')
</head>
<body class="bg-light">
    <nav class="navbar navbar-dark bg-dark mb-4">
        <div class="container">
            <a class="navbar-brand" href="{{ route('orders.index') }}">訂單系統</a>
            <a class="btn btn-outline-light btn-sm" href="{{ route('orders.create') }}">新增訂單</a>
        </div>
    </nav>

    <main class="container">
        @if (session('success'))
            <div class="alert alert-success">{{ session('success') }}</div>
        @endif
        @yield('content')
    </main>

    {{-- jQuery 與 Bootstrap 是彈窗元件的必要依賴，順序不可對調（lookup.js 會用到兩者） --}}
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.13/js/select2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script src="{{ asset('js/lookup.js') }}"></script>
    <script src="{{ asset('js/product-lookup.js') }}"></script>
    <script src="{{ asset('js/product-batch-lookup.js') }}"></script>
    @stack('scripts')
</body>
</html>
