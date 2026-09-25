package com.alpha.itdc.widget;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

public class WidgetBitmapRenderer {

    private static final int W = 720;
    private static final int H = 1080;

    public static Bitmap render(Context context, String json) {
        try { return renderFromJson(json); }
        catch (Exception e) { Log.e("WidgetBitmapRenderer", "render failed", e); }
        return null;
    }

    private static Bitmap renderFromJson(String json) {
        int scheduleStart = findArray(json, "schedule");
        int todosStart = findArray(json, "todos");
        List<String> scheduleItems = parseSchedule(json, scheduleStart);
        List<String> todoItems = parseTodos(json, todosStart);

        Bitmap bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        Paint bgPaint = new Paint();
        bgPaint.setColor(Color.parseColor("#1a1a2e"));
        canvas.drawRect(0, 0, W, H, bgPaint);

        Paint headerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        headerPaint.setTextSize(56);
        headerPaint.setTypeface(android.graphics.Typeface.SANS_SERIF);
        headerPaint.setTextColor(Color.parseColor("#e0e0e0"));
        canvas.drawText("今日课表", 48, 100, headerPaint);

        Paint itemPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        int y = 170;
        for (String item : scheduleItems) {
            if (y + 90 > H - 260) break;
            String[] parts = item.split("\\|");
            String time = parts.length > 0 ? parts[0] : "";
            String title = parts.length > 1 ? parts[1] : "";
            itemPaint.setTextSize(44);
            itemPaint.setTextColor(Color.parseColor("#ffffff"));
            canvas.drawText(time, 48, y + 32, itemPaint);
            itemPaint.setTextSize(34);
            itemPaint.setTextColor(Color.parseColor("#b0b0c0"));
            canvas.drawText(title, 150, y + 60, itemPaint);
            y += 90;
        }

        Paint divider = new Paint();
        divider.setColor(Color.parseColor("#3a3a52"));
        divider.setStrokeWidth(2);
        canvas.drawLine(48, y, W - 48, y, divider);
        y += 40;

        headerPaint.setTextSize(56);
        headerPaint.setTextColor(Color.parseColor("#e0e0e0"));
        canvas.drawText("待办", 48, y + 32, headerPaint);
        y += 70;

        for (String item : todoItems) {
            if (y + 75 > H - 20) break;
            String[] parts = item.split("\\|");
            String title = parts.length > 0 ? parts[0] : "";
            itemPaint.setTextSize(34);
            itemPaint.setTextColor(Color.parseColor("#ffffff"));
            canvas.drawText("• " + title, 60, y + 32, itemPaint);
            y += 75;
        }

        return bmp;
    }

    private static int findArray(String json, String key) {
        String marker = "\"" + key + "\"";
        int idx = json.indexOf(marker);
        if (idx < 0) return -1;
        idx = json.indexOf('[', idx);
        return idx >= 0 ? idx : -1;
    }

    private static List<String> parseSchedule(String json, int startIdx) {
        List<String> result = new ArrayList<>();
        if (startIdx < 0) return result;
        for (String sStr : findObjects(json, startIdx)) {
            int objEnd = json.indexOf('}', Integer.parseInt(sStr));
            if (objEnd < 0) break;
            String obj = json.substring(Integer.parseInt(sStr), objEnd + 1);
            String time = extractField(obj, "start");
            String title = extractField(obj, "title");
            result.add((time != null ? time : "") + "|" + (title != null ? title : ""));
        }
        return result;
    }

    private static List<String> parseTodos(String json, int startIdx) {
        List<String> result = new ArrayList<>();
        if (startIdx < 0) return result;
        for (String sStr : findObjects(json, startIdx)) {
            int objEnd = json.indexOf('}', Integer.parseInt(sStr));
            if (objEnd < 0) break;
            String obj = json.substring(Integer.parseInt(sStr), objEnd + 1);
            String title = extractField(obj, "title");
            result.add(title != null ? title : "");
        }
        return result;
    }

    private static String[] findObjects(String json, int arrStart) {
        List<String> objs = new ArrayList<>();
        int i = arrStart + 1;
        while (i < json.length()) {
            char c = json.charAt(i);
            if (c == '{') { objs.add(Integer.toString(i)); }
            else if (c == ']') break;
            i++;
        }
        return objs.toArray(new String[0]);
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
            int end = obj.indexOf('"', valStart + 1);
            return end > valStart ? obj.substring(valStart + 1, end) : null;
        } else {
            int end = obj.indexOf(',', valStart);
            if (end < 0) { end = obj.length(); }
            String v = obj.substring(valStart, end).trim();
            if (v.equals("null")) return null;
            return v;
        }
    }
}
