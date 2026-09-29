package io.github.adaquart.itdc;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBarInsets();
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
