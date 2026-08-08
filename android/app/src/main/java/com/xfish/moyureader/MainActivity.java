package com.xfish.moyureader;

import android.os.Bundle;
import android.view.KeyEvent;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean readingActive;
    private boolean immersive;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MoyuNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    public void setReadingActive(boolean active) {
        readingActive = active;
    }

    public void setMoyuImmersive(boolean active) {
        immersive = active;
        applyImmersiveMode();
    }

    private void applyImmersiveMode() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, !immersive);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (immersive) {
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (immersive) applyImmersiveMode();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        if (readingActive && event.getAction() == KeyEvent.ACTION_DOWN
                && (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            String direction = keyCode == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('moyu:volume-key',{detail:{direction:'" + direction + "'}}));",
                        null
                );
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
