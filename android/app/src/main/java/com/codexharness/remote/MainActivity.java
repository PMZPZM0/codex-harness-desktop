package com.codexharness.remote;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AppCompatActivity;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

/**
 * 手机远控的安卓壳：一个 WebView 加载电脑端生成的手机页面（/r/mobile）。
 *
 * ⛔ 这里**不重写界面**：会话列表 / 对话 / 自动登录 / 流式全部由电脑端那一页提供，
 *    壳只负责「存地址 / 扫码 / 承载 WebView / 接管返回键」。
 * ⛔ 只允许 https：本机 usesCleartextTraffic=false，http 地址会被系统直接拦。
 *    局域网明文调试不是本版目标（走自建中转拿 https）。
 */
public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "remote";
    private static final String KEY_URL = "server_url";

    private WebView web;
    private View setup;
    private EditText input;
    private TextView hint;
    private String host;

    private final ActivityResultLauncher<ScanOptions> scanLauncher =
            registerForActivityResult(new ScanContract(), result -> {
                if (result.getContents() != null) {
                    input.setText(normalize(result.getContents()));
                    connect();
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        web = findViewById(R.id.web);
        setup = findViewById(R.id.setup);
        input = findViewById(R.id.url);
        hint = findViewById(R.id.hint);
        findViewById(R.id.connect).setOnClickListener(v -> connect());
        findViewById(R.id.scan).setOnClickListener(v -> startScan());

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " CodexHarnessRemote/0.1.0");
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String target = uri.getHost();
                // 同站点留在壳里；别的站点交给系统浏览器，别把任意网页塞进这个 WebView
                if (target != null && host != null && target.equalsIgnoreCase(host)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // 没有浏览器可接管时保持当前页
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("http")) {
                    setup.setVisibility(View.GONE);
                    web.setVisibility(View.VISIBLE);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showSetup("连不上：" + error.getDescription());
                }
            }
        });

        String saved = prefs().getString(KEY_URL, "");
        if (!TextUtils.isEmpty(saved)) input.setText(saved);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private String normalize(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return "";
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "https://" + value;
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    private void connect() {
        String url = normalize(input.getText().toString());
        if (url.isEmpty()) {
            showSetup("先填服务器地址，或点「扫码」");
            return;
        }
        if (!url.startsWith("https://")) {
            showSetup("这一版只支持 https 地址：先在服务器上配好中转，再填 https://你的域名");
            return;
        }
        Uri uri = Uri.parse(url);
        if (uri.getHost() == null) {
            showSetup("地址看起来不对：" + url);
            return;
        }
        host = uri.getHost();
        prefs().edit().putString(KEY_URL, url).apply();
        hint.setText("");
        setup.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(url);
    }

    private void startScan() {
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
        options.setPrompt("对准电脑端「手机远控」里的二维码");
        options.setBeepEnabled(false);
        options.setOrientationLocked(false);
        scanLauncher.launch(options);
    }

    private void showSetup(String message) {
        setup.setVisibility(View.VISIBLE);
        web.setVisibility(View.GONE);
        hint.setText(message);
    }

    @Override
    public void onBackPressed() {
        if (setup.getVisibility() == View.VISIBLE) {
            super.onBackPressed();
            return;
        }
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        // 回到地址页：换服务器不需要清数据重装
        showSetup("");
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
