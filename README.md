# Omid YouTube FA Subtitle v1.1.0

این نسخه بر اساس ایده‌ی capture کردن URL واقعی زیرنویس از خود YouTube player ساخته شده است.

## چرا نسخه قبلی خطای empty response می‌داد؟

در خیلی از ویدیوهای YouTube، آدرس خام caption داخل `ytInitialPlayerResponse` توکن معتبر player را ندارد. نتیجه این می‌شود که YouTube با کد 200 جواب می‌دهد، اما body خالی است:

`json3: empty response`

نسخه 1.1.0 مثل افزونه مرجعی که بررسی شد، از MAIN world استفاده می‌کند، `fetch` و `XMLHttpRequest` خود صفحه را hook می‌کند، caption را موقتاً از خود player روشن می‌کند و URL واقعی `/api/timedtext` را که خود player درخواست کرده capture می‌کند.

## نصب تمیز

1. ZIP را Extract کن.
2. برو به `chrome://extensions`.
3. نسخه قبلی را Remove کن.
4. روی Load unpacked بزن.
5. پوشه `omid-youtube-fa-subtitle` را انتخاب کن.
6. صفحه YouTube را کامل Refresh کن.

## استفاده

1. ویدیویی که caption دارد باز کن.
2. افزونه را باز کن.
3. ترک را انتخاب کن.
4. روی «دانلود JSON برای ترجمه» بزن.
5. فایل JSON را به مدل بده و فقط `fa` را پر کن.
6. JSON ترجمه‌شده را دوباره از افزونه Load کن.

## نکته

اگر بار اول capture نشد، یک بار caption خود YouTube را دستی روشن کن، بعد خاموش کن، و دوباره از افزونه خروجی بگیر.
