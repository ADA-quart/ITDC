package com.alpha.itdc.widget;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
}
