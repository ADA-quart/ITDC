package com.alpha.itdc.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 集合型小组件的数据源：为今天课表 / 明天课表 / 待办三个列表提供条目。
 *
 * 之所以改用 RemoteViewsService + ListView：静态位图在桌面上无法滚动，
 * 只有集合型小组件才支持滑动。
 */
public class ITDCWidgetListService extends RemoteViewsService {

    static final String EXTRA_LIST = "list";
    static final String LIST_TODAY = "today";
    static final String LIST_TOMORROW = "tomorrow";
    static final String LIST_TODO = "todo";

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        String list = intent != null ? intent.getStringExtra(EXTRA_LIST) : LIST_TODAY;
        return new ItemFactory(getApplicationContext(), list == null ? LIST_TODAY : list);
    }

    /** 从快照 JSON 中读出条目并逐行构建 RemoteViews */
    static class ItemFactory implements RemoteViewsFactory {

        private static final String TAG = "ITDCWidgetList";

        private final Context context;
        private final String listType;
        private final List<Row> rows = new ArrayList<>();
        private String emptyText = "";

        ItemFactory(Context context, String listType) {
            this.context = context;
            this.listType = listType;
        }

        @Override
        public void onCreate() { /* 无需额外初始化 */ }

        @Override
        public void onDataSetChanged() {
            rows.clear();
            try {
                String snapshot = ITDCWidgetProvider.getLocalSnapshot(context);
                if (snapshot == null || snapshot.isEmpty()) {
                    emptyText = context.getString(R.string.widget_local_no_data);
                    return;
                }
                JSONObject root = new JSONObject(snapshot);

                if (LIST_TODO.equals(listType)) {
                    parseTodos(root);
                } else {
                    parseSchedule(root, LIST_TOMORROW.equals(listType) ? "tomorrow" : "schedule");
                }
            } catch (Exception e) {
                Log.e(TAG, "onDataSetChanged failed", e);
                emptyText = context.getString(R.string.widget_local_no_data);
            }
        }

        private void parseSchedule(JSONObject root, String key) throws Exception {
            JSONArray arr = root.optJSONArray(key);
            if (arr == null || arr.length() == 0) {
                emptyText = context.getString(
                        "tomorrow".equals(key) ? R.string.widget_no_class_tomorrow : R.string.widget_no_class_today);
                return;
            }
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Row r = new Row();
                r.title = o.optString("title", "");
                r.start = o.optString("start", "");
                r.end = o.optString("end", "");
                r.location = o.optString("location", "");
                r.color = o.optString("color", "#4C9AFF");
                rows.add(r);
            }
        }

        private void parseTodos(JSONObject root) throws Exception {
            JSONArray arr = root.optJSONArray("todos");
            if (arr == null || arr.length() == 0) {
                emptyText = context.getString(R.string.widget_no_todo);
                return;
            }
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Row r = new Row();
                r.title = o.optString("title", "");
                r.slot = o.optString("slot", "");
                r.deadline = o.optString("deadline", "");
                r.priority = o.optString("priority", "normal");
                rows.add(r);
            }
        }

        @Override
        public int getCount() {
            return rows.isEmpty() ? 1 : rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            // 空状态也占一行，避免列表完全空白
            if (rows.isEmpty()) {
                RemoteViews empty = new RemoteViews(context.getPackageName(), R.layout.widget_empty_item);
                empty.setTextViewText(R.id.empty_text, emptyText);
                return empty;
            }

            Row row = rows.get(position);

            if (LIST_TODO.equals(listType)) {
                RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_todo_item);
                rv.setTextViewText(R.id.todo_dot, "•");
                rv.setTextColor(R.id.todo_dot, priorityColor(row.priority));

                // 标题里带上时间或截止，信息密度更接近参考图
                rv.setTextViewText(R.id.todo_title, row.title);

                StringBuilder meta = new StringBuilder();
                if (!TextUtils.isEmpty(row.slot)) meta.append(row.slot);
                if (!TextUtils.isEmpty(row.deadline)) {
                    if (meta.length() > 0) meta.append("  ");
                    meta.append(context.getString(R.string.widget_due_prefix)).append(row.deadline);
                }
                rv.setTextViewText(R.id.todo_meta, meta.toString());
                rv.setViewVisibility(R.id.todo_meta, meta.length() == 0 ? View.GONE : View.VISIBLE);
                return rv;
            }

            RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_course_item);
            rv.setTextViewText(R.id.course_title, row.title);
            rv.setTextViewText(R.id.course_meta, row.location);
            rv.setViewVisibility(R.id.course_meta, TextUtils.isEmpty(row.location) ? View.GONE : View.VISIBLE);
            rv.setTextViewText(R.id.course_time,
                    TextUtils.isEmpty(row.end) ? row.start : row.start + " - " + row.end);

            // 左侧色条按课程颜色着色，对应参考图的彩色标记
            try {
                rv.setInt(R.id.course_bar, "setBackgroundColor", Color.parseColor(row.color));
            } catch (Exception e) {
                Log.e(TAG, "color parse failed: " + row.color, e);
            }
            return rv;
        }

        /** 四象限优先级配色 */
        private int priorityColor(String priority) {
            switch (priority == null ? "" : priority) {
                case "urgent-important": return 0xFFF5222D;
                case "important": return 0xFFFA8C16;
                case "urgent": return 0xFF1890FF;
                default: return 0xFF52C41A;
            }
        }

        @Override
        public RemoteViews getLoadingView() { return null; }

        @Override
        public int getViewTypeCount() { return 1; }

        @Override
        public long getItemId(int position) { return position; }

        @Override
        public boolean hasStableIds() { return false; }

        @Override
        public void onDestroy() { rows.clear(); }

        static class Row {
            String title = "";
            String start = "";
            String end = "";
            String location = "";
            String color = "#4C9AFF";
            String slot = "";
            String deadline = "";
            String priority = "normal";
        }
    }
}