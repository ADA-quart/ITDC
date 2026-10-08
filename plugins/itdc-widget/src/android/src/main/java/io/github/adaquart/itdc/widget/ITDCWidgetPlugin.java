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
     * 用系统浏览器打开外部链接（发布页 / 项目主页）。
     *
     * 放在这个插件里是因为它已经是 App 唯一的原生插件；WebView 里 window.open
     * 在这个壳里不会落到系统浏览器，只有原生 startActivity 才靠得住。
     */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url required");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("open url failed: " + e.getMessage());
        }
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
                    call.getInt("focusX", 50),
                    call.getInt("focusY", 50),
                    call.getFloat("zoom", 1f),
                    image);
        } catch (Exception e) {
            call.reject("apply appearance failed: " + e.getMessage());
            return;
        }
        // 桌面要的高清裁切图要解码 + 编码，放后台线程做，避免拖滑杆时卡住主线程；
        // 生成完再刷新小组件，否则桌面会读到上一张（或还没有）图。
        final android.content.Context context = getContext();
        new Thread(() -> {
            try {
                WidgetAppearance.ensureCrop(context);
            } catch (Exception e) {
                android.util.Log.w("ITDCWidgetPlugin", "ensureCrop failed", e);
            }
            ITDCWidgetProvider.requestRefresh(context);
        }, "itdc-widget-crop").start();
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

    // ---------- 本机密钥保险箱 ----------
    // 本机模式要用大模型 API Key：WebView 存储是明文的，改由 Android Keystore 加密保管。
    // 放在这个插件里是因为它已经是 App 的原生桥（系统设置、小组件），
    // 再单开一个 Capacitor 插件模块只为三个方法不划算。

    @PluginMethod
    public void secureSet(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("key is required");
            return;
        }
        try {
            SecureStore.put(getContext(), key.trim(), call.getString("value"));
        } catch (Exception e) {
            call.reject("secureSet failed: " + e.getMessage());
            return;
        }
        call.resolve();
    }

    /** 读不到（没存过或密钥库被重置）返回 value = null，由前端决定让用户重填 */
    @PluginMethod
    public void secureGet(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("key is required");
            return;
        }
        JSObject ret = new JSObject();
        String value = SecureStore.get(getContext(), key.trim());
        if (value != null) ret.put("value", value);
        call.resolve(ret);
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("key is required");
            return;
        }
        SecureStore.remove(getContext(), key.trim());
        call.resolve();
    }
}
