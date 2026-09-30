package io.github.adaquart.itdc.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Base64;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 小组件外观：主题色、面板底色/不透明度、明暗与背景图。
 *
 * 全部状态存在 App 与小组件共用的 {@code widget_prefs} 里；
 * 背景图（base64 下发）落盘到私有目录，渲染时按目标尺寸缩放解码，避免大图 OOM。
 *
 * 为什么背景要自己做位图：RemoteViews 不能承载运行时构造的 drawable，
 * 而 {@code @color/widget_bg} 这类资源色又无法在运行时修改。
 * 因此把「圆角 + 底色/照片 + 透明度」一次性画成位图交给 ImageView。
 * 位图尺寸被严格限制在 Binder 事务安全范围内，否则部分桌面会抛
 * TransactionTooLargeException 导致小组件整块变空白。
 */
final class WidgetAppearance {

    private static final String TAG = "ITDCWidgetAppearance";
    private static final String PREFS = "widget_prefs";

    private static final String KEY_ACCENT = "ap_accent";
    private static final String KEY_PANEL = "ap_panel_color";
    private static final String KEY_OPACITY = "ap_panel_opacity";
    private static final String KEY_SCHEME = "ap_scheme";
    private static final String KEY_HAS_IMAGE = "ap_has_image";
    private static final String IMAGE_NAME = "widget_bg.jpg";

    static final String SCHEME_AUTO = "auto";
    static final String SCHEME_LIGHT = "light";
    static final String SCHEME_DARK = "dark";

    private static final int DEFAULT_ACCENT = 0xFF4C9AFF;
    private static final int DEFAULT_OPACITY = 90;
    private static final int PANEL_LIGHT = 0xFFFFFFFF;
    private static final int PANEL_DARK = 0xFF1C1C20;

    private static final int TEXT_PRIMARY_LIGHT = 0xFF1A1A1A;
    private static final int TEXT_PRIMARY_DARK = 0xFFECEFF4;
    private static final int TEXT_SECONDARY_LIGHT = 0xFF6B6B6B;
    private static final int TEXT_SECONDARY_DARK = 0xFFA8A8B3;
    private static final int TEXT_EMPTY_LIGHT = 0xFF9E9E9E;
    private static final int TEXT_EMPTY_DARK = 0xFF7E7E8A;
    private static final int TEXT_SECTION_LIGHT = 0xFF3D3D3D;
    private static final int TEXT_SECTION_DARK = 0xFFD8D8E0;

    /** 圆角直径与 widget_bg.xml 保持一致，两套渲染不能出现视觉跳变 */
    static final float CORNER_RADIUS_DP = 26f;

    /** Binder 事务上限约 1MB，这里把位图压到 ~320KB 以内 */
    private static final int MAX_PIXELS_OPAQUE = 160_000;
    private static final int MAX_PIXELS_TRANSLUCENT = 80_000;
    private static final int MAX_SIDE_PX = 720;

    private WidgetAppearance() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------- 写入 ----------

    /** App 下发外观：colors 立即生效；image 只在换图时传，缺省表示沿用已存的文件 */
    static void apply(Context context, String accent, String panelColor, int panelOpacity,
                      String scheme, boolean hasImage, String imageDataUrl) throws Exception {
        SharedPreferences.Editor editor = prefs(context).edit();
        if (!TextUtils.isEmpty(accent)) {
            editor.putInt(KEY_ACCENT, parseColor(accent, DEFAULT_ACCENT));
        }
        editor.putString(KEY_PANEL, TextUtils.isEmpty(panelColor) ? "" : panelColor.trim());
        editor.putInt(KEY_OPACITY, Math.max(0, Math.min(100, panelOpacity)));
        editor.putString(KEY_SCHEME, normalizeScheme(scheme));
        editor.putBoolean(KEY_HAS_IMAGE, hasImage && imageFile(context).exists());
        editor.apply();

        if (!TextUtils.isEmpty(imageDataUrl)) {
            if (hasImage) {
                writeImage(context, imageDataUrl);
                prefs(context).edit().putBoolean(KEY_HAS_IMAGE, true).apply();
            } else {
                clearImage(context);
            }
        } else if (!hasImage) {
            clearImage(context);
        }
    }

    private static void writeImage(Context context, String dataUrl) throws Exception {
        int comma = dataUrl.indexOf(',');
        String base64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
        byte[] bytes;
        try {
            bytes = Base64.decode(base64.getBytes(StandardCharsets.US_ASCII), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            throw new Exception("背景图解码失败: " + e.getMessage());
        }
        File target = imageFile(context);
        File tmp = new File(target.getAbsolutePath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(bytes);
            out.flush();
        }
        // 先写临时文件再改名：刷新过程中读到写了一半的图会直接解码失败
        if (target.exists() && !target.delete()) {
            Log.w(TAG, "旧背景图删除失败，直接覆盖");
        }
        if (!tmp.renameTo(target)) {
            try (FileOutputStream out = new FileOutputStream(target)) {
                out.write(bytes);
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    private static void clearImage(Context context) {
        File f = imageFile(context);
        if (f.exists()) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
        prefs(context).edit().putBoolean(KEY_HAS_IMAGE, false).apply();
    }

    private static File imageFile(Context context) {
        return new File(context.getFilesDir(), IMAGE_NAME);
    }

    private static String normalizeScheme(String scheme) {
        if (SCHEME_LIGHT.equals(scheme) || SCHEME_DARK.equals(scheme)) return scheme;
        return SCHEME_AUTO;
    }

    private static int parseColor(String value, int fallback) {
        try {
            String v = value.trim();
            if (!v.startsWith("#")) v = "#" + v;
            if (v.length() == 7) v = "#FF" + v.substring(1);
            return Color.parseColor(v);
        } catch (Exception e) {
            return fallback;
        }
    }

    // ---------- 读取 ----------

    static int accent(Context context) {
        return prefs(context).getInt(KEY_ACCENT, DEFAULT_ACCENT);
    }

    static boolean isNight(Context context) {
        String scheme = prefs(context).getString(KEY_SCHEME, SCHEME_AUTO);
        if (SCHEME_LIGHT.equals(scheme)) return false;
        if (SCHEME_DARK.equals(scheme)) return true;
        int uiMode = context.getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK;
        return uiMode == Configuration.UI_MODE_NIGHT_YES;
    }

    static int textPrimary(Context context) {
        return isNight(context) ? TEXT_PRIMARY_DARK : TEXT_PRIMARY_LIGHT;
    }

    static int textSecondary(Context context) {
        return isNight(context) ? TEXT_SECONDARY_DARK : TEXT_SECONDARY_LIGHT;
    }

    static int textEmpty(Context context) {
        return isNight(context) ? TEXT_EMPTY_DARK : TEXT_EMPTY_LIGHT;
    }

    static int textSection(Context context) {
        return isNight(context) ? TEXT_SECTION_DARK : TEXT_SECTION_LIGHT;
    }

    static int divider(Context context) {
        return isNight(context) ? 0x26FFFFFF : 0x1F000000;
    }

    /** 已完成的待办：统一降到次要文字色，两种明暗都够看 */
    static int textDone(Context context) {
        return isNight(context) ? 0xFF80808C : 0xFF9E9E9E;
    }

    /** 面板底色（不含透明度），用户自定义优先，否则按明暗取默认 */
    private static int panelColor(Context context) {
        String custom = prefs(context).getString(KEY_PANEL, "");
        if (!TextUtils.isEmpty(custom)) return parseColor(custom, isNight(context) ? PANEL_DARK : PANEL_LIGHT);
        return isNight(context) ? PANEL_DARK : PANEL_LIGHT;
    }

    /** 面板 alpha（0-255），供提示页这类只需要纯色的场景使用 */
    static int panelColorWithAlpha(Context context) {
        int opacity = prefs(context).getInt(KEY_OPACITY, DEFAULT_OPACITY);
        return withAlpha(panelColor(context), Math.round(opacity * 255f / 100f));
    }

    private static boolean hasImage(Context context) {
        return prefs(context).getBoolean(KEY_HAS_IMAGE, false) && imageFile(context).exists();
    }

    private static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (Math.max(0, Math.min(255, alpha)) << 24);
    }

    // ---------- 渲染 ----------

    /**
     * 生成小组件背景位图：圆角矩形 + 底色或照片 + 用户设定的透明度。
     * 尺寸按小组件实际像素缩放，并压到 Binder 安全预算内。
     */
    static Bitmap backgroundBitmap(Context context, int appWidgetId) {
        try {
            int opacity = prefs(context).getInt(KEY_OPACITY, DEFAULT_OPACITY);
            int alpha = Math.round(Math.max(0, Math.min(100, opacity)) * 255f / 100f);
            boolean useImage = hasImage(context);

            int[] size = targetSize(context, appWidgetId, useImage, alpha);
            int width = size[0];
            int height = size[1];

            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);

            float radius = CORNER_RADIUS_DP * context.getResources().getDisplayMetrics().density
                    * width
                    / Math.max(1, widgetWidthPx(context, appWidgetId));
            Path clip = new Path();
            clip.addRoundRect(new RectF(0, 0, width, height), radius, radius, Path.Direction.CW);
            canvas.clipPath(clip);

            Bitmap photo = null;
            if (useImage) photo = decodePhoto(context, width, height, alpha >= 255);

            if (photo != null) {
                Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
                paint.setAlpha(alpha);
                canvas.drawBitmap(photo, cropRect(photo, width, height), new RectF(0, 0, width, height), paint);
                photo.recycle();
            } else {
                // 无图或解码失败：退回纯色面板，至少不会变成透明条
                canvas.drawColor(withAlpha(panelColor(context), alpha), PorterDuff.Mode.SRC);
            }
            return bitmap;
        } catch (Exception e) {
            Log.e(TAG, "backgroundBitmap failed", e);
            return null;
        }
    }

    /** 照片按目标宽高做 center-crop，避免被拉伸变形 */
    private static Rect cropRect(Bitmap photo, int width, int height) {
        int bw = photo.getWidth();
        int bh = photo.getHeight();
        if (bw <= 0 || bh <= 0) return new Rect(0, 0, 1, 1);

        int cropWidth = Math.round(bh * (float) width / height);
        if (cropWidth <= bw) {
            int left = (bw - cropWidth) / 2;
            return new Rect(left, 0, left + cropWidth, bh);
        }
        int cropHeight = Math.round(bw * (float) height / width);
        int top = Math.max(0, (bh - cropHeight) / 2);
        return new Rect(0, top, bw, Math.min(bh, top + cropHeight));
    }

    /** 小组件宽度（像素），用于把圆角半径换算到位图坐标系 */
    private static int widgetWidthPx(Context context, int appWidgetId) {
        Bundle options = options(context, appWidgetId);
        int dp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
        return Math.round(dp * context.getResources().getDisplayMetrics().density);
    }

    private static Bundle options(Context context, int appWidgetId) {
        try {
            AppWidgetManager awm = (AppWidgetManager) context.getSystemService(Context.APPWIDGET_SERVICE);
            if (awm != null) {
                Bundle bundle = awm.getAppWidgetOptions(appWidgetId);
                if (bundle != null) return bundle;
            }
        } catch (Exception e) {
            Log.w(TAG, "读取小组件尺寸失败，用默认值", e);
        }
        return new Bundle();
    }

    /**
     * 目标位图尺寸。
     * 纯色面板不需要高分辨率（颜色本身无细节），只保留够画圆角的像素；
     * 照片则按小组件像素尺寸缩到预算上限。
     */
    private static int[] targetSize(Context context, int appWidgetId, boolean useImage, int alpha) {
        Bundle options = options(context, appWidgetId);
        float density = context.getResources().getDisplayMetrics().density;
        int widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
        int heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 180);

        int width = Math.max(160, Math.round(widthDp * density));
        int height = Math.max(120, Math.round(heightDp * density));
        if (!useImage) {
            return fit(width, height, 120_000, 360);
        }
        int budget = alpha >= 255 ? MAX_PIXELS_OPAQUE : MAX_PIXELS_TRANSLUCENT;
        return fit(width, height, budget, MAX_SIDE_PX);
    }

    /** 等比缩到「像素总量 ≤ budget 且长边 ≤ maxSide」 */
    private static int[] fit(int width, int height, int budget, int maxSide) {
        double scale = 1d;
        long pixels = (long) width * height;
        if (pixels > budget) scale = Math.sqrt(budget / (double) pixels);
        int longest = Math.max(width, height);
        if (longest * scale > maxSide) scale = Math.min(scale, maxSide / (double) longest);
        return new int[]{
                Math.max(24, (int) Math.round(width * scale)),
                Math.max(24, (int) Math.round(height * scale))
        };
    }

    /** 按目标尺寸采样解码，绝不把原图整张读进内存 */
    private static Bitmap decodePhoto(Context context, int reqWidth, int reqHeight, boolean opaque) {
        try {
            File file = imageFile(context);
            if (!file.exists()) return null;

            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= reqWidth
                    && bounds.outHeight / (sample * 2) >= reqHeight) {
                sample *= 2;
            }

            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            opts.inPreferredConfig = opaque ? Bitmap.Config.RGB_565 : Bitmap.Config.ARGB_8888;
            return BitmapFactory.decodeFile(file.getAbsolutePath(), opts);
        } catch (Exception e) {
            Log.e(TAG, "decodePhoto failed", e);
            return null;
        }
    }

}
