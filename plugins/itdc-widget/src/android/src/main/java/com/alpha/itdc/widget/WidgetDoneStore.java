package com.alpha.itdc.widget;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 桌面端"完成待办"的本地状态与回传队列。
 *
 * 为什么需要它：小组件运行在独立进程，读不到 WebView 里的 IndexedDB，
 * 无法直接改数据库。因此采用「先本地生效、再回传合并」：
 *   1. 点按复选框 → 立即记入 pendingDone / pendingUndone（桌面马上显示划线效果）
 *   2. 点按"完成全部" → 批量记入
 *   3. App 下次启动或回到前台时读取队列，写回本地待办并清空
 *
 * 用双集合而非单集合：需要能撤销（点错了再点一次取消完成）。
 */
final class WidgetDoneStore {

    private static final String TAG = "ITDCWidgetDone";
    private static final String PREFS = "widget_done";
    private static final String KEY_DONE = "pending_done";
    private static final String KEY_UNDONE = "pending_undone";

    private WidgetDoneStore() { }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 桌面端已标记完成的待办 id（含尚未回传的） */
    static List<Integer> getDoneIds(Context context) {
        return readIds(prefs(context).getString(KEY_DONE, null));
    }

    /** 桌面端已撤销完成的待办 id（含尚未回传的） */
    static List<Integer> getUndoneIds(Context context) {
        return readIds(prefs(context).getString(KEY_UNDONE, null));
    }

    /**
     * 当前应当显示为"已完成"的集合。
     * 基准来自快照（App 推来的真实状态），再叠加桌面上的本地改动。
     */
    static boolean isDone(Context context, int todoId, List<Integer> doneFromSnapshot) {
        if (getUndoneIds(context).contains(todoId)) return false;
        if (doneFromSnapshot != null && doneFromSnapshot.contains(todoId)) return true;
        return getDoneIds(context).contains(todoId);
    }

    /** 记录一次完成/取消完成；两个集合互斥，避免来回点按后状态错乱 */
    static void toggle(Context context, int todoId, boolean done) {
        List<Integer> doneIds = getDoneIds(context);
        List<Integer> undoneIds = getUndoneIds(context);
        if (done) {
            if (!doneIds.contains(todoId)) doneIds.add(todoId);
            undoneIds.remove(Integer.valueOf(todoId));
        } else {
            doneIds.remove(Integer.valueOf(todoId));
            if (!undoneIds.contains(todoId)) undoneIds.add(todoId);
        }
        write(prefs(context), doneIds, undoneIds);
    }

    /** 批量标记完成（用于"全部完成"） */
    static void markAllDone(Context context, List<Integer> todoIds) {
        List<Integer> doneIds = getDoneIds(context);
        List<Integer> undoneIds = getUndoneIds(context);
        for (Integer id : todoIds) {
            if (id == null) continue;
            if (!doneIds.contains(id)) doneIds.add(id);
            undoneIds.remove(id);
        }
        write(prefs(context), doneIds, undoneIds);
    }

    /**
     * App 侧消费：取出待回传的完成/取消列表。
     * 调用后不清空 —— 由 App 确认写入成功后调用 clear 才清，
     * 避免回传失败时桌面状态与数据库永久不一致。
     */
    static JSONObject readQueue(Context context) {
        JSONObject out = new JSONObject();
        try {
            JSONArray done = new JSONArray();
            for (Integer id : getDoneIds(context)) done.put(id);
            JSONArray undone = new JSONArray();
            for (Integer id : getUndoneIds(context)) undone.put(id);
            out.put("done", done);
            out.put("undone", undone);
        } catch (Exception e) {
            Log.e(TAG, "readQueue failed", e);
        }
        return out;
    }

    /** App 回传成功后清空队列 */
    static void clear(Context context) {
        write(prefs(context), new ArrayList<>(), new ArrayList<>());
    }

    /** 换了一份新快照时，清掉已经没有对应待办的遗留 id，防止存储无限增长 */
    static void prune(Context context, List<Integer> knownIds) {
        if (knownIds == null) return;
        List<Integer> doneIds = getDoneIds(context);
        List<Integer> undoneIds = getUndoneIds(context);
        doneIds.retainAll(knownIds);
        undoneIds.retainAll(knownIds);
        write(prefs(context), doneIds, undoneIds);
    }

    private static List<Integer> readIds(String raw) {
        List<Integer> ids = new ArrayList<>();
        if (raw == null || raw.isEmpty()) return ids;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) ids.add(arr.getInt(i));
        } catch (Exception e) {
            Log.e(TAG, "readIds failed", e);
        }
        return ids;
    }

    private static void write(SharedPreferences prefs, List<Integer> doneIds, List<Integer> undoneIds) {
        JSONArray done = new JSONArray();
        for (Integer id : doneIds) done.put(id);
        JSONArray undone = new JSONArray();
        for (Integer id : undoneIds) undone.put(id);
        prefs.edit()
                .putString(KEY_DONE, done.toString())
                .putString(KEY_UNDONE, undone.toString())
                .apply();
    }
}