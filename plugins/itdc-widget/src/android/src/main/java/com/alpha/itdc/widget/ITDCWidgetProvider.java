package com.alpha.itdc.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;

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
    private static final long REFRESH_INTERVAL_MS = 30 * 60 * 1000L;
    private static final String PREFS = "widget_prefs";

    public static final String MODE_LOCAL = "local";
    public static final String MODE_SERVER = "server";

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent.getData() != null) {
            String widgetIdStr = intent.getData().toString()
                    .substring(intent.getData().toString().lastIndexOf('/') + 1);
            try { refreshWidget(context, Integer.parseInt(widgetIdStr)); }
            catch (NumberFormatException e) { Log.e(TAG, "bad widget id", e); }
        } else if ("com.alpha.itdc.WIDGET_REFRESH".equals(intent.getAction())) {
            refreshAll(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
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
            it.setAction("com.alpha.itdc.WIDGET_REFRESH");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(context, 0, it, flags);
            am.cancel(pi);
        } catch (Exception e) { Log.e(TAG, "onDisabled failed", e); }
    }

    private static void refreshAll(Context context) {
        try {
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            ComponentName comp = new ComponentName(context, ITDCWidgetProvider.class.getName());
            for (int id : awm.getAppWidgetIds(comp)) refreshWidget(context, id);
        } catch (Exception e) { Log.e(TAG, "refreshAll failed", e); }
    }

    private void scheduleRefresh(Context context) {
        try {
            // Android 15+ 起 setInexactRepeating 周期受限、Doze 下会被跳过，
            // 澎湃 OS 还会冻结后台进程。因此定时仅作兜底，
            // 主要刷新时机是：App 推送快照、系统 updatePeriodMillis、App 回前台。
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            Intent it = new Intent(context, ITDCWidgetProvider.class);
            it.setAction("com.alpha.itdc.WIDGET_REFRESH");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(context, 0, it, flags);
            long trigger = System.currentTimeMillis() + REFRESH_INTERVAL_MS;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, trigger, pi);
            }
        } catch (Exception e) { Log.e(TAG, "scheduleRefresh failed", e); }
    }

    /** 刷新入口：本机模式用快照，同步模式拉服务器（失败回退快照） */
    private static void refreshWidget(Context context, int appWidgetId) {
        String snapshot = getLocalSnapshot(context);

        if (MODE_LOCAL.equals(getMode(context))) {
            if (TextUtils.isEmpty(snapshot)) {
                updateHint(context, appWidgetId, context.getString(R.string.widget_local_no_data));
                return;
            }
            if (!isSnapshotForToday(snapshot)) {
                updateHint(context, appWidgetId, context.getString(R.string.widget_local_stale));
                return;
            }
            renderSnapshot(context, appWidgetId, snapshot);
            return;
        }

        // 同步模式：先用快照立即出图，避免等待网络期间桌面空白
        if (!TextUtils.isEmpty(snapshot) && isSnapshotForToday(snapshot)) {
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

            String boardTitle = "";
            String dateText = "";
            JSONObject root = null;
            try {
                root = new JSONObject(json);
                boardTitle = root.optString("boardTitle", "");
                String todayLabel = root.optString("todayLabel", "");
                String tomorrowLabel = root.optString("tomorrowLabel", "");
                String week = root.optString("weekLabel", "");

                StringBuilder sb = new StringBuilder();
                if (!TextUtils.isEmpty(todayLabel)) sb.append(todayLabel);
                if (!TextUtils.isEmpty(week)) {
                    if (sb.length() > 0) sb.append("  ");
                    sb.append(context.getString(R.string.widget_week_prefix)).append(week)
                      .append(context.getString(R.string.widget_week_suffix));
                }
                dateText = sb.toString();

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

            // 三个列表都通过 RemoteViewsService 提供数据 → 均可上下滑动
            bindList(context, rv, R.id.widget_today_list, appWidgetId, ITDCWidgetListService.LIST_TODAY);
            bindList(context, rv, R.id.widget_tomorrow_list, appWidgetId, ITDCWidgetListService.LIST_TOMORROW);
            bindList(context, rv, R.id.widget_todo_list, appWidgetId, ITDCWidgetListService.LIST_TODO);

            rv.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context));

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
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, 0, launch, flags);
    }

    private static void updateHint(Context context, int appWidgetId, String msg) {
        try {
            RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_today_error);
            rv.setTextViewText(R.id.error_text, msg);
            rv.setOnClickPendingIntent(R.id.widget_container_error, openAppIntent(context));
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            awm.updateAppWidget(appWidgetId, rv);
        } catch (Exception e) { Log.e(TAG, "updateHint failed", e); }
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
            Calendar c = Calendar.getInstance();
            String today = String.format(Locale.US, "%04d-%02d-%02d",
                    c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
            return today.equals(day);
        } catch (Exception e) {
            Log.e(TAG, "isSnapshotForToday failed", e);
            return true;
        }
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