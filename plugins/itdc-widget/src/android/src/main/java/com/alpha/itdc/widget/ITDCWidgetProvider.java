package com.alpha.itdc.widget;

import android.app.AlarmManager;
import android.appwidget.AppWidgetProvider;
import android.app.AppWidgetManager;
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
import android.widget.RemoteViews;

public class ITDCWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "ITDCWidget";
    private static final long REFRESH_INTERVAL_MS = 15 * 60 * 1000L;

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

    private void refreshAll(Context context) {
        try {
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APP_WIDGET_SERVICE);
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
        if (serverUrl == null || serverUrl.isEmpty()) { updateMissingServer(context, appWidgetId); return; }
        new Thread(() -> {
            String baseUrl = normalizeBaseUrl(serverUrl);
            String json = fetchJson(baseUrl + "/api/widget/today");
            if (json == null) { updateError(context, appWidgetId, "离线\n无法连接服务器"); return; }
            Bitmap bmp = WidgetBitmapRenderer.render(context, json);
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APP_WIDGET_SERVICE);
                    RemoteViews rv = new RemoteViews(context, R.layout.widget_today);
                    rv.setImageViewBitmap(R.id.widget_image, bmp);
                    awm.updateAppWidget(appWidgetId, rv);
                } catch (Exception e) { Log.e(TAG, "updateAppWidget failed", e); }
            });
        }).start();
    }

    private void updateMissingServer(Context context, int appWidgetId) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APP_WIDGET_SERVICE);
                RemoteViews rv = new RemoteViews(context, R.layout.widget_today_error);
                rv.setTextViewText(R.id.error_text, "未配置服务器\n请在 ITDC 设置中填写");
                awm.updateAppWidget(appWidgetId, rv);
            } catch (Exception e) { Log.e(TAG, "updateMissingServer failed", e); }
        });
    }

    private void updateError(Context context, int appWidgetId, String msg) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APP_WIDGET_SERVICE);
                RemoteViews rv = new RemoteViews(context, R.layout.widget_today_error);
                rv.setTextViewText(R.id.error_text, msg);
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
