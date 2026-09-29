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
                    parseSchedule(root, LIST_TOMORROW.equals(listType) ? "tomorrow" : "schedule",
                            LIST_TOMORROW.equals(listType));
                }
            } catch (Exception e) {
                Log.e(TAG, "onDataSetChanged failed", e);
                emptyText = context.getString(R.string.widget_local_no_data);
            }
        }

        /**
         * 解析课表条目。
         *
         * 已结束的课会在渲染时被过滤掉 —— 小组件每隔一段时间会自行刷新
         * （updatePeriodMillis + App 推送），因此课不需要打开 App 就会自动消失。
         * 明天那一栏不过滤（明天的课还没开始）。
         */
        private void parseSchedule(JSONObject root, String key, boolean isTomorrow) throws Exception {
            JSONArray arr = root.optJSONArray(key);
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
                return empty;
            }

            Row row = rows.get(position);

            if (LIST_TODO.equals(listType)) {
                RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_todo_item);

                // 复选框：完成态实心带勾，未完成态空心
                rv.setImageViewResource(R.id.todo_check,
                        row.done ? R.drawable.ic_todo_checked : R.drawable.ic_todo_unchecked);
                // 集合型小组件里子项不能用 setOnClickPendingIntent（系统会忽略），
                // 必须用 fill-in intent，配合 provider 上的 setPendingIntentTemplate。
                ITDCWidgetActionReceiver.bindFillIn(rv, R.id.todo_check, row.id, row.done);
                // 整行也可点，命中区域更大，体验更好
                ITDCWidgetActionReceiver.bindFillIn(rv, R.id.todo_title, row.id, row.done);

                rv.setTextViewText(R.id.todo_title, row.title);

                // 划线效果：已完成的标题加删除线并降低不透明度
                int flags = row.done ? (Paint.STRIKE_THRU_TEXT_FLAG | Paint.ANTI_ALIAS_FLAG)
                                     : Paint.ANTI_ALIAS_FLAG;
                rv.setInt(R.id.todo_title, "setPaintFlags", flags);
                rv.setInt(R.id.todo_title, "setTextColor",
                        row.done ? 0xFF9E9E9E : context.getColor(R.color.widget_text_primary));

                StringBuilder meta = new StringBuilder();
                if (!TextUtils.isEmpty(row.slot)) meta.append(row.slot);
                if (!TextUtils.isEmpty(row.deadline)) {
                    if (meta.length() > 0) meta.append("  ");
                    meta.append(context.getString(R.string.widget_due_prefix)).append(row.deadline);
                }
                rv.setTextViewText(R.id.todo_meta, meta.toString());
                rv.setViewVisibility(R.id.todo_meta, meta.length() == 0 ? View.GONE : View.VISIBLE);
                // 已完成的 meta 也加删除线，视觉上更统一
                rv.setInt(R.id.todo_meta, "setPaintFlags",
                        row.done ? (Paint.STRIKE_THRU_TEXT_FLAG | Paint.ANTI_ALIAS_FLAG)
                                 : Paint.ANTI_ALIAS_FLAG);

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