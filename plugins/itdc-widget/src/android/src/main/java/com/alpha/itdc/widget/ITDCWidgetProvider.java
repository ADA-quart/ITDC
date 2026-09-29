package com.alpha.itdc.widget;

import android.app.AlarmManager;
import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.app.PendingIntent;
import android.widget.RemoteViews;

public class ITDCWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "ITDCWidget";
    private static final long REFRESH_INTERVAL_MS = 30 * 60 * 1000L;
    private static final String PREFS = "widget_prefs";
    /** 数据来源模式：local = 数据在 App 内（由 App 推送快照）；server = 从服务器拉取 */
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

    // 用户拖动改尺寸后立即按新尺寸重绘，避免位图被拉伸变形
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager, int appWidgetId, Bundle newOptions) {
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

    private void refreshAll(Context context) {
        try {
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            ComponentName comp = new ComponentName(context, ITDCWidgetProvider.class.getName());
            for (int id : awm.getAppWidgetIds(comp)) refreshWidget(context, id);
        } catch (Exception e) { Log.e(TAG, "refreshAll failed", e); }
    }

    private void scheduleRefresh(Context context) {
        try {
            // Android 15+ 起 setInexactRepeating 的最短周期被抬到 1 小时以上，
            // Android 16 更是在 Doze 下直接跳过；同时澎湃 OS 会冻结后台进程。
            // 因此这里只作为兜底，主刷新时机改为：
            //   1) App 推送快照时主动触发（数据变更即时可见）
            //   2) appwidget-provider 的 updatePeriodMillis（系统托管，不受进程冻结影响）
            //   3) App 回到前台时补推
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            Intent it = new Intent(context, ITDCWidgetProvider.class);
            it.setAction("com.alpha.itdc.WIDGET_REFRESH");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(context, 0, it, flags);
            // 用 setAndAllowWhileIdle：Doze 下仍能触发，适合"每小时校准一次"的兜底刷新
            long trigger = System.currentTimeMillis() + REFRESH_INTERVAL_MS;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, trigger, pi);
            }
        } catch (Exception e) { Log.e(TAG, "scheduleRefresh failed", e); }
    }

    /**
     * 刷新入口：
     * - 仅本机模式：直接用 App 推送的快照渲染（无网络请求）
     * - 同步模式：从服务器拉取今日数据
     */
    private void refreshWidget(Context context, int appWidgetId) {
        String mode = getMode(context);
        final String snapshot = getLocalSnapshot(context);

        if (MODE_LOCAL.equals(mode)) {
            if (snapshot == null || snapshot.isEmpty()) {
                updateHint(context, appWidgetId, context.getString(R.string.widget_local_no_data));
                return;
            }
            // 跨天保护：快照不是今天的就提示打开 App 刷新，避免展示昨天的安排
            if (!isSnapshotForToday(snapshot)) {
                updateHint(context, appWidgetId, context.getString(R.string.widget_local_stale));
                return;
            }
            renderJson(context, appWidgetId, snapshot);
            return;
        }

        // 同步模式：先用本机快照立即出图，避免等待网络期间桌面空白
        if (snapshot != null && !snapshot.isEmpty() && isSnapshotForToday(snapshot)) {
            renderJson(context, appWidgetId, snapshot);
        }

        String serverUrl = getServerUrl(context);
        if (serverUrl == null || serverUrl.isEmpty()) {
            // 未显式配置：若已有本机快照则优先展示，避免空窗
            if (snapshot != null && !snapshot.isEmpty()) { renderJson(context, appWidgetId, snapshot); return; }
            updateHint(context, appWidgetId, context.getString(R.string.widget_missing_server));
            return;
        }

        final int[] size = widgetSize(context, appWidgetId);
        new Thread(() -> {
            String baseUrl = normalizeBaseUrl(serverUrl);
            String json = fetchJson(baseUrl + "/api/widget/today");
            if (json == null) {
                // 服务器不可达：回退到本机快照，而不是只显示错误
                if (snapshot != null && !snapshot.isEmpty()) { renderJson(context, appWidgetId, snapshot); return; }
                updateHint(context, appWidgetId, context.getString(R.string.widget_offline));
                return;
            }
            Bitmap bmp = WidgetBitmapRenderer.render(context, json, size[0], size[1]);
            postBitmap(context, appWidgetId, bmp);
        }).start();
    }

    /** 用给定 JSON 渲染并更新小组件（本机快照与服务器数据共用同一条渲染路径） */
    private void renderJson(Context context, int appWidgetId, String json) {
        final int[] size = widgetSize(context, appWidgetId);
        Bitmap bmp = WidgetBitmapRenderer.render(context, json, size[0], size[1]);
        postBitmap(context, appWidgetId, bmp);
    }

    private void postBitmap(Context context, int appWidgetId, Bitmap bmp) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
                RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_today);
                rv.setImageViewBitmap(R.id.widget_image, bmp);
                rv.setOnClickPendingIntent(R.id.widget_container, openAppIntent(context));
                awm.updateAppWidget(appWidgetId, rv);
            } catch (Exception e) { Log.e(TAG, "postBitmap failed", e); }
        });
    }

    // 点按小组件任意位置打开 App 主界面
    private PendingIntent openAppIntent(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent();
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, 0, launch, flags);
    }

    // 读取小组件当前占用的实际像素尺寸（用户改尺寸后按真实大小重绘）
    private int[] widgetSize(Context context, int appWidgetId) {
        int w = 640, h = 360;
        try {
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            Bundle opts = awm.getAppWidgetOptions(appWidgetId);
            int minW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int maxW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
            int minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
            int maxH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            int cellW = maxW > 0 ? maxW : minW;
            int cellH = minH > 0 ? minH : maxH;
            DisplayMetrics dm = context.getResources().getDisplayMetrics();
            float scale = dm.density;
            if (cellW > 0) w = Math.round(cellW * scale);
            if (cellH > 0) h = Math.round(cellH * scale);
        } catch (Exception e) { Log.e(TAG, "widgetSize failed", e); }
        return new int[]{ Math.max(320, Math.min(w, 1600)), Math.max(180, Math.min(h, 1600)) };
    }

    private void updateHint(Context context, int appWidgetId, String msg) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
                RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_today_error);
                rv.setTextViewText(R.id.error_text, msg);
                rv.setOnClickPendingIntent(R.id.widget_container_error, openAppIntent(context));
                awm.updateAppWidget(appWidgetId, rv);
            } catch (Exception e) { Log.e(TAG, "updateHint failed", e); }
        });
    }

    private static String normalizeBaseUrl(String url) {
        if (url == null || url.isEmpty()) return url;
        String u = url.trim();
        while (u.endsWith("/api")) { u = u.substring(0, u.length() - 4); }
        return u;
    }

    /** 快照是否为今天生成：避免跨天后桌面仍显示昨天的日程 */
    private boolean isSnapshotForToday(String snapshotJson) {
        try {
            org.json.JSONObject obj = new org.json.JSONObject(snapshotJson);
            String day = obj.optString("day", "");
            if (day.isEmpty()) return true; // 老快照没有日期字段，按可用处理
            java.util.Calendar c = java.util.Calendar.getInstance();
            String today = String.format(java.util.Locale.US, "%04d-%02d-%02d",
                    c.get(java.util.Calendar.YEAR),
                    c.get(java.util.Calendar.MONTH) + 1,
                    c.get(java.util.Calendar.DAY_OF_MONTH));
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
        // 没有 mode 字段时一律按本机模式。
        // 不能用"存过服务器地址"来推断：旧版本留下的局域网地址会一直生效，
        // 导致小组件在 App 推送快照之前就先去连一个早已失效的地址。
        // 只有 App 明确写入 MODE_SERVER 才走同步路径。
        return MODE_LOCAL;
    }

    public static void setMode(Context context, String mode) {
        prefs(context).edit().putString("mode", mode).apply();
    }

    public static String getLocalSnapshot(Context context) {
        return prefs(context).getString("local_snapshot", null);
    }

    public static void setLocalSnapshot(Context context, String json) {
        long ts = System.currentTimeMillis();
        prefs(context).edit()
                .putString("local_snapshot", json)
                .putLong("local_snapshot_ts", ts)
                .apply();
    }

    /** App 调用：数据变更后立即重绘所有小组件实例 */
    public static void requestRefresh(Context context) {
        try {
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            ComponentName comp = new ComponentName(context, ITDCWidgetProvider.class.getName());
            int[] ids = awm.getAppWidgetIds(comp);
            if (ids.length == 0) return;
            Intent it = new Intent(context, ITDCWidgetProvider.class);
            it.setAction("com.alpha.itdc.WIDGET_REFRESH");
            context.sendBroadcast(it);
        } catch (Exception e) { Log.e(TAG, "requestRefresh failed", e); }
    }

    private String fetchJson(String url) {
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
