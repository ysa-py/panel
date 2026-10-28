# Verification ledger / دفترچهٔ شواهد آزمون

تاریخ بررسی: ۲۷–۲۸ اکتبر ۲۰۲۶؛ اجرای نهایی مجموعهٔ کامل در ۲۸ اکتبر انجام شد. `VERIFIED` در این سند فقط به **دامنهٔ ذکرشده** مربوط است؛ به معنی آماده‌بودن برای تولید نیست. `UNVERIFIED` یعنی پیاده‌سازی/دستور وجود دارد ولی شرایط واقعی آزموده نشده؛ `BLOCKED` یعنی به حساب، دسترسی شبکه، ابزار یا اقدام صاحب حساب نیاز بوده و انجام نشده است.

## نتایج قابل تکرار در این محیط

محیط: Node.js `22.22.3`، npm `10.9.8`، TypeScript `5.9.3`، Wrangler `4.154.0`، Miniflare `5.20261023.1-beta` و FastEdge SDK `2.7.0`. Miniflare و runtime محلی جایگزین کل شبکهٔ ارائه‌دهنده نیستند.

| بررسی | دستور / مشاهده | وضعیت |
| --- | --- | --- |
| نصب وابستگی از lockfile | `npm ci` | **VERIFIED محلی**؛ ۲۷۴ package در پلتفرم آزمون نصب شد؛ یک هشدار deprecation، بدون ادعای پاکی زنجیرهٔ تأمین |
| strict TypeScript | `npm run typecheck` | **VERIFIED محلی** برای sourceهای TS و geo-page؛ JavaScriptهای داخل رشته‌های HTML و ابزارهای `.mjs` با TypeScript بررسی نمی‌شوند |
| آزمون واحد و رابط | `npm test` | **VERIFIED محلی:** ۲۲ آزمون Vitest و ۲۷ بررسی engine مشتق و تطبیق‌داده‌شده از Gozargah. UI با jsdom شبیه‌سازی شده، نه مرورگر واقعی |
| API Worker و D1 | `npm run test:integration` | **VERIFIED محلی:** ۱۵/۱۵؛ bootstrap، fail-closed، throttle، login/logout، CSRF، POST QR، CRUD، expiry اشتراک، quota reset، چرخش credential و AI fallback |
| مسیر داده Worker | `npm run test:tunnel` | **VERIFIED محلی:** ۹ بررسی شامل VLESS و Trojan به TCP echo متعلق به تست، هدر تکه‌تکه، early data، ذخیرهٔ bytes، رد credential/UDP و quota تک‌اتصال |
| اعلان و scheduler Worker | `npm run test:telegram` | **VERIFIED محلی:** ارسال به سرویس شبیه‌سازی‌شده، رزرو یک گزارش در روز، ثبت شکست بدون retry |
| Workers AI | `npm run test:ai` | **VERIFIED محلی:** binding شبیه‌سازی‌شده، allowlist، fallback شکست و cap اتمیک دو درخواست D1؛ اتصال به مدل واقعی نیست |
| Worker bundle | `npm run build` | **VERIFIED محلی:** Wrangler dry-run؛ deploy نیست |
| Pages Functions | `npm run test:pages` | **VERIFIED محلی:** ساخت آداپتور و همان ۱۶ آزمون API، ۹ بررسی tunnel، و تست‌های AI/پیام شبیه‌سازی‌شده. Pages scheduler ندارد |
| FastEdge HTTP Wasm | `npm run build:geo && npm run test:geo` | **VERIFIED محلی:** Wasm واقعی ساخته شد و ۸/۸ تست در runtime آزمایشی Gcore گذشت: metadata، HTML escaping، فقط origin بدون query، cache/CSP، route، method و HEAD. Node هشدار experimental WASI می‌دهد |
| وابستگی‌های شناخته‌شده | `npm audit --audit-level=high` | **VERIFIED محلی در زمان بررسی:** خروجی `found 0 vulnerabilities`؛ advisoryهای ناشناخته و مجوزها را پوشش نمی‌دهد |
| اسکن secret | `npm run scan:secrets` | **VERIFIED محدود:** الگوهای انتخابی روی فایل‌های قابل مشاهدهٔ worktree، blobهای stage و history محلی قابل‌دسترسی، بدون چاپ محتوا؛ باینری/بزرگ/ignored و secret بدون الگوی شناخته‌شده ممکن است جا بمانند |
| دستورات یک‌جا | `npm run check` | **VERIFIED محلی:** اجرای نهایی typecheck، تست‌ها، buildهای Worker/Pages/Wasm و اسکن محدود بدون خطا پایان یافت |

checkout محلی shallow است. `git cat-file` و GitHub API نشان دادند commit پایهٔ `4492f449537974c3a6730539ead8812e225b1b4f` صفر parent دارد و درخت آن فقط README بود. اسکن تاریخچه محدود به refها و objectهای قابل‌دسترسی همین checkout است، نه forkها، حساب‌ها، فایل‌های ignored، سایر مخازن یا داده‌های قبلاً افشاشده. حتی نتیجهٔ بدون finding اثبات نبود credential نیست.

مخزن هدف ابتدا فقط README داشت؛ baseline کد Gozargah جداگانه بررسی و آزموده شد. تست‌های engine پس از حذف preset منتسب و تغییرهای امنیتی آگاهانه تطبیق یافته‌اند. خروجی سبز آنها تضمین حفظ تمام رفتار upstream نیست.

## موارد تأییدنشده یا مسدود

| موضوع | وضعیت | اقدام لازم |
| --- | --- | --- |
| استقرار واقعی Cloudflare Worker و D1 | **BLOCKED / UNVERIFIED** | دسترسی API Cloudflare از این محیط برقرار نشد؛ صاحب حساب با secret جدید، D1 واقعی، دامنه و [راهنما](DEPLOYMENT_FA.md) deploy و end-to-end test کند. |
| Cloudflare Pages در ابر | **BLOCKED / UNVERIFIED** | D1 و secret محیط صحیح و به‌ویژه WebSocket و outbound TCP روی دامنهٔ واقعی آزموده شوند؛ موفقیت local به‌تنهایی کافی نیست. |
| Gcore FastEdge URL عمومی | **BLOCKED / UNVERIFIED** | Wasm در حساب واقعی upload/deploy نشده؛ URL را از Portal بگیرید. origin نمایش‌داده‌شده از request است و خود به‌تنهایی تأیید deployment نیست. |
| نصب FastEdge plugin/MCP | **BLOCKED** | Docker/host agent لازم در محیط موجود نبود؛ نصب و ورود Portal در دستگاه خودتان طبق README رسمی انجام شود. |
| کلاینت‌های واقعی و ترافیک شبکهٔ ایران | **UNVERIFIED** | کلاینت‌ها، نسخه‌ها، ISPها، TLS، IPv4/IPv6، latency، drop و عملکرد در زمان واقعی مستقلاً آزموده شوند؛ ادعای bypass وجود ندارد. |
| رابط و دسترس‌پذیری | **UNVERIFIED** | jsdom مرورگر واقعی نیست؛ responsive، صفحه‌خوان، کیبورد، contrast و FA/EN/RTL را با مرورگر واقعی و دستگاه‌های مختلف بررسی کنید. |
| مدل‌های زنده، قیمت و انتقال داده | **UNVERIFIED** | با حساب خود، توکن محدود، مدل در allowlist و budget واقعی تست شود. برآورد هزینه و در دسترس‌بودن مدل متغیر است. |
| Telegram واقعی | **UNVERIFIED** | توکن جدید و chat شخصی را محرمانه تنظیم و پیام آزمایشی را بررسی کنید؛ گزارش cron فقط Worker است. |
| quota توزیع‌شده و قطع فوری اتصال | **UNVERIFIED / ناکافی برای billing** | بار همزمان چند isolate/اتصال و خطاها را آزموده و برای صورتحساب معماری حسابداری قابل اتکا طراحی کنید. |
| backup/restore واقعی | **UNVERIFIED** | export رمزگذاری‌شده و import به D1 جدید را در حساب خود تمرین کنید، نه روی دادهٔ اصلی. |
| CI ابری GitHub | **UNVERIFIED تا اجرای workflow** | `.github/workflows/ci.yml` تست را تعریف می‌کند؛ نتیجهٔ واقعی Actions باید بعد از push/PR جداگانه بررسی شود. |
| امنیت، مجوزها و binary Wasm | **UNVERIFIED** | ممیزی مستقل نفوذ، provenance کامل، dependency/binary notices و بررسی حقوقی لازم است؛ [محدودیت‌ها](SECURITY_AND_LIMITS.md) و [اطلاعیه‌ها](THIRD_PARTY_NOTICES.md). |

پس از هر تغییر source، تست مربوطه و در پایان `npm run check` را دوباره اجرا کنید. نمونه‌های رمز در تست‌ها مصنوعی‌اند و هیچ‌کدام برای محیط واقعی مناسب نیستند.
