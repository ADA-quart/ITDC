package com.alpha.itdc.widget;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.TextPaint;
import android.util.Log;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * 把 /api/widget/today 的 JSON 渲染成位图。
 * 位图尺寸按小组件在桌面上实际占用的格子大小传入，保证任何尺寸下文字比例一致。
 */
public class WidgetBitmapRenderer {

    private static final String TAG = "WidgetBitmapRenderer";

    private static final int BG = 0xFF1A1A2E;
    private static final int TEXT_PRIMARY = 0xFFECEFF4;
    private static final int TEXT_SECONDARY = 0xFFAEB3C6;
    private static final int ACCENT = 0xFF4C9AFF;
    private static final int DIVIDER = 0xFF3A3A52;

    public static Bitmap render(Context context, String json, int width, int height) {
        try {
            return renderFromJson(context, json, width, height);
        } catch (Exception e) {
            Log.e(TAG, "render failed", e);
        }
        return null;
    }

    private static Bitmap renderFromJson(Context context, String json, int W, int H) {
        int scheduleStart = findArray(json, "schedule");
        int todosStart = findArray(json, "todos");
        List<String[]> scheduleItems = parseSchedule(json, scheduleStart);
        List<String> todoItems = parseTodos(json, todosStart);

        Bitmap bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        Paint bg = new Paint();
        bg.setColor(BG);
        canvas.drawRect(0, 0, W, H, bg);

        float pad = W * 0.045f;
        float headerSize = clamp(W * 0.062f, 15f, 64f);
        float titleSize = clamp(W * 0.046f, 12f, 46f);
        float metaSize = clamp(W * 0.036f, 10f, 36f);
        float lineGap = headerSize * 0.35f;
        float rowHeight = titleSize * 2.05f;

        Paint text = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        text.setTypeface(Typeface.SANS_SERIF);

        float y = pad + headerSize;

        // 顶部：日期 + 标题
        text.setTextSize(headerSize);
        text.setColor(TEXT_PRIMARY);
        text.setFakeBoldText(true);
        canvas.drawText("今日课表", pad, y, text);

        Calendar cal = Calendar.getInstance();
        String[] weekdays = {"周日", "周一", "周二", "周三", "周四", "周五", "周六"};
        String dateText = String.format(Locale.US, "%d/%d %s",
                cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH),
                weekdays[cal.get(Calendar.DAY_OF_WEEK) - 1]);
        text.setTextSize(metaSize);
        text.setColor(TEXT_SECONDARY);
        text.setFakeBoldText(false);
        float dateWidth = text.measureText(dateText);
        if (dateWidth < W - pad * 2 - W * 0.35f) {
            canvas.drawText(dateText, W - pad - dateWidth, y, text);
        }
        y += lineGap;

        boolean empty = scheduleItems.isEmpty() && todoItems.isEmpty();
        if (empty) {
            String emptyMsg = context.getString(R.string.widget_empty);
            text.setTextSize(titleSize);
            text.setColor(TEXT_SECONDARY);
            String[] lines = emptyMsg.split("\\n");
            float blockH = lines.length * titleSize * 1.5f;
            float startY = (H + blockH) / 2f - titleSize;
            for (String line : lines) {
                float lw = text.measureText(line);
                canvas.drawText(line, (W - lw) / 2f, startY, text);
                startY += titleSize * 1.5f;
            }
            return bmp;
        }

        float footerReserve = 0f;
        boolean hasTodos = !todoItems.isEmpty();
        if (hasTodos) footerReserve = titleSize * 1.9f;

        // 已排期日程
        y += headerSize * 0.25f;
        float scheduleBottom = H - pad - footerReserve;
        for (String[] item : scheduleItems) {
            if (y + rowHeight > scheduleBottom) break;
            String time = item[0];
            String title = item[1];

            text.setTextSize(titleSize);
            text.setColor(ACCENT);
            text.setFakeBoldText(true);
            float timeWidth = text.measureText(time);

            text.setColor(TEXT_PRIMARY);
            text.setFakeBoldText(false);
            float titleMax = W - pad * 2 - timeWidth - metaSize * 1.2f;
            String shown = ellipsize(text, title, titleMax);
            canvas.drawText(time, pad, y, text);
            canvas.drawText(shown, pad + timeWidth + metaSize * 1.2f, y, text);

            y += rowHeight;
        }

        // 待办区
        if (hasTodos) {
            float sepY = H - pad - footerReserve + titleSize * 0.2f;
            if (sepY > y + lineGap) {
                Paint divider = new Paint();
                divider.setColor(DIVIDER);
                divider.setStrokeWidth(Math.max(1f, W * 0.0025f));
                canvas.drawLine(pad, sepY, W - pad, sepY, divider);
            }
            y = H - pad - footerReserve + titleSize * 1.25f;
            for (String title : todoItems) {
                if (y > H - pad + titleSize * 0.2f) break;
                text.setTextSize(metaSize);
                text.setColor(ACCENT);
                canvas.drawText("•", pad, y, text);
                text.setTextSize(titleSize);
                text.setColor(TEXT_PRIMARY);
                float maxW = W - pad * 2 - titleSize * 0.9f;
                canvas.drawText(ellipsize(text, title, maxW), pad + titleSize * 0.9f, y, text);
                y += titleSize * 1.45f;
            }
        }

        return bmp;
    }

    private static float clamp(float v, float lo, float hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static String ellipsize(Paint paint, String s, float maxWidth) {
        if (s == null) return "";
        if (maxWidth <= 0 || paint.measureText(s) <= maxWidth) return s;
        int len = s.length();
        while (len > 1 && paint.measureText(s.substring(0, len) + "…") > maxWidth) len--;
        return s.substring(0, len) + "…";
    }

    private static int findArray(String json, String key) {
        String marker = "\"" + key + "\"";
        int idx = json.indexOf(marker);
        if (idx < 0) return -1;
        idx = json.indexOf('[', idx);
        return idx >= 0 ? idx : -1;
    }

    private static List<String[]> parseSchedule(String json, int startIdx) {
        List<String[]> result = new ArrayList<>();
        if (startIdx < 0) return result;
        for (String obj : findObjects(json, startIdx)) {
            String time = extractField(obj, "start");
            String end = extractField(obj, "end");
            String title = extractField(obj, "title");
            String span = (time != null ? time : "");
            if (end != null && !end.isEmpty()) span = span + "-" + end;
            result.add(new String[]{ span, title != null ? title : "" });
        }
        return result;
    }

    private static List<String> parseTodos(String json, int startIdx) {
        List<String> result = new ArrayList<>();
        if (startIdx < 0) return result;
        for (String obj : findObjects(json, startIdx)) {
            String title = extractField(obj, "title");
            result.add(title != null ? title : "");
        }
        return result;
    }

    private static List<String> findObjects(String json, int arrStart) {
        List<String> objs = new ArrayList<>();
        int i = arrStart + 1;
        while (i < json.length()) {
            char c = json.charAt(i);
            if (c == '{') {
                int end = json.indexOf('}', i);
                if (end < 0) break;
                objs.add(json.substring(i, end + 1));
                i = end + 1;
            } else if (c == ']') {
                break;
            } else {
                i++;
            }
        }
        return objs;
    }

    private static String extractField(String obj, String key) {
        int idx = obj.indexOf("\"" + key + "\"");
        if (idx < 0) return null;
        int colon = obj.indexOf(':', idx);
        if (colon < 0) return null;
        int valStart = colon + 1;
        while (valStart < obj.length() && " \t".indexOf(obj.charAt(valStart)) >= 0) valStart++;
        if (valStart >= obj.length()) return null;
        char c = obj.charAt(valStart);
        if (c == '"') {
            StringBuilder sb = new StringBuilder();
            int i = valStart + 1;
            while (i < obj.length()) {
                char ch = obj.charAt(i);
                if (ch == '\\' && i + 1 < obj.length()) {
                    char next = obj.charAt(i + 1);
                    if (next == 'n') sb.append('\n');
                    else if (next == 't') sb.append('\t');
                    else sb.append(next);
                    i += 2;
                    continue;
                }
                if (ch == '"') break;
                sb.append(ch);
                i++;
            }
            return sb.toString();
        }
        int end = obj.indexOf(',', valStart);
        if (end < 0) end = obj.indexOf('}', valStart);
        if (end < 0) end = obj.length();
        String v = obj.substring(valStart, end).trim();
        if (v.equals("null")) return null;
        return v;
    }
}