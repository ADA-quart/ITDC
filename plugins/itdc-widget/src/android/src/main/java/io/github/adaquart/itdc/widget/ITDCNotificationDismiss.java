// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

package io.github.adaquart.itdc.widget;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * 上课提醒的「N 分钟后自动消失」。
 *
 * @capacitor/local-notifications 没有超时自动消失的能力（不存在 timeoutAfter），
 * 所以由这里给每条已排程的提醒再挂一个「到点把通知取消掉」的闹钟：
 * 通知本体仍由通知插件发出，这里只负责在设定时刻把通知栏里的那条清掉。
 *
 * 用 setAndAllowWhileIdle：不需要精确闹钟权限，省电模式下也允许投递
 * （可能推迟几分钟，对「自动消失」这个场景足够）。同一个通知 id 重复排程时
 * PendingIntent 会原地替换，不会越堆越多。
 */
public final class ITDCNotificationDismiss extends BroadcastReceiver {

    private static final String EXTRA_ID = "notification_id";
    /** requestCode 偏移：和小组件自己的刷新闹钟（requestCode 0）错开 */
    private static final int REQUEST_BASE = 500_000;

    public static void schedule(Context context, int notificationId, long atMillis) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent it = new Intent(context, ITDCNotificationDismiss.class);
            it.putExtra(EXTRA_ID, notificationId);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(
                    context, REQUEST_BASE + notificationId, it, flags);
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pi);
        } catch (Exception e) {
            android.util.Log.w("ITDCWidget", "schedule notification dismiss failed", e);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            int id = intent.getIntExtra(EXTRA_ID, -1);
            if (id < 0) return;
            NotificationManager nm =
                    (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(id);
        } catch (Exception e) {
            android.util.Log.w("ITDCWidget", "dismiss notification failed", e);
        }
    }
}
