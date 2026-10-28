# ممیزی مرجع‌ها و منشأ قابلیت‌ها

این بررسی روی snapshotهای مشخص‌شده در ۲۷ اکتبر ۲۰۲۶ انجام شد، نه روی همهٔ تاریخچه‌ها و وابستگی‌های آن پروژه‌ها. **مخزن عمومی یا badge مجوز استفاده نیست.** وضعیت حقوقی به فایل، نسخه، نویسنده، زنجیرهٔ منشأ، نحوهٔ توزیع و محل استفاده بستگی دارد. این سند مشاورهٔ حقوقی یا تأیید کامل clean-room نیست؛ پیش از فروش/توزیع، بررسی مستقل حقوقی و امنیتی لازم است.

## هشت مرجع، جداگانه

| مرجع و snapshot | آنچه بررسی شد | مجوز مشاهده‌شده | تصمیم دربارهٔ استفاده در NYX |
| --- | --- | --- | --- |
| [ysa-py/X](https://github.com/ysa-py/X/tree/24d8f2bf0bf600167439807b8d4cd38c6465b236) `24d8f2b` | `Source.js`، ساختار فایل‌های relay/scanner و داده‌های کنار آن؛ معماری و رابط به‌عنوان مرجع مقایسه | بدون مجوز ریشه؛ `Source.js` حاوی اعلام proprietary/copyright است | **کدی مستقیماً از این مرجع وارد نشده است.** شباهت ضرایب استاندارد SHA را در بخش محدودیت ممیزی ببینید؛ اجازهٔ استفاده از کل فایل فرض نشده است. |
| [amirh00sain/SpiderPanel](https://github.com/amirh00sain/SpiderPanel/tree/dd6a9d276bef6a2987b8caf21ea42342a3712324) `dd6a9d2` | پنل FastAPI، چرخهٔ کاربر/اشتراک، گره و workflow تلگرام در README و ساختار پروژه | در ریشه مجوز پروژه یافت نشد؛ وجود مجوز در زیردایرکتوری deploy به کل پروژه تعمیم ندارد | فقط مقایسهٔ قابلیت‌ها؛ هیچ کد، تصویر یا متن رابط از آن کپی نشده است. |
| [panelgozargah/gozargah](https://github.com/panelgozargah/gozargah/tree/63e22df41163ae2c21640960b07561c073bf7fad) `63e22df` | Worker، D1، احراز هویت، WebSocket، VLESS/Trojan، تولید اشتراک، UI و آزمون | [MIT](../third_party/gozargah/LICENSE)، با حفظ اعلام کپی‌رایت و متن مجوز | **تنها پروژهٔ مرجع که کد آن مستقیماً مبنای این پیاده‌سازی شده است.** بخش‌ها اصلاح شده‌اند؛ نام/نشان upstream جایگزین شده است. جدول preset منتسب به سایر پروژه‌ها حذف شده؛ منشأ مابقی همچنان نیازمند بررسی مستقل است. |
| [itsyebekhe/nahan](https://github.com/itsyebekhe/nahan/tree/ddad19fd00a8e2a3d2476b3c1d6c909d7783b229) `ddad19f` | ادعاهای relay mesh، WebSocket، اشتراک، telemetry و ربات در README و چیدمان پروژه | badge در README به `LICENSE` اشاره می‌کند ولی در snapshot فایل مجوز ریشه وجود ندارد؛ مجوز روشن برای کل پروژه احراز نشد | فقط مقایسهٔ مفهومی. هیچ کدی مستقیماً از آن وارد نشده است؛ mesh و ربات مدیریتی آن پیاده‌سازی نشده‌اند. |
| [netrair/netra-panel](https://github.com/netrair/netra-panel/tree/9f2c7824fee248005bb0bb60b3da63914fd21b8c) `9f2c782` | قابلیت‌های اعلام‌شدهٔ Worker، WARP، فرمت اشتراک و رابط | MIT در ریشه | بدون کپی مستقیم؛ WARP و installer bot در NYX وجود ندارند. ادعای «بدون هزینه» مبنای برآورد ما نیست. |
| [IRNova/Nova-Proxy](https://github.com/IRNova/Nova-Proxy/tree/ad2116aa89f8c7db8248f8142c1432900d835eb7) `ad2116a` | ادعاهای Shadowsocks، gRPC/XHTTP، fragment، چندکاربر و تغییرات مجوز | PolyForm Noncommercial 1.0.0 برای نسخهٔ فعلی؛ [تاریخچه](https://github.com/IRNova/Nova-Proxy/blob/ad2116aa89f8c7db8248f8142c1432900d835eb7/LICENSE-HISTORY.md) برای نسخه‌های قدیمی MIT و از 4.3.0 تغییر را شرح می‌دهد | **هیچ کد مستقیمی استفاده نشده است.** استفادهٔ تجاری از کد تحت مجوز غیرتجاری را بدون مجوز جداگانه مجاز فرض نمی‌کنیم. presetهای منتسب در upstream حذف شدند. |
| [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel/tree/a8ab11125ece9bc27983f609a6359be81b21050c) `a8ab111` | ادعاهای Worker/Pages، پروتکل‌ها، fallback و تولید اشتراک | GPL-2.0 در ریشه | کدی مستقیماً از آن وارد نشده است. GPL استفادهٔ تجاری را منع نمی‌کند، اما تعهدات copyleft آن با انتخاب MIT برای این شاخه نیازمند بررسی است؛ آن را به‌عنوان کد MIT وارد نکردیم. |
| [G-Core/fastedge-plugin](https://github.com/G-Core/fastedge-plugin/tree/e371d19ae0a36fd287b94415b8612b8a0089f7ad) `e371d19` | روش نصب، MCP/Docker، استقرار HTTP Wasm و محیط‌های پشتیبانی‌شده | Apache-2.0 در ریشه | مستندات نصب به‌عنوان راهنمای بیرونی؛ کد پلاگین در مخزن کپی نشده و پلاگین نصب نشده است. برنامهٔ `geo-page` با SDK رسمی جداگانه ساخته شده است. |

مرجع بصری اضافی [RezaFKH/devcop-landing](https://github.com/RezaFKH/devcop-landing/tree/6843e78d48c18ab420e7e12300858f4f881e992a) `6843e78` مجوز ریشهٔ مشخصی نداشت؛ متن، asset و کد آن کپی نشده است. رابط NYX جدید است، ولی پنل مدیریتی همچنان کد مشتق‌شدهٔ MIT گذرگاه دارد.

## ماتریس قابلیت → منشأ → نتیجه

| قابلیت | منشأ پیاده‌سازی/مقایسه | وضعیت واقعی NYX |
| --- | --- | --- |
| رابط FA/EN و مدیریت کاربر | پنل موجود Gozargah مشتق‌شده؛ کنسول NYX مستقل، مقایسه با SpiderPanel/Nova | UI، CRUD و شبیه‌سازی DOM محلی؛ مرورگر واقعی تأیید نشده |
| نشست، D1 و امنیت پایه | Gozargah با سخت‌سازی NYX | PBKDF2، cookie امضاشده، throttle D1، CSRF و bootstrap محلی تست شده؛ بررسی امنیتی مستقل نشده |
| VLESS/Trojan، TCP و اشتراک | کد Gozargah اصلاح‌شده، قالب‌های پروتکل عمومی و [مشخصات Trojan](https://trojan-gfw.github.io/trojan/protocol.html) | تبادل محلی Worker و آداپتور Pages؛ شبکه و کلاینت واقعی تأیید نشده |
| Shadowsocks، UDP، gRPC/XHTTP، WARP | فقط مقایسهٔ ادعاهای Nova/edgetunnel/Netra | در data plane NYX پیاده‌سازی نشده |
| preset اپراتور و fragment | preset منتسب upstream حذف؛ تنظیم دستی محدود در NYX | نام ISP فقط برچسب؛ fragment فقط در کانفیگ Xray و بدون تضمین اثربخشی |
| probe و رتبه‌بندی | پیاده‌سازی محدود NYX، بدون کپی relay mesh Nahan | فقط HTTPSهای allowlist و سنجش از edge؛ relay mesh/auto-heal و سنجش ایران وجود ندارد |
| AI و fallback | API عمومی Cloudflare و پیاده‌سازی NYX | کشف فهرست واقعی با token جداگانه، allowlist و cap؛ تست با provider شبیه‌سازی‌شده، نه AI زنده |
| تلگرام و اتوماسیون | API عمومی Telegram و پیاده‌سازی NYX؛ مقایسهٔ قابلیت‌های Spider/Nahan/Nova | پیام آزمایشی و گزارش مجموع زمان‌بندی‌شدهٔ Worker؛ ربات تعاملی، فروش یا پرداخت نیست |
| Pages | آداپتور مستقل `functions/[[path]].ts` روی کد Worker؛ مقایسهٔ Nahan/edgetunnel | build و آزمون محلی؛ WebSocket و deployment ابری نامطمئن |
| FastEdge | [SDK رسمی Gcore](https://github.com/G-Core/FastEdge-sdk-js)، [ابزار تست](https://github.com/G-Core/fastedge-test) و مرجع پلاگین | برنامهٔ مستقل HTTP geo ساخته‌شده به Wasm، بدون panel/proxy؛ اجرای محلی، نه استقرار |
| سهمیه و صورتحساب | توسعهٔ متر Gozargah | شمارش در اتصال و D1 بهترین‌تلاش؛ هماهنگی توزیع‌شده، billing، پرداخت و محدودیت دستگاه وجود ندارد |

## تغییرات سازگاری آگاهانه نسبت به Gozargah

- جدول preset که خود را port از Nova/BPB می‌نامید حذف شد. برچسب‌های اپراتور خنثی‌اند و پارامتر fragment به‌صورت صریح توسط اپراتور داده می‌شود.
- رمز پیش‌فرض و fallbackهای قابل پیش‌بینی حذف شدند؛ D1 و رمز bootstrap لازم است. اشتراک، مسیر WebSocket و طول token تغییر کرده و باید دوباره توزیع شود. نشست‌های قدیمی ممکن است نامعتبر شوند.
- parser پروتکل Trojan، ورود، ثبت bytes، CSRF، logout و سایر مسیرها سخت‌سازی/اصلاح شدند. از کد MIT upstream استفاده شده، اما ۲۷ تست engine نیز برای رفتار جدید **تطبیق داده شده‌اند**؛ گذشتن آنها تضمین حفظ تک‌تک رفتارهای قبلی نیست.
- هیچ قابلیت یا ادعای تجاری/پروتکلی حذف‌شده پنهان نشده است؛ [راهنمای مهاجرت](DEPLOYMENT_FA.md#۷-مهاجرت-و-محدودیت-مهم) را بخوانید.

## محدودیت ممیزی منشأ

کپی مستقیم انجام‌شده از Gozargah دارای مجوز MIT است، ولی دیدن همان مجوز به‌تنهایی اصالت همهٔ خطوط upstream را ثابت نمی‌کند. برخی توضیحات upstream به پروژه‌های دیگر و benchmark اشاره دارند. جدول پرریسک اشاره‌شده حذف شد، با این حال provenance بقیهٔ کد، assetها، همهٔ نسخه‌ها و وابستگی‌های فراتر از npm، به‌طور جامع تأیید نشده‌اند.

یک مقایسهٔ محدودِ خطوط کد ۸۰ تا ۴۰۰ کاراکتری با شش مرجع غیر-Gozargah، با حذف خطوط کامنت، فایل‌های بزرگ و خروجی‌های minified، هفت خط مشترک `src/utils/sha224.ts` و `ysa-py/X/Source.js` را یافت: ردیف‌های ثابت SHA-256/SHA-224؛ همین ردیف‌ها عیناً در فایل MIT Gozargah وجود داشتند و مقادیر ثابت الگوریتم استانداردند. این غربال ساده **مقایسهٔ جامع، ردیابی تاریخچه، یا نظر حقوقی نیست** و نبود شباهت تغییرشکل‌یافته را اثبات نمی‌کند. در صورت حساسیت تجاری، ممیزی ماشینی/حقوقی کامل و در صورت نیاز جایگزینی مستقل انجام دهید.

اجزای npm، runtime Wasm و تعهدات توزیع: [اطلاعیه‌ها](THIRD_PARTY_NOTICES.md) و [SBOM](sbom.cdx.json).
