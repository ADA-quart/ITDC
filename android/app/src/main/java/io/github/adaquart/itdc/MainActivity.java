package io.github.adaquart.itdc;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

import io.github.adaquart.itdc.widget.ITDCWidgetProvider;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "ITDCMainActivity";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBarInsets();
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
     * WebView 不解析 env(safe-area-inset-*)，因此在这里把系统栏高度作为 padding 加到根视图，
     * 避免顶部内容被状态栏遮挡、底部导航被手势条压住。
     */
    private void applySystemBarInsets() {
        final View root = findViewById(android.R.id.content);
        if (root == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            // 原样返回：子视图（WebView）不重复取用，同时保留后续 IME 等其它类型 insets 的传递
            return windowInsets;
        });
    }
}
