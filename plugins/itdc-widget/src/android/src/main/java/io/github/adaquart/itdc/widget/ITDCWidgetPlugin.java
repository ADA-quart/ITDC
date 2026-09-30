package io.github.adaquart.itdc.widget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "itdc-widget")
public class ITDCWidgetPlugin extends Plugin {

    @PluginMethod
    public void setServerUrl(PluginCall call) {
        String url = call.getString("url");
        if (url != null && !url.trim().isEmpty()) {
            ITDCWidgetProvider.setServerUrl(getContext(), url);
        }
        call.resolve();
    }

    /**
     * 接收 App 推送的今日数据快照。
     * 仅本机模式下数据存在 WebView 的 IndexedDB 里，桌面小组件进程无法读取，
     * 因此由 App 主动把渲染所需的最小数据集（今日已排期 + 待办 Top5）交给原生侧。
     */
    @PluginMethod
    public void pushSnapshot(PluginCall call) {
        String json = call.getString("json");
        if (json == null || json.trim().isEmpty()) {
            call.reject("json is required");
            return;
        }
        try {
            // 先校验是合法 JSON，避免把损坏数据写进桌面展示
            new JSONObject(json);
        } catch (Exception e) {
            call.reject("invalid json: " + e.getMessage());
            return;
        }
        ITDCWidgetProvider.setLocalSnapshot(getContext(), json);
        String mode = call.getString("mode");
        if (mode != null && !mode.trim().isEmpty()) {
            ITDCWidgetProvider.setMode(getContext(), mode);
        }
        ITDCWidgetProvider.requestRefresh(getContext());
        call.resolve();
    }

    /**
     * App 下发外观：主题色、面板底色与透明度、明暗、背景图。
     * image 只在换图时随请求带过来（base64），其余情况沿用原生侧已存的图。
     */
    @PluginMethod
    public void setAppearance(PluginCall call) {
        try {
            String image = call.getString("image");
            WidgetAppearance.apply(
                    getContext(),
                    call.getString("accent"),
                    call.getString("panelColor"),
                    call.getInt("panelOpacity", 90),
                    call.getString("scheme"),
                    Boolean.TRUE.equals(call.getBoolean("hasImage", false)),
                    image);
        } catch (Exception e) {
            call.reject("apply appearance failed: " + e.getMessage());
            return;
        }
        ITDCWidgetProvider.requestRefresh(getContext());
        call.resolve();
    }

    /**
     * App 侧读取桌面上"打勾完成"的操作队列。
     * App 拿到后写回本地数据库，成功则调用 clearDoneQueue 清空。
     */
    @PluginMethod
    public void getDoneQueue(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(WidgetDoneStore.readQueue(getContext())));
        } catch (Exception e) {
            call.reject("read queue failed: " + e.getMessage());
        }
    }

    /** App 写回成功后清空队列 */
    @PluginMethod
    public void clearDoneQueue(PluginCall call) {
        try {
            WidgetDoneStore.clear(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("clear queue failed: " + e.getMessage());
        }
    }

    /** 查询本应用是否已被系统排除在电池优化之外（澎湃 OS / MIUI 会冻结后台导致小组件不刷新） */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        boolean ignoring = false;
        try {
            Context ctx = getContext();
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                ignoring = pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
            }
        } catch (Exception e) {
            call.reject("query failed: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
        call.resolve(ret);
    }

    /** 打开电池优化设置页，便于用户把本应用设为不受限 */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(intent);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + ctx.getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
            } catch (Exception e2) {
                call.reject("cannot open settings: " + e2.getMessage());
                return;
            }
        }
        call.resolve();
    }
}
