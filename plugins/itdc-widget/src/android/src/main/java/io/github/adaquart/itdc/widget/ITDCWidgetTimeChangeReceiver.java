package io.github.adaquart.itdc.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 时间/日期变化、以及解锁（USER_PRESENT）时触发重绘。
 *
 * 解锁刷新是「看的时候要新」的主保障：Doze 期间不投递的边界闹钟会等到
 * 亮屏解锁时补发；这条广播让刷新更确定，拿起来看时就是新数据。
 *
 * 单独成类而不并入 ITDCWidgetProvider：后者带 BIND_APPWIDGET 权限，
 * 与系统广播的发送方权限耦合，可能导致广播收不到。
 */
public class ITDCWidgetTimeChangeReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || Intent.ACTION_DATE_CHANGED.equals(action)
                || Intent.ACTION_USER_PRESENT.equals(action)) {
            ITDCWidgetProvider.requestRefresh(context);
        }
    }
}
