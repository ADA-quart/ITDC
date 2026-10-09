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
    private static final String KEY_FOCUS_X = "ap_focus_x";
    private static final String KEY_FOCUS_Y = "ap_focus_y";
    private static final String KEY_ZOOM = "ap_zoom";
    private static final String KEY_CROP_FILE = "ap_crop_file";
    private static final String KEY_CROP_SIG = "ap_crop_sig";
    private static final String IMAGE_NAME = "widget_bg.jpg";
    /** 桌面自己解码的高清裁切图（走 FileProvider，不进 Binder） */
    private static final String CROP_DIR = "widget";
    private static final int CROP_MAX_SIDE = 1280;
    private static final int CROP_QUALITY = 88;
    private static final Object CROP_LOCK = new Object();

    static final String SCHEME_AUTO = "auto";
    static final String SCHEME_LIGHT = "light";
    static final String SCHEME_DARK = "dark";

    private static final int DEFAULT_ACCENT = 0xFF4C9AFF;
    private static final int DEFAULT_OPACITY = 90;
    private static final int PANEL_LIGHT = 0xFFFFFFFF;
    private static final int PANEL_DARK = 0xFF1C1C20;

    /** 缩放范围：1 = 铺满裁切，> 1 放大取局部，< 1 缩小（四周用模糊放大版打底） */
    private static final float MIN_ZOOM = 0.5f;
    private static final float MAX_ZOOM = 3f;

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
    /** 新路径（centerCrop）的方形裁切预算：约 0.96MB，仍低于 Binder 事务上限 */
    private static final int MAX_CROP_PIXELS = 240_000;

    private WidgetAppearance() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 缩放统一钳位：把越界、NaN 都收进合法区间，默认 1 倍 */
    private static float clampZoom(float zoom) {
        if (Float.isNaN(zoom) || Float.isInfinite(zoom)) return 1f;
        return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    }

    // ---------- 写入 ----------

    /** App 下发外观：colors 立即生效；image 只在换图时传，缺省表示沿用已存的文件 */
    static void apply(Context context, String accent, String panelColor, int panelOpacity,
                      String scheme, boolean hasImage, int focusX, int focusY, float zoom,
                      String imageDataUrl) throws Exception {
        SharedPreferences.Editor editor = prefs(context).edit();
        if (!TextUtils.isEmpty(accent)) {
            editor.putInt(KEY_ACCENT, parseColor(accent, DEFAULT_ACCENT));
        }
        editor.putString(KEY_PANEL, TextUtils.isEmpty(panelColor) ? "" : panelColor.trim());
        editor.putInt(KEY_OPACITY, Math.max(0, Math.min(100, panelOpacity)));
        editor.putString(KEY_SCHEME, normalizeScheme(scheme));
        editor.putBoolean(KEY_HAS_IMAGE, hasImage && imageFile(context).exists());
        editor.putInt(KEY_FOCUS_X, Math.max(0, Math.min(100, focusX)));
        editor.putInt(KEY_FOCUS_Y, Math.max(0, Math.min(100, focusY)));
        editor.putFloat(KEY_ZOOM, clampZoom(zoom));
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

    private static File cropDir(Context context) {
        return new File(context.getFilesDir(), CROP_DIR);
    }

    /** FileProvider 的 authority，与 AndroidManifest 里的声明保持一致 */
    static String fileProviderAuthority(Context context) {
        return context.getPackageName() + ".widgetfileprovider";
    }

    /** 当前生效的裁切图；可能还没生成，调用方需自行判空与 exists() */
    static File currentCropFile(Context context) {
        String name = prefs(context).getString(KEY_CROP_FILE, "");
        if (TextUtils.isEmpty(name)) return null;
        return new File(cropDir(context), name);
    }

    /** 图片 / 焦点 / 缩放任一变化都要重做裁切图，用签名比对避免无谓解码 */
    private static String cropSignature(Context context) {
        File image = imageFile(context);
        return image.length() + "@" + image.lastModified()
                + "#" + prefs(context).getInt(KEY_FOCUS_X, 50)
                + "#" + prefs(context).getInt(KEY_FOCUS_Y, 50)
                + "#" + prefs(context).getFloat(KEY_ZOOM, 1f);
    }

    /**
     * 生成桌面读取的高清裁切图（头像式：等比方形 + 焦点 + 缩放）。
     *
     * 解码 + 编码有几十到几百毫秒，必须放在后台线程调用；签名没变时直接返回。
     *
     * @return 是否真的重写了文件
     */
    static boolean ensureCrop(Context context) {
        if (!hasImage(context)) {
            clearCrop(context);
            return false;
        }
        String sig = cropSignature(context);
        synchronized (CROP_LOCK) {
            File current = currentCropFile(context);
            if (current != null && current.exists()
                    && sig.equals(prefs(context).getString(KEY_CROP_SIG, ""))) {
                return false;
            }
            return writeCrop(context, sig);
        }
    }

    private static boolean writeCrop(Context context, String sig) {
        Bitmap photo = null;
        Bitmap cropped = null;
        try {
            photo = decodePhoto(context, CROP_MAX_SIDE, CROP_MAX_SIDE, false);
            if (photo == null) return false;
            cropped = squareCropBitmap(photo,
                    prefs(context).getInt(KEY_FOCUS_X, 50),
                    prefs(context).getInt(KEY_FOCUS_Y, 50),
                    prefs(context).getFloat(KEY_ZOOM, 1f));
            if (cropped.getWidth() > CROP_MAX_SIDE) {
                Bitmap scaled = Bitmap.createScaledBitmap(cropped, CROP_MAX_SIDE, CROP_MAX_SIDE, true);
                if (scaled != cropped) cropped.recycle();
                cropped = scaled;
            }
            File dir = cropDir(context);
            if (!dir.exists() && !dir.mkdirs()) return false;
            // 文件名带时间戳：URI 变了桌面才会重新解码。沿用同名文件时
            // RemoteViews 复用旧视图，ImageView 会认为"还是那张图"而不刷新。
            File target = new File(dir, "bg_" + System.currentTimeMillis() + ".jpg");
            File tmp = new File(target.getAbsolutePath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                if (!cropped.compress(Bitmap.CompressFormat.JPEG, CROP_QUALITY, out)) return false;
                out.flush();
            }
            if (!tmp.renameTo(target)) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                return false;
            }
            prefs(context).edit()
                    .putString(KEY_CROP_FILE, target.getName())
                    .putString(KEY_CROP_SIG, sig)
                    .apply();
            cleanupCrops(context, target);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "writeCrop failed", e);
            return false;
        } finally {
            if (cropped != null && !cropped.isRecycled()) cropped.recycle();
            if (photo != null && photo != cropped && !photo.isRecycled()) photo.recycle();
        }
    }

    /** 清掉除 keep 以外的裁切图，避免旧文件越积越多 */
    private static void cleanupCrops(Context context, File keep) {
        File[] files = cropDir(context).listFiles();
        if (files == null) return;
        for (File file : files) {
            if (!file.equals(keep)) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
    }

    private static void clearCrop(Context context) {
        synchronized (CROP_LOCK) {
            cleanupCrops(context, null);
            prefs(context).edit().remove(KEY_CROP_FILE).remove(KEY_CROP_SIG).apply();
        }
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

    static boolean hasImage(Context context) {
        return prefs(context).getBoolean(KEY_HAS_IMAGE, false) && imageFile(context).exists();
    }

    /** 图片层透明度（0-255），由「面板不透明度」控制 */
    static int imageAlpha(Context context) {
        int opacity = prefs(context).getInt(KEY_OPACITY, DEFAULT_OPACITY);
        return Math.round(Math.max(0, Math.min(100, opacity)) * 255f / 100f);
    }

    /**
     * 头像式裁切（现代路径）：返回一张以焦点为中心的等比方形裁切图。
     *
     * 图片层用 centerCrop 填满小组件，小部件实际尺寸再怎么变也都只做等比缩放，
     * 不会再因为位图尺寸和桌面尺寸不一致而被 fitXY 拉伸。
     */
    static Bitmap croppedPhotoBitmap(Context context, int appWidgetId) {
        Bitmap photo = null;
        try {
            photo = decodePhoto(context, 720, 720, false);
            if (photo == null) return null;
            int bw = photo.getWidth();
            int bh = photo.getHeight();
            if (bw <= 0 || bh <= 0) return photo;
            int focusX = prefs(context).getInt(KEY_FOCUS_X, 50);
            int focusY = prefs(context).getInt(KEY_FOCUS_Y, 50);
            float z = clampZoom(prefs(context).getFloat(KEY_ZOOM, 1f));
            Bitmap square = squareCropBitmap(photo, focusX, focusY, z);
            if (square != photo) photo.recycle();
            int side = Math.min(square.getWidth(), square.getHeight());
            // 裁切结果直接进 RemoteViews，必须压到 Binder 事务安全范围内，
            // 否则部分桌面会抛 TransactionTooLargeException 让整个小组件变空白。
            int delivery = Math.min(side, (int) Math.floor(Math.sqrt(MAX_CROP_PIXELS)));
            if (delivery < side) {
                Bitmap scaled = Bitmap.createScaledBitmap(square, delivery, delivery, true);
                if (scaled != square) square.recycle();
                return scaled;
            }
            return square;
        } catch (Exception e) {
            Log.e(TAG, "croppedPhotoBitmap failed", e);
            return photo != null && !photo.isRecycled() ? photo : null;
        }
    }

    /**
     * 方形裁切结果（小组件背景用的「头像式」裁切）：zoom ≥ 1 按焦点取一块正方形；
     * zoom < 1 时整图缩小、四周铺同图的模糊放大版，不会露出透明边。
     * 返回值由调用方负责回收，入参 photo 不受影响。
     */
    private static Bitmap squareCropBitmap(Bitmap photo, int focusX, int focusY, float zoom) {
        float z = clampZoom(zoom);
        Rect rect = cropRect(photo, 1, 1, focusX, focusY, Math.max(1f, z));
        Bitmap cropped = Bitmap.createBitmap(photo, rect.left, rect.top, rect.width(), rect.height());
        if (z >= 1f) return cropped;
        Bitmap composed = composeShrunk(cropped, z, focusX, focusY);
        if (composed != cropped) cropped.recycle();
        return composed;
    }

    /**
     * 缩小效果：先铺一层同图的模糊放大版打底，再把清晰图按 zoom 缩到中间。
     * 锚点与 App 侧 CSS 的 transform-origin（焦点百分比）保持一致。
     */
    private static Bitmap composeShrunk(Bitmap square, float z, int focusX, int focusY) {
        int width = square.getWidth();
        int height = square.getHeight();
        if (width <= 0 || height <= 0) return square;

        Bitmap out = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);

        Bitmap blurred = blurDownscale(square);
        canvas.drawBitmap(blurred, null, new RectF(0, 0, width, height), paint);
        if (blurred != square) blurred.recycle();

        float fx = Math.max(0, Math.min(100, focusX)) / 100f;
        float fy = Math.max(0, Math.min(100, focusY)) / 100f;
        float left = width * fx * (1f - z);
        float top = height * fy * (1f - z);
        canvas.drawBitmap(
                square,
                null,
                new RectF(left, top, left + width * z, top + height * z),
                paint);
        return out;
    }

    /**
     * 廉价模糊：连续 2 倍降采样到约 1/16 再插值放大，
     * 等效一次大半径高斯但不引入 RenderScript / 三方依赖。
     */
    private static Bitmap blurDownscale(Bitmap src) {
        final int target = 16;
        Bitmap current = src;
        int width = src.getWidth();
        int height = src.getHeight();
        while (Math.max(width, height) > target * 2) {
            int nextWidth = Math.max(1, width / 2);
            int nextHeight = Math.max(1, height / 2);
            Bitmap next = Bitmap.createScaledBitmap(current, nextWidth, nextHeight, true);
            if (current != src) current.recycle();
            current = next;
            width = nextWidth;
            height = nextHeight;
        }
        return current;
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
            int focusX = prefs(context).getInt(KEY_FOCUS_X, 50);
            int focusY = prefs(context).getInt(KEY_FOCUS_Y, 50);
            float zoom = prefs(context).getFloat(KEY_ZOOM, 1f);

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
                // 头像式裁切：边框固定，图片按焦点 + 缩放选择显示区域
                float z = clampZoom(zoom);
                Rect src = cropRect(photo, width, height, focusX, focusY, Math.max(1f, z));
                float fx = Math.max(0, Math.min(100, focusX)) / 100f;
                float fy = Math.max(0, Math.min(100, focusY)) / 100f;
                float left = width * fx * (1f - z);
                float top = height * fy * (1f - z);
                RectF dst = new RectF(left, top, left + width * z, top + height * z);
                if (z < 1f) {
                    // 缩小：四周先铺一层同图模糊放大版，不会露出透明边
                    Bitmap tiny = Bitmap.createBitmap(
                            Math.max(2, width / 16), Math.max(2, height / 16), Bitmap.Config.ARGB_8888);
                    new Canvas(tiny).drawBitmap(
                            photo, src, new RectF(0, 0, tiny.getWidth(), tiny.getHeight()), paint);
                    canvas.drawBitmap(tiny, null, new RectF(0, 0, width, height), paint);
                    tiny.recycle();
                }
                canvas.drawBitmap(photo, src, dst, paint);
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

    /**
     * 照片按目标宽高做裁切；focusX/focusY（0-100）定位置，zoom（≥1）放大取局部。
     * 缩小（&lt;1）的画面由 {@link #composeShrunk} 处理，这里只负责「放大取局部」。
     *
     * 关键：放大时裁切框的宽和高必须同比缩小，保持与目标区域相同的宽高比，
     * 否则画到小组件里会被拉伸（上一版只缩了一个方向，脸就被横向拉宽了）。
     */
    private static Rect cropRect(Bitmap photo, int width, int height, int focusX, int focusY, float zoom) {
        int bw = photo.getWidth();
        int bh = photo.getHeight();
        if (bw <= 0 || bh <= 0) return new Rect(0, 0, 1, 1);

        float z = Math.max(1f, Math.min(MAX_ZOOM, Float.isNaN(zoom) ? 1f : zoom));
        float targetAspect = (float) width / height;
        float baseWidth;
        float baseHeight;
        if (bw / (float) bh > targetAspect) {
            // 图片比目标更宽：以高度为基准，左右裁
            baseHeight = bh;
            baseWidth = bh * targetAspect;
        } else {
            // 图片比目标更高：以宽度为基准，上下裁
            baseWidth = bw;
            baseHeight = bw / targetAspect;
        }
        float cropWidth = Math.max(1f, Math.min(bw, baseWidth / z));
        float cropHeight = Math.max(1f, Math.min(bh, baseHeight / z));
        float fx = Math.max(0, Math.min(100, focusX)) / 100f;
        float fy = Math.max(0, Math.min(100, focusY)) / 100f;
        float left = (bw - cropWidth) * fx;
        float top = (bh - cropHeight) * fy;
        return new Rect(
                Math.round(left),
                Math.round(top),
                Math.round(left + cropWidth),
                Math.round(top + cropHeight));
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
        } catch (OutOfMemoryError e) {
            Log.e(TAG, "decodePhoto 内存不足", e);
            return null;
        } catch (Exception e) {
            Log.e(TAG, "decodePhoto failed", e);
            return null;
        }
    }

}
