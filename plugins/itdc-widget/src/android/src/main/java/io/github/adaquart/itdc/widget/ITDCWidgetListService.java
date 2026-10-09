package io.github.adaquart.itdc.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Paint;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * 集合型小组件的数据源：为今天课表 / 明天课表 / 待办三个列表提供条目。
 *
 * 之所以用 RemoteViewsService + ListView：静态位图无法滚动，
 * 只有集合型小组件支持滑动。
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
                    boolean isTomorrow = LIST_TOMORROW.equals(listType);
                    // 新结构：按「当前日期」从 days 里取当天条目；跨天后同一份快照自然换成新一天
                    JSONObject day = ITDCWidgetProvider.findDay(root,
                            isTomorrow ? ITDCWidgetProvider.tomorrowDateKey() : ITDCWidgetProvider.currentDateKey());
                    JSONArray arr;
                    if (day != null) {
                        arr = day.optJSONArray("items");
                    } else if (root.optJSONArray("days") == null) {
                        // 旧结构快照（无 days）：退回扁平的 schedule / tomorrow 字段
                        arr = root.optJSONArray(isTomorrow ? "tomorrow" : "schedule");
                    } else {
                        // 新结构但覆盖不到这一天：按空处理，避免显示过期数据
                        arr = null;
                    }
                    parseScheduleArray(arr, isTomorrow);
                }
            } catch (Exception e) {
                Log.e(TAG, "onDataSetChanged failed", e);
                emptyText = context.getString(R.string.widget_local_no_data);
            }
        }

        /**
         * 解析课表条目。
         *
         * 已结束的课会在渲染时被过滤掉 —— 刷新由课程结束边界闹钟 / 解锁 /
         * App 推送共同触发，因此课不需要打开 App 就会自动消失。
         * 明天那一栏不过滤（明天的课还没开始）。
         */
        private void parseScheduleArray(JSONArray arr, boolean isTomorrow) throws Exception {
            if (arr == null || arr.length() == 0) {
                emptyText = context.getString(
                        isTomorrow ? R.string.widget_no_class_tomorrow : R.string.widget_no_class_today);
                return;
            }
            String nowHm = currentHm();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                String end = o.optString("end", "");

                // 今天已结束的课不再展示；"跨天进行中"（end 为空）保留
                if (!isTomorrow && !TextUtils.isEmpty(end) && end.compareTo(nowHm) <= 0) {
                    continue;
                }

                Row r = new Row();
                r.title = o.optString("title", "");
                r.start = o.optString("start", "");
                r.end = end;
                r.location = o.optString("location", "");
                r.color = o.optString("color", "#4C9AFF");
                rows.add(r);
            }

            if (rows.isEmpty()) {
                emptyText = context.getString(
                        isTomorrow ? R.string.widget_no_class_tomorrow : R.string.widget_no_class_today);
            }
        }

        private void parseTodos(JSONObject root) throws Exception {
            JSONArray arr = root.optJSONArray("todos");
            if (arr == null || arr.length() == 0) {
                emptyText = context.getString(R.string.widget_no_todo);
                return;
            }

            // 快照里的完成状态 + 桌面上尚未回传的本地改动
            List<Integer> doneFromSnapshot = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                if (o.optBoolean("done", false)) doneFromSnapshot.add(o.optInt("id", -1));
            }

            List<Row> pendingRows = new ArrayList<>();
            List<Row> doneRows = new ArrayList<>();
            List<Integer> knownIds = new ArrayList<>();

            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                int id = o.optInt("id", -1);
                if (id < 0) continue;
                knownIds.add(id);

                Row r = new Row();
                r.id = id;
                r.title = o.optString("title", "");
                r.slot = o.optString("slot", "");
                r.deadline = o.optString("deadline", "");
                r.priority = o.optString("priority", "normal");
                r.done = WidgetDoneStore.isDone(context, id, doneFromSnapshot);

                // 已完成的排到列表末尾，未完成的保持原优先级顺序
                if (r.done) doneRows.add(r); else pendingRows.add(r);
            }

            // 清理已不存在的待办残留记录，避免本地存储无限增长
            WidgetDoneStore.prune(context, knownIds);

            rows.addAll(pendingRows);
            rows.addAll(doneRows);

            if (rows.isEmpty()) emptyText = context.getString(R.string.widget_no_todo);
        }

        /** 当前本地时间 HH:mm */
        private String currentHm() {
            Calendar c = Calendar.getInstance();
            return String.format(java.util.Locale.US, "%02d:%02d",
                    c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
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
                empty.setTextColor(R.id.empty_text, WidgetAppearance.textEmpty(context));
                // 空白提示也能点开 App，避免"点了没反应"
                ITDCWidgetActionReceiver.bindOpenAppFillIn(empty, R.id.empty_text);
                return empty;
            }

            Row row = rows.get(position);

            if (LIST_TODO.equals(listType)) {
                RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_todo_item);

                // 复选框：三层资源 + setColorFilter 着色，而不是贴位图。
                //
                // 实测（模拟器 AOSP 启动器 + 真机澎湃 OS）：集合型子项在
                // notifyAppWidgetViewDataChanged 之后重绘时，启动器会跳过
                // setImageViewBitmap —— 表现为「划线更新了，但框里没有勾」，
                // 必须打开 App 触发一次完整 updateAppWidget 才会补上。
                // 资源与属性类动作（setViewVisibility / setColorFilter / setTextColor）不受影响。
                rv.setViewVisibility(R.id.todo_check_outline, row.done ? View.GONE : View.VISIBLE);
                rv.setViewVisibility(R.id.todo_check_fill, row.done ? View.VISIBLE : View.GONE);
                rv.setViewVisibility(R.id.todo_check_mark, row.done ? View.VISIBLE : View.GONE);
                if (row.done) {
                    // 实心框染成用户主题色，对勾保持白色叠在上面
                    rv.setInt(R.id.todo_check_fill, "setColorFilter", WidgetAppearance.accent(context));
                } else {
                    rv.setInt(R.id.todo_check_outline, "setColorFilter", WidgetAppearance.textSecondary(context));
                }
                // 集合型小组件里子项不能用 setOnClickPendingIntent（系统会忽略），
                // 必须用 fill-in intent，配合 provider 上的 setPendingIntentTemplate。
                ITDCWidgetActionReceiver.bindFillIn(rv, R.id.todo_check, row.id, row.done);
                // 只有勾选框负责"完成"，其余位置（标题、时间、行尾空白）一律打开 App。
                // 标题自己不绑 fill-in，触摸会落到下面这个根布局上。
                ITDCWidgetActionReceiver.bindOpenAppFillIn(rv, R.id.todo_item_root);

                rv.setTextViewText(R.id.todo_title, row.title);
                rv.setTextColor(R.id.todo_title,
                        row.done ? WidgetAppearance.textDone(context) : WidgetAppearance.textPrimary(context));
                rv.setTextColor(R.id.todo_meta, WidgetAppearance.textSecondary(context));

                // 已完成：用一条贯穿整行的细线，而不是给标题/时间各画一段删除线
                // （两段之间隔着空白，看起来是断开的）。文字不再带 STRIKE_THRU。
                rv.setInt(R.id.todo_title, "setPaintFlags", Paint.ANTI_ALIAS_FLAG);
                rv.setViewVisibility(R.id.todo_strike, row.done ? View.VISIBLE : View.GONE);
                if (row.done) {
                    rv.setInt(R.id.todo_strike, "setBackgroundColor", WidgetAppearance.textDone(context));
                }

                StringBuilder meta = new StringBuilder();
                if (!TextUtils.isEmpty(row.slot)) meta.append(row.slot);
                if (!TextUtils.isEmpty(row.deadline)) {
                    if (meta.length() > 0) meta.append("  ");
                    meta.append(context.getString(R.string.widget_due_prefix)).append(row.deadline);
                }
                rv.setTextViewText(R.id.todo_meta, meta.toString());
                rv.setViewVisibility(R.id.todo_meta, meta.length() == 0 ? View.GONE : View.VISIBLE);
                rv.setInt(R.id.todo_meta, "setPaintFlags", Paint.ANTI_ALIAS_FLAG);

                return rv;
            }

            RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_course_item);
            // 课程条目任意位置都能点开 App
            ITDCWidgetActionReceiver.bindOpenAppFillIn(rv, R.id.course_item_root);
            rv.setTextViewText(R.id.course_title, row.title);
            rv.setTextViewText(R.id.course_meta, row.location);
            rv.setViewVisibility(R.id.course_meta, TextUtils.isEmpty(row.location) ? View.GONE : View.VISIBLE);
            rv.setTextViewText(R.id.course_time,
                    TextUtils.isEmpty(row.end) ? row.start : row.start + " - " + row.end);
            rv.setTextColor(R.id.course_title, WidgetAppearance.textPrimary(context));
            rv.setTextColor(R.id.course_meta, WidgetAppearance.textSecondary(context));
            rv.setTextColor(R.id.course_time, WidgetAppearance.textSecondary(context));

            // 左侧色条按课程颜色着色，对应参考图的彩色标记
            try {
                rv.setInt(R.id.course_bar, "setBackgroundColor", Color.parseColor(row.color));
            } catch (Exception e) {
                Log.e(TAG, "color parse failed: " + row.color, e);
            }
            return rv;
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
            int id = -1;
            String title = "";
            String start = "";
            String end = "";
            String location = "";
            String color = "#4C9AFF";
            String slot = "";
            String deadline = "";
            String priority = "normal";
            boolean done = false;
        }
    }
}
