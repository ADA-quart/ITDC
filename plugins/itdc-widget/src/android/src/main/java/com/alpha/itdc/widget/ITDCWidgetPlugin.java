package com.alpha.itdc.widget;

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
}