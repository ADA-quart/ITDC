package com.alpha.itdc.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 时间/日期变化时触发重绘。
 * 单独成类而不并入 ITDCWidgetProvider：后者带 BIND_APPWIDGET 权限，
 * 与系统时间广播的发送方权限耦合，可能导致广播收不到。
 */
public class ITDCWidgetTimeChangeReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || Intent.ACTION_DATE_CHANGED.equals(action)) {
            ITDCWidgetProvider.requestRefresh(context);
        }
    }
}