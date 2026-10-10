package io.github.adaquart.itdc;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import io.github.adaquart.itdc.widget.ITDCWidgetProvider;

import java.util.Locale;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "ITDCMainActivity";
    private static final String PREFS = "itdc_native";
    private static final String KEY_LAST_VERSION_CODE = "last_version_code";

    /** 最近一次系统栏 insets（px）；-1 表示还没拿到 */
    private int lastInsetTop = -1;
    private int lastInsetRight = 0;
    private int lastInsetBottom = 0;
    private int lastInsetLeft = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 明确要求 edge-to-edge：targetSdk 35+ 本应强制，但实测这台设备上窗口仍被系统
        // 整体避开状态栏（insets 恒为 0、WebView 高度少了系统栏那一段），于是自定义
        // 背景图永远铺不到顶。显式声明后 WebView 才会真正铺满整屏。
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        applySystemBarInsets();
        hookInsetsAfterPageLoad();
        clearWebViewCacheAfterUpdate();
    }

    /**
     * 清一次 WebView 的 HTTP 缓存。
     *
     * 前端资源虽然打包在 APK 里，但 WebView 仍会按 URL 缓存 index.html 与 js：
     * 覆盖安装后它可能继续用旧缓存，表现为"装了新版本功能却没变"。
     */
    private void clearWebViewCacheAfterUpdate() {
        try {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView == null) return;

            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            long current = android.os.Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            long last = prefs.getLong(KEY_LAST_VERSION_CODE, -1L);
            prefs.edit().putLong(KEY_LAST_VERSION_CODE, current).apply();

            // 版本没变就只清缓存；版本变了说明刚覆盖安装，清完再重载一次，
            // 免得第一次打开仍然是缓存里的旧前端（"装了新版功能却没变"）
            webView.clearCache(true);
            if (last != current) {
                webView.postDelayed(() -> {
                    try { webView.reload(); } catch (Exception ignored) {}
                }, 800);
            }
        } catch (Exception e) {
            Log.e(TAG, "clearWebViewCacheAfterUpdate failed", e);
        }
    }

    /**
     * 系统深浅色变化时通知前端。
     *
     * AndroidManifest 里 Activity 声明了 uiMode 配置变化，系统切深色时不会重建 Activity，
     * 于是 WebView 的 prefers-color-scheme 一直停在旧值——表现就是"小组件跟随系统，App 不跟随"。
     * 这里把当前系统值直接推给前端，由前端切换主题。
     */
    private boolean isSystemDark() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    private void notifySystemTheme() {
        dispatchToWebView("window.dispatchEvent(new CustomEvent('itdc-system-theme',{detail:{dark:"
                + isSystemDark() + "}}))");
    }

    @Override
    public void onResume() {
        super.onResume();
        notifySystemTheme();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        notifySystemTheme();
    }

    /**
     * 应用已经在前台或后台时，从桌面小组件再次点进来会走这里（launchMode=singleTask），
     * 由小组件携带的 extra 标记识别来源。
     *
     * 需要它是因为：不清空路由的话，用户点小组件后会停在离开时所在的页面（例如设置页），
     * 而小组件展示的是"今日安排"，点进去应当回到主页。
     *
     * 这里只派发事件，具体跳到哪个页面由前端决定，避免把路由表写死在原生侧。
     * 应用被完全杀掉后点小组件走 onCreate，WebView 会重新加载并落到默认主页，无需额外处理。
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null) return;
        setIntent(intent);
        if (intent.getBooleanExtra(ITDCWidgetProvider.EXTRA_OPEN_HOME, false)) {
            intent.removeExtra(ITDCWidgetProvider.EXTRA_OPEN_HOME);
            dispatchToWebView("window.dispatchEvent(new CustomEvent('itdc-open-home'))");
        }
    }

    /** 把一段 JS 交给 WebView 执行；onNewIntent 在主线程，直接调用即可 */
    private void dispatchToWebView(String js) {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            WebView webView = bridge.getWebView();
            if (webView == null) return;
            webView.evaluateJavascript(js, null);
        } catch (Exception e) {
            Log.e(TAG, "dispatchToWebView failed", e);
        }
    }

    /**
     * Android 15（targetSdk 35+）强制 edge-to-edge：内容会延伸到状态栏与手势导航条之下。
     *
     * 系统栏高度不再作为 padding 加到根视图——那样 WebView 会整体被推下来，
     * 状态栏与手势条区域只能露出窗口底色（自定义背景图铺上去就是两条白边）。
     * 改为把高度写进 CSS 变量（--itdc-inset-*）交给前端留白：背景层因此能一直
     * 铺到屏幕边缘，内容也不会被状态栏/手势条压住。
     */
    private void applySystemBarInsets() {
        // 监听挂在 decorView 上：insets 从窗口往下派发，挂在 content 上时可能已被上游
        // 消费/裁剪（实测拿到 0），decorView 拿到的是窗口的原始值
        final View root = getWindow().getDecorView();
        if (root == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            lastInsetTop = bars.top;
            lastInsetRight = bars.right;
            lastInsetBottom = bars.bottom;
            lastInsetLeft = bars.left;
            pushSystemBarInsetsToWeb();
            // edge-to-edge 之后系统不再替我们 adjustResize：软键盘弹出时手动把
            // WebView 的高度压到键盘上方（等价于老的 adjustResize），否则键盘会
            // 盖住输入框、浏览器也不会把焦点元素滚进可视区。悬浮键盘不报 ime inset，
            // 此时 padding 为 0，不影响布局。
            applyImePadding(windowInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom);
            // 原样返回：子视图（WebView）不重复取用，同时保留后续 IME 等其它类型 insets 的传递
            return windowInsets;
        });
    }

    /** 键盘高度（px）→ WebView 底部 padding；值没变时不重复设置，避免抖动 */
    private void applyImePadding(int imeBottomPx) {
        try {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView == null) return;
            if (webView.getPaddingBottom() != imeBottomPx) {
                webView.setPadding(0, 0, 0, imeBottomPx);
            }
        } catch (Exception e) {
            Log.e(TAG, "applyImePadding failed", e);
        }
    }

    /**
     * 页面加载完成后补推一次系统栏高度。
     *
     * insets 监听在首次布局时就会触发，那时页面往往还没加载完，注入的 CSS 变量
     * 会随 about:blank 一起丢掉；这里用 Capacitor 自己的 BridgeWebViewClient
     * 子类在 onPageFinished 再推一次，保证刷新/重载后依然正确。
     */
    private void hookInsetsAfterPageLoad() {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            if (bridge.getWebViewClient() == null) return;
            bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    pushSystemBarInsetsToWeb();
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "hookInsetsAfterPageLoad failed", e);
        }
    }

    /** 把系统栏高度按 CSS 像素写进 :root 的 CSS 变量，供前端留白用 */
    private void pushSystemBarInsetsToWeb() {
        if (lastInsetTop < 0) return;
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0) return;
        String js = String.format(
                Locale.US,
                "document.documentElement.style.setProperty('--itdc-inset-top','%.2fpx');"
                        + "document.documentElement.style.setProperty('--itdc-inset-right','%.2fpx');"
                        + "document.documentElement.style.setProperty('--itdc-inset-bottom','%.2fpx');"
                        + "document.documentElement.style.setProperty('--itdc-inset-left','%.2fpx');",
                lastInsetTop / density, lastInsetRight / density,
                lastInsetBottom / density, lastInsetLeft / density);
        dispatchToWebView(js);
    }
}
