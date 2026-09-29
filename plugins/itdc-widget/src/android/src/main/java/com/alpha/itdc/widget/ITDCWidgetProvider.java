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
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.app.PendingIntent;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.widget.RemoteViews;

public class ITDCWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "ITDCWidget";
    private static final long REFRESH_INTERVAL_MS = 30 * 60 * 1000L;
    /** App 处于"仅本机"模式时写入的标记：数据在 App 内，桌面小组件无法直接读取 */
    private static final String LOCAL_MODE = "__local__";

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
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            Intent it = new Intent(context, ITDCWidgetProvider.class);
            it.setAction("com.alpha.itdc.WIDGET_REFRESH");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(context, 0, it, flags);
            am.setInexactRepeating(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + REFRESH_INTERVAL_MS, REFRESH_INTERVAL_MS, pi);
        } catch (Exception e) { Log.e(TAG, "scheduleRefresh failed", e); }
    }

    private void refreshWidget(Context context, int appWidgetId) {
        String serverUrl = getServerUrl(context);
        // 仅本机模式：给出准确提示而不是"未配置服务器"，避免误导
        if (LOCAL_MODE.equals(serverUrl)) { updateLocalMode(context, appWidgetId); return; }
        if (serverUrl == null || serverUrl.isEmpty()) { updateMissingServer(context, appWidgetId); return; }
        int[] size = widgetSize(context, appWidgetId);
        new Thread(() -> {
            String baseUrl = normalizeBaseUrl(serverUrl);
            String json = fetchJson(baseUrl + "/api/widget/today");
            if (json == null) {
                updateError(context, appWidgetId, context.getString(R.string.widget_offline));
                return;
            }
            Bitmap bmp = WidgetBitmapRenderer.render(context, json, size[0], size[1]);
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
                    RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_today);
                    rv.setImageViewBitmap(R.id.widget_image, bmp);
                    rv.setOnClickPendingIntent(R.id.widget_container, openAppIntent(context));
                    awm.updateAppWidget(appWidgetId, rv);
                } catch (Exception e) { Log.e(TAG, "updateAppWidget failed", e); }
            });
        }).start();
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

    private void updateMissingServer(Context context, int appWidgetId) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
                RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_today_error);
                rv.setTextViewText(R.id.error_text, context.getString(R.string.widget_missing_server));
                rv.setOnClickPendingIntent(R.id.widget_container_error, openAppIntent(context));
                awm.updateAppWidget(appWidgetId, rv);
            } catch (Exception e) { Log.e(TAG, "updateMissingServer failed", e); }
        });
    }

    private void updateLocalMode(Context context, int appWidgetId) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
                RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_today_error);
                rv.setTextViewText(R.id.error_text, context.getString(R.string.widget_local_mode));
                rv.setOnClickPendingIntent(R.id.widget_container_error, openAppIntent(context));
                awm.updateAppWidget(appWidgetId, rv);
            } catch (Exception e) { Log.e(TAG, "updateLocalMode failed", e); }
        });
    }

    private void updateError(Context context, int appWidgetId, String msg) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
                RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_today_error);
                rv.setTextViewText(R.id.error_text, msg);
                rv.setOnClickPendingIntent(R.id.widget_container_error, openAppIntent(context));
                awm.updateAppWidget(appWidgetId, rv);
            } catch (Exception e) { Log.e(TAG, "updateError failed", e); }
        });
    }

    private static String normalizeBaseUrl(String url)
    {
        if (url == null || url.isEmpty()) return url;
        String u = url.trim();
        while (u.endsWith("/api")) { u = u.substring(0, u.length() - 4); }
        return u;
    }
    private String getServerUrl(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("widget_prefs", Context.MODE_PRIVATE);
        return prefs.getString("server_url", null);
    }

    public static void setServerUrl(Context context, String url) {
        context.getSharedPreferences("widget_prefs", Context.MODE_PRIVATE).edit().putString("server_url", url).apply();
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

