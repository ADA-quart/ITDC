package io.github.adaquart.itdc.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * ITDC 桌面小组件。
 *
 * 结构：顶栏（课表名 + 日期周次）/ 今天·明天双栏课表 / 待办列表，
 * 三个列表都是集合型（RemoteViewsService + ListView），因此都可以上下滑动。
 *
 * 数据来源两种模式：
 *   local  —— App 推送的快照（默认；含仅本机模式）
 *   server —— 从服务器 /api/widget/today 拉取
 */
public class ITDCWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "ITDCWidget";
    /**
     * 刷新排程：对齐关键边界 + 兜底。
     *
     * 主路径是「边界对齐」——今天每节课的结束时刻、次日 00:02 跨天——见
     * nextRefreshTime()；这里只留一个最长兜底间隔，防止某次闹钟没投递导致链断掉。
     * 全部不带 WAKEUP：设备睡着时不叫醒它，亮屏/解锁会立即补发（另有解锁广播直接刷新）。
     */
    private static final long REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000L;
    /** setWindow 的窗口：醒着时最多晚 10 分钟投递；API 31+ 要求窗口不小于 10 分钟 */
    private static final long REFRESH_WINDOW_MS = 10 * 60 * 1000L;
    private static final String PREFS = "widget_prefs";

    public static final String MODE_LOCAL = "local";
    public static final String MODE_SERVER = "server";
    /** 小组件点击时带上，供 MainActivity 判断是否需要把 WebView 拉回主页 */
    public static final String EXTRA_OPEN_HOME = "itdc_open_home";

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        ensureConfigReceiver(context);
        if (intent.getData() != null) {
            String widgetIdStr = intent.getData().toString()
                    .substring(intent.getData().toString().lastIndexOf('/') + 1);
            try { refreshWidget(context, Integer.parseInt(widgetIdStr)); }
            catch (NumberFormatException e) { Log.e(TAG, "bad widget id", e); }
        } else if ("io.github.adaquart.itdc.WIDGET_REFRESH".equals(intent.getAction())) {
            refreshAll(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        ensureConfigReceiver(context);
        for (int id : appWidgetIds) refreshWidget(context, id);
        scheduleRefresh(context);
    }

    // 用户拖动改尺寸后重排布局，避免内容被裁切
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager,
                                          int appWidgetId, android.os.Bundle newOptions) {
        refreshWidget(context, appWidgetId);
    }

    // 删除最后一个小组件时停止定时刷新，避免无谓的后台唤醒
    @Override
    public void onDisabled(Context context) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            Intent it = new Intent(context, ITDCWidgetProvider.class);
            it.setAction("io.github.adaquart.itdc.WIDGET_REFRESH");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(context, 0, it, flags);
            am.cancel(pi);
        } catch (Exception e) { Log.e(TAG, "onDisabled failed", e); }
    }

    /**
     * 系统深/浅色切换时，系统并不会主动重绘 App Widget——不自己刷新的话，
     * 「跟随系统」要等到下一次定时刷新（解锁 / 下课 / 跨天 / 兜底 2 小时）才生效，
     * 用户看到的现象就是「切了深色，小组件还是白的」。
     *
     * 这个广播只能动态注册（清单里声明收不到），所以每次 onUpdate / onReceive
     * 都确保注册一次：进程活着时就能实时跟随，进程被杀则退回定时刷新。
     */
    static void ensureConfigReceiver(Context context) {
        if (configReceiverRegistered) return;
        try {
            IntentFilter filter = new IntentFilter(Intent.ACTION_CONFIGURATION_CHANGED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(CONFIG_RECEIVER, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                context.registerReceiver(CONFIG_RECEIVER, filter);
            }
            configReceiverRegistered = true;
        } catch (Exception e) {
            Log.e(TAG, "register config receiver failed", e);
        }
    }

    private static boolean configReceiverRegistered = false;

    private static final BroadcastReceiver CONFIG_RECEIVER = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            try {
                refreshAll(context);
            } catch (Exception e) {
                Log.e(TAG, "config refresh failed", e);
            }
        }
    };

    private static void refreshAll(Context context) {
        try {
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            ComponentName comp = new ComponentName(context, ITDCWidgetProvider.class.getName());
            for (int id : awm.getAppWidgetIds(comp)) {
                // 先让列表数据源重算（已结束的课要消失），再重绘外壳
                awm.notifyAppWidgetViewDataChanged(id, R.id.widget_today_list);
                awm.notifyAppWidgetViewDataChanged(id, R.id.widget_tomorrow_list);
                awm.notifyAppWidgetViewDataChanged(id, R.id.widget_todo_list);
                refreshWidget(context, id);
            }
        } catch (Exception e) { Log.e(TAG, "refreshAll failed", e); }
        // 每次刷新后重排下一次：对齐下一个课程边界 / 跨天 / 兜底
        scheduleRefresh(context);
    }

    private static void scheduleRefresh(Context context) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            Intent it = new Intent(context, ITDCWidgetProvider.class);
            it.setAction("io.github.adaquart.itdc.WIDGET_REFRESH");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(context, 0, it, flags);
            long trigger = nextRefreshTime(context, System.currentTimeMillis());
            // 不带 WAKEUP 的 RTC + 窗口：设备睡着时不叫醒，亮屏时过期闹钟会立即补发；
            // 醒着时在窗口内投递。setWindow 不需要精确闹钟权限。
            am.setWindow(AlarmManager.RTC, trigger, REFRESH_WINDOW_MS, pi);
        } catch (Exception e) { Log.e(TAG, "scheduleRefresh failed", e); }
    }

    /**
     * 下一次刷新的时刻：对齐关键边界而不是固定周期，候选取最早的一个。
     *
     *  - 今天每节课的结束时刻：下课即从列表消失；
     *  - 次日 00:02：跨天后「今天 / 明天」换成新一天（快照覆盖多天，无需 App 推送）；
     *  - REFRESH_INTERVAL_MS 兜底：万一某次没投递，链路仍能在 2 小时内恢复。
     */
    private static long nextRefreshTime(Context context, long now) {
        long next = now + REFRESH_INTERVAL_MS;
        try {
            long midnight = dayStart(now) + 24 * 60 * 60 * 1000L + 2 * 60 * 1000L;
            if (midnight > now && midnight < next) next = midnight;

            String snapshot = getLocalSnapshot(context);
            if (TextUtils.isEmpty(snapshot)) return next;
            JSONObject root = new JSONObject(snapshot);
            JSONObject today = findDay(root, currentDateKey());
            JSONArray items = today != null ? today.optJSONArray("items") : root.optJSONArray("schedule");
            if (items == null) return next;
            String nowHm = hm(now);
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                String end = o.optString("end", "");
                if (!end.matches("\\d{2}:\\d{2}")) continue;
                // HH:mm 的字典序即时间序；只挑还没到的结束时刻
                if (end.compareTo(nowHm) <= 0) continue;
                long t = dayStart(now) + hmToMillis(end) + 30 * 1000L;
                if (t > now && t < next) next = t;
            }
        } catch (Exception e) {
            Log.e(TAG, "nextRefreshTime failed", e);
        }
        return next;
    }

    /** 刷新入口：本机模式用快照，同步模式拉服务器（失败回退快照） */
    private static void refreshWidget(Context context, int appWidgetId) {
        String snapshot = getLocalSnapshot(context);

        if (MODE_LOCAL.equals(getMode(context))) {
            if (TextUtils.isEmpty(snapshot)) {
                updateHint(context, appWidgetId, context.getString(R.string.widget_local_no_data));
                return;
            }
            if (!isSnapshotUsable(snapshot)) {
                updateHint(context, appWidgetId, context.getString(R.string.widget_local_stale));
                return;
            }
            renderSnapshot(context, appWidgetId, snapshot);
            return;
        }

        // 同步模式：先用快照立即出图，避免等待网络期间桌面空白
        if (!TextUtils.isEmpty(snapshot) && isSnapshotUsable(snapshot)) {
            renderSnapshot(context, appWidgetId, snapshot);
        }

        String serverUrl = getServerUrl(context);
        if (TextUtils.isEmpty(serverUrl)) {
            if (!TextUtils.isEmpty(snapshot)) { renderSnapshot(context, appWidgetId, snapshot); return; }
            updateHint(context, appWidgetId, context.getString(R.string.widget_missing_server));
            return;
        }

        new Thread(() -> {
            String baseUrl = normalizeBaseUrl(serverUrl);
            String json = fetchJson(baseUrl + "/api/widget/today");
            if (json == null) {
                if (!TextUtils.isEmpty(snapshot)) { renderSnapshot(context, appWidgetId, snapshot); return; }
                updateHint(context, appWidgetId, context.getString(R.string.widget_offline));
                return;
            }
            renderSnapshot(context, appWidgetId, json);
        }).start();
    }

    /** 按快照渲染主界面并挂上三个可滚动列表 */
    private static void renderSnapshot(Context context, int appWidgetId, String json) {
        try {
            RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_main);
            applyAppearance(context, rv, appWidgetId);
            applyTextColors(context, rv);

            String boardTitle = "";
            String dateText = "";
            JSONObject root = null;
            try {
                root = new JSONObject(json);
                // 新结构优先：按「当前日期」选当天，跨天后无需 App 重新推送
                JSONObject today = findDay(root, currentDateKey());
                JSONObject tomorrow = findDay(root, tomorrowDateKey());
                String todayLabel = today != null ? today.optString("label", "") : root.optString("todayLabel", "");
                String tomorrowLabel = tomorrow != null ? tomorrow.optString("label", "") : root.optString("tomorrowLabel", "");
                String week = today != null ? today.optString("weekLabel", "") : root.optString("weekLabel", "");
                boardTitle = today != null ? today.optString("boardTitle", "") : root.optString("boardTitle", "");
                if (TextUtils.isEmpty(boardTitle) && tomorrow != null) {
                    boardTitle = tomorrow.optString("boardTitle", "");
                }
                if (TextUtils.isEmpty(boardTitle)) boardTitle = root.optString("boardTitle", "");

                // 顶栏只放「第 N 周」：日期已经写在「今天 10.7 / 明天 10.8」的分栏标题里，
                // 同一日期在两处出现没有意义。拿不到周次时再退回显示日期。
                if (!TextUtils.isEmpty(week)) {
                    dateText = context.getString(R.string.widget_week_prefix) + week
                            + context.getString(R.string.widget_week_suffix);
                } else {
                    dateText = todayLabel;
                }

                // 分栏标题带上日期，如「今天 9.29」「明天 9.30」
                String todayHeader = context.getString(R.string.widget_today);
                String tomorrowHeader = context.getString(R.string.widget_tomorrow);
                if (!TextUtils.isEmpty(todayLabel)) todayHeader += " " + todayLabel;
                if (!TextUtils.isEmpty(tomorrowLabel)) tomorrowHeader += " " + tomorrowLabel;
                rv.setTextViewText(R.id.widget_today_label, todayHeader);
                rv.setTextViewText(R.id.widget_tomorrow_label, tomorrowHeader);
            } catch (Exception e) {
                Log.e(TAG, "parse snapshot header failed", e);
            }

            rv.setTextViewText(R.id.widget_board_title,
                    TextUtils.isEmpty(boardTitle) ? context.getString(R.string.app_widget_label) : boardTitle);
            rv.setTextViewText(R.id.widget_date, dateText);
            rv.setTextViewText(R.id.widget_todo_header, context.getString(R.string.widget_todo_header));
            rv.setTextColor(R.id.widget_todo_all_done, WidgetAppearance.accent(context));
            // 「全部完成」：一键把当前展示的待办全部标记完成
            rv.setOnClickPendingIntent(R.id.widget_todo_all_done,
                    ITDCWidgetActionReceiver.allDonePendingIntent(context));

            // 三个列表都通过 RemoteViewsService 提供数据 → 均可上下滑动
            bindList(context, rv, R.id.widget_today_list, appWidgetId, ITDCWidgetListService.LIST_TODAY);
            bindList(context, rv, R.id.widget_tomorrow_list, appWidgetId, ITDCWidgetListService.LIST_TOMORROW);
            bindList(context, rv, R.id.widget_todo_list, appWidgetId, ITDCWidgetListService.LIST_TODO);

            // 集合里的子项点击走 fill-in 模板（见 ITDCWidgetActionReceiver）
            rv.setPendingIntentTemplate(R.id.widget_todo_list,
                    ITDCWidgetActionReceiver.todoTemplatePendingIntent(context));

            // 打开 App：整块背景 + 标题 + 日期都能点。
            // 内容层负责空白区域；列表区域（ListView）自己消费触摸，不会因为外层可点而影响滚动。
            PendingIntent openApp = openAppIntent(context);
            rv.setOnClickPendingIntent(R.id.widget_root, openApp);
            rv.setOnClickPendingIntent(R.id.widget_content, openApp);
            rv.setOnClickPendingIntent(R.id.widget_board_title, openApp);
            rv.setOnClickPendingIntent(R.id.widget_date, openApp);
            // 课程列表（今天/明天）里的每一条：点条目任意位置也进 App
            PendingIntent openAppTemplate = ITDCWidgetActionReceiver.openAppTemplatePendingIntent(context);
            rv.setPendingIntentTemplate(R.id.widget_today_list, openAppTemplate);
            rv.setPendingIntentTemplate(R.id.widget_tomorrow_list, openAppTemplate);

            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            awm.updateAppWidget(appWidgetId, rv);
        } catch (Exception e) {
            Log.e(TAG, "renderSnapshot failed", e);
        }
    }

    /** 把某个 ListView 绑定到集合型数据源；data 里带 widgetId 保证每个实例独立刷新 */
    private static void bindList(Context context, RemoteViews rv, int viewId, int appWidgetId, String listType) {
        Intent intent = new Intent(context, ITDCWidgetListService.class);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        intent.putExtra(ITDCWidgetListService.EXTRA_LIST, listType);
        // 加 data 使 Intent 唯一，否则不同列表会共用同一个 adapter
        intent.setData(Uri.parse("itdc://widget/" + listType + "/" + appWidgetId));
        rv.setRemoteAdapter(viewId, intent);
        // 不用 setEmptyView：ItemFactory 在无数据时会返回一行空状态提示，
        // 且 setEmptyView 会把被引用的视图在空列表时隐藏（标题会消失）。
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent();
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // 标记来源：应用已在运行时由 MainActivity 收到 onNewIntent，
        // 让 WebView 回到主页，否则会停在用户上次离开的页面（例如设置页）。
        launch.putExtra(EXTRA_OPEN_HOME, true);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, 0, launch, flags);
    }

    private static void updateHint(Context context, int appWidgetId, String msg) {
        try {
            RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_today_error);
            applyAppearance(context, rv, appWidgetId);
            rv.setTextViewText(R.id.error_text, msg);
            if (!WidgetAppearance.useConfigColors(context)) {
                rv.setTextColor(R.id.error_text, WidgetAppearance.textPrimary(context));
            }
            rv.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context));
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            awm.updateAppWidget(appWidgetId, rv);
        } catch (Exception e) { Log.e(TAG, "updateHint failed", e); }
    }

    /**
     * 应用用户自定义外观。
     *
     * 背景走 ImageView + 位图：RemoteViews 不能承载运行时构造的 drawable，
     * 资源色也无法在运行时改，所以「圆角 + 底色/照片 + 透明度」一次性画成位图。
     * 根布局原生的圆角底色必须先置空，否则会在位图透明处透出第二层颜色。
     */
    private static void applyAppearance(Context context, RemoteViews rv, int appWidgetId) {
        try {
            // 先钉住这一轮的明暗，后面列表项取色会复用，不会拼出混合态
            WidgetAppearance.pinNight(context);
            // Android 12+：圆角和面板色交给根布局（保留 ShapeDrawable 的圆角），
            // 图片层用 centerCrop 等比填满，位图尺寸和桌面尺寸不一致也不会拉伸。
            if (Build.VERSION.SDK_INT >= 31) {
                boolean hasImage = WidgetAppearance.hasImage(context);
                boolean configColors = WidgetAppearance.useConfigColors(context);
                // 有图时根底色透明，让壁纸从图片透明度里透出来；无图时才是用户的面板色
                int rootTint = hasImage || configColors
                        ? 0x00000000
                        : WidgetAppearance.panelColorWithAlpha(context);
                rv.setColorStateList(
                        R.id.widget_root,
                        "setBackgroundTintList",
                        android.content.res.ColorStateList.valueOf(rootTint));
                if (hasImage) {
                    // 清掉上一轮可能留下的资源底（跟随系统切到自定义色时会残留）
                    rv.setInt(R.id.widget_bg_image, "setBackgroundResource", android.R.color.transparent);
                    rv.setFloat(R.id.widget_bg_image, "setAlpha", 1f);
                    // 优先让桌面自己读高清裁切图（FileProvider）：位图走 Binder
                    // 有 1MB 量级的事务上限，只能传缩略图，放大后就是糊的。
                    Uri crop = cropUri(context);
                    if (crop != null) {
                        grantCropPermission(context, crop);
                        rv.setImageViewUri(R.id.widget_bg_image, crop);
                        rv.setInt(R.id.widget_bg_image, "setImageAlpha", WidgetAppearance.imageAlpha(context));
                        rv.setViewVisibility(R.id.widget_bg_image, android.view.View.VISIBLE);
                    } else {
                        // 裁切图还没生成好（首次下发 / 被清理）：先退到位图直传，绝不留白
                        android.graphics.Bitmap photo = WidgetAppearance.croppedPhotoBitmap(context, appWidgetId);
                        if (photo != null) {
                            rv.setImageViewBitmap(R.id.widget_bg_image, photo);
                            rv.setInt(R.id.widget_bg_image, "setImageAlpha", WidgetAppearance.imageAlpha(context));
                            rv.setViewVisibility(R.id.widget_bg_image, android.view.View.VISIBLE);
                        } else {
                            rv.setViewVisibility(R.id.widget_bg_image, android.view.View.GONE);
                        }
                    }
                } else if (configColors) {
                    // 跟随系统且没有自定义面板色：底色交给 values / values-night，
                    // 桌面在切深/浅色时自己重新解析即可重绘，不用等 App 进程被唤醒；
                    // 用户设的「面板不透明度」用 View.setAlpha 叠在这层上。
                    rv.setInt(R.id.widget_bg_image, "setBackgroundResource", R.drawable.widget_panel_bg);
                    rv.setFloat(R.id.widget_bg_image, "setAlpha", WidgetAppearance.panelAlpha(context));
                    rv.setViewVisibility(R.id.widget_bg_image, android.view.View.VISIBLE);
                } else {
                    rv.setInt(R.id.widget_bg_image, "setBackgroundResource", android.R.color.transparent);
                    rv.setFloat(R.id.widget_bg_image, "setAlpha", 1f);
                    rv.setViewVisibility(R.id.widget_bg_image, android.view.View.GONE);
                }
                return;
            }
            // 旧系统回退：位图一次性画好圆角 + 底色/照片 + 透明度
            rv.setInt(R.id.widget_root, "setBackgroundColor", Color.TRANSPARENT);
            android.graphics.Bitmap bitmap = WidgetAppearance.backgroundBitmap(context, appWidgetId);
            if (bitmap != null) {
                rv.setImageViewBitmap(R.id.widget_bg_image, bitmap);
            } else {
                // 生成失败时退回纯色圆角底，至少不是全透明
                rv.setInt(R.id.widget_root, "setBackgroundColor",
                        WidgetAppearance.panelColorWithAlpha(context));
            }
        } catch (Exception e) {
            Log.e(TAG, "applyAppearance failed", e);
        }
    }

    /** 高清背景图的 content:// URI；还没生成裁切图时返回 null */
    private static Uri cropUri(Context context) {
        try {
            java.io.File file = WidgetAppearance.currentCropFile(context);
            if (file == null || !file.exists()) return null;
            return WidgetFileProvider.getUriForFile(
                    context, WidgetAppearance.fileProviderAuthority(context), file);
        } catch (Exception e) {
            Log.w(TAG, "cropUri failed", e);
            return null;
        }
    }

    /**
     * 桌面进程要读这个 URI，必须显式授权。
     *
     * 组件的宿主只有桌面（含第三方启动器）和锁屏 SystemUI，这里按 Home 应用枚举；
     * 每次刷新重授一次，进程被杀 / 重启后权限依旧在有效期内。
     */
    private static void grantCropPermission(Context context, Uri uri) {
        try {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            for (android.content.pm.ResolveInfo info : context.getPackageManager().queryIntentActivities(home, 0)) {
                Log.d(TAG, "grant crop uri to " + info.activityInfo.packageName);
                try {
                    context.grantUriPermission(info.activityInfo.packageName, uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) {
                    // 单个宿主授权失败不影响其它宿主
                }
            }
            context.grantUriPermission("com.android.systemui", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            Log.w(TAG, "grantCropPermission failed", e);
        }
    }

    /** 文字配色只作用于主布局：提示页没有这些控件 */
    private static void applyTextColors(Context context, RemoteViews rv) {
        // 跟随系统时不做运行时染色：布局里的 @color/widget_* 由桌面按当前配置解析，
        // 这样切主题时桌面自己就能重绘（运行时染色会把资源色覆盖掉，必须靠刷新）
        if (WidgetAppearance.useConfigColors(context)) return;
        rv.setTextColor(R.id.widget_board_title, WidgetAppearance.textPrimary(context));
        rv.setTextColor(R.id.widget_date, WidgetAppearance.textSecondary(context));
        rv.setTextColor(R.id.widget_today_label, WidgetAppearance.textSection(context));
        rv.setTextColor(R.id.widget_tomorrow_label, WidgetAppearance.textSection(context));
        rv.setTextColor(R.id.widget_todo_header, WidgetAppearance.textSection(context));
        // 分隔线跟着明暗走：深色面板配浅色细线才分得开
        rv.setInt(R.id.widget_divider_vertical, "setBackgroundColor", WidgetAppearance.divider(context));
        rv.setInt(R.id.widget_divider_horizontal, "setBackgroundColor", WidgetAppearance.divider(context));
    }

    private static String normalizeBaseUrl(String url) {
        if (url == null || url.isEmpty()) return url;
        String u = url.trim();
        while (u.endsWith("/api")) { u = u.substring(0, u.length() - 4); }
        return u;
    }

    /** 快照是否为今天生成：避免跨天后桌面仍显示昨天的安排 */
    private static boolean isSnapshotForToday(String snapshotJson) {
        try {
            JSONObject obj = new JSONObject(snapshotJson);
            String day = obj.optString("day", "");
            if (day.isEmpty()) return true;
            return currentDateKey().equals(day);
        } catch (Exception e) {
            Log.e(TAG, "isSnapshotForToday failed", e);
            return true;
        }
    }

    /**
     * 快照是否还能用于渲染：新结构看 days 是否覆盖今天（一次覆盖 7 天，
     * 跨天不用 App 重推）；旧结构退回 day == 今天 的判断。
     */
    private static boolean isSnapshotUsable(String snapshotJson) {
        try {
            JSONObject obj = new JSONObject(snapshotJson);
            if (obj.optJSONArray("days") != null) {
                return findDay(obj, currentDateKey()) != null;
            }
            return isSnapshotForToday(snapshotJson);
        } catch (Exception e) {
            Log.e(TAG, "isSnapshotUsable failed", e);
            return true;
        }
    }

    /** 新快照：从 days 数组里取指定日期（YYYY-MM-DD）那一天，找不到返回 null */
    static JSONObject findDay(JSONObject root, String dateKey) {
        JSONArray days = root.optJSONArray("days");
        if (days == null) return null;
        for (int i = 0; i < days.length(); i++) {
            JSONObject d = days.optJSONObject(i);
            if (d != null && dateKey.equals(d.optString("date", ""))) return d;
        }
        return null;
    }

    /** 当前本地日期 YYYY-MM-DD（供数据源按同一天选取条目） */
    static String currentDateKey() {
        return dateKey(Calendar.getInstance());
    }

    /** 明天的 YYYY-MM-DD */
    static String tomorrowDateKey() {
        Calendar c = Calendar.getInstance();
        c.add(Calendar.DAY_OF_YEAR, 1);
        return dateKey(c);
    }

    private static String dateKey(Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d",
                c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /** 某时刻的当天 00:00 */
    private static long dayStart(long millis) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(millis);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** 某时刻的 HH:mm */
    private static String hm(long millis) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(millis);
        return String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
    }

    /** HH:mm → 从 0 点起的毫秒数 */
    private static long hmToMillis(String hm) {
        return (Long.parseLong(hm.substring(0, 2)) * 60 + Long.parseLong(hm.substring(3, 5))) * 60_000L;
    }

    // ---------- 持久化 ----------

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String getServerUrl(Context context) {
        return prefs(context).getString("server_url", null);
    }

    public static void setServerUrl(Context context, String url) {
        prefs(context).edit().putString("server_url", url).apply();
    }

    public static String getMode(Context context) {
        String stored = prefs(context).getString("mode", null);
        if (stored != null) return stored;
        // 没有 mode 字段时按本机模式处理：不能用"存过服务器地址"推断，
        // 旧版本遗留的局域网地址会让小组件在 App 推送快照前就去连一个失效地址。
        return MODE_LOCAL;
    }

    public static void setMode(Context context, String mode) {
        prefs(context).edit().putString("mode", mode).apply();
    }

    public static String getLocalSnapshot(Context context) {
        return prefs(context).getString("local_snapshot", null);
    }

    public static void setLocalSnapshot(Context context, String json) {
        prefs(context).edit()
                .putString("local_snapshot", json)
                .putLong("local_snapshot_ts", System.currentTimeMillis())
                .apply();
    }

    /**
     * App 调用：数据变更后立即重绘所有小组件实例。
     *
     * 这里必须直接调用刷新，不能用 sendBroadcast 通知自己：
     * 该 receiver 声明了 android:permission="BIND_APPWIDGET"，
     * 广播会要求发送方持有该权限，而 App 自身并不持有 —— 广播会被系统静默丢弃。
     */
    public static void requestRefresh(Context context) {
        try {
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            ComponentName comp = new ComponentName(context, ITDCWidgetProvider.class.getName());
            int[] ids = awm.getAppWidgetIds(comp);
            for (int id : ids) {
                // 先通知数据源失效，再重绘，否则列表仍显示旧内容
                awm.notifyAppWidgetViewDataChanged(id, R.id.widget_today_list);
                awm.notifyAppWidgetViewDataChanged(id, R.id.widget_tomorrow_list);
                awm.notifyAppWidgetViewDataChanged(id, R.id.widget_todo_list);
                refreshWidget(context, id);
            }
        } catch (Exception e) { Log.e(TAG, "requestRefresh failed", e); }
    }

    private static String fetchJson(String url) {
        try {
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            int code = conn.getResponseCode();
            if (code == 200) {
                java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                try (java.io.InputStream stream = conn.getInputStream()) {
                    byte[] b = new byte[4096]; int n;
                    while ((n = stream.read(b)) >= 0) baos.write(b, 0, n);
                }
                return new String(baos.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
            }
        } catch (Exception e) { Log.e(TAG, "fetchJson failed", e); }
        return null;
    }
}
