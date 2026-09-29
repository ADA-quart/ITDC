package io.github.adaquart.itdc.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 小组件里的交互入口：点按待办复选框、点按"全部完成"。
 */
public class ITDCWidgetActionReceiver extends BroadcastReceiver {

    private static final String TAG = "ITDCWidgetAction";

    public static final String ACTION_TOGGLE_DONE = "io.github.adaquart.itdc.WIDGET_TOGGLE_DONE";
    public static final String ACTION_ALL_DONE = "io.github.adaquart.itdc.WIDGET_ALL_DONE";
    public static final String EXTRA_TODO_ID = "todo_id";
    public static final String EXTRA_TARGET_DONE = "target_done";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();

        try {
            if (ACTION_TOGGLE_DONE.equals(action)) {
                int todoId = intent.getIntExtra(EXTRA_TODO_ID, -1);
                boolean targetDone = intent.getBooleanExtra(EXTRA_TARGET_DONE, true);
                if (todoId < 0) return;
                WidgetDoneStore.toggle(context, todoId, targetDone);
                notifyTodoList(context);
            } else if (ACTION_ALL_DONE.equals(action)) {
                List<Integer> ids = readVisibleTodoIds(context);
                if (ids.isEmpty()) return;
                WidgetDoneStore.markAllDone(context, ids);
                notifyTodoList(context);
            }
        } catch (Exception e) {
            Log.e(TAG, "onReceive failed", e);
        }
    }

    /** 从快照里读出当前展示的待办 id，供"全部完成"使用 */
    private static List<Integer> readVisibleTodoIds(Context context) {
        List<Integer> ids = new ArrayList<>();
        try {
            String snapshot = ITDCWidgetProvider.getLocalSnapshot(context);
            if (snapshot == null || snapshot.isEmpty()) return ids;
            JSONArray arr = new JSONObject(snapshot).optJSONArray("todos");
            if (arr == null) return ids;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null) {
                    int id = o.optInt("id", -1);
                    if (id >= 0) ids.add(id);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "readVisibleTodoIds failed", e);
        }
        return ids;
    }

    /** 让所有小组件实例的待办列表重新读取数据 */
    private static void notifyTodoList(Context context) {
        try {
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            ComponentName comp = new ComponentName(context, ITDCWidgetProvider.class.getName());
            for (int id : awm.getAppWidgetIds(comp)) {
                awm.notifyAppWidgetViewDataChanged(id, R.id.widget_todo_list);
            }
        } catch (Exception e) {
            Log.e(TAG, "notifyTodoList failed", e);
        }
    }

    /**
     * 待办列表的 PendingIntent 模板。
     *
     * 集合型小组件里**不能**用 setOnClickPendingIntent 绑子项（系统会忽略），
     * 必须用 setPendingIntentTemplate + 子项的 setOnClickFillInIntent，
     * 点击时系统把 fill-in 的 extras 合并进这个模板 Intent。
     *
     * 注意必须是 FLAG_MUTABLE：FLAG_IMMUTABLE 会阻止 fill-in extras 合并，
     * 导致接收到的 todo_id 永远丢失。
     */
    static PendingIntent todoTemplatePendingIntent(Context context) {
        Intent it = new Intent(context, ITDCWidgetActionReceiver.class);
        it.setAction(ACTION_TOGGLE_DONE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        return PendingIntent.getBroadcast(context, 999002, it, flags);
    }

    /** 构造"全部完成"的 PendingIntent（该按钮不在集合里，可直接绑定） */
    static PendingIntent allDonePendingIntent(Context context) {
        Intent it = new Intent(context, ITDCWidgetActionReceiver.class);
        it.setAction(ACTION_ALL_DONE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, 999001, it, flags);
    }

    /** 给待办条目里某个子视图绑定"点击填充"意图 */
    static void bindFillIn(android.widget.RemoteViews rv, int viewId, int todoId, boolean currentlyDone) {
        Intent fillIn = new Intent();
        fillIn.putExtra(EXTRA_TODO_ID, todoId);
        fillIn.putExtra(EXTRA_TARGET_DONE, !currentlyDone);
        rv.setOnClickFillInIntent(viewId, fillIn);
    }
}