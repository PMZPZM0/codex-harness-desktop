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
 * ⛔ 服务器地址**内置在 flavor 里**（BuildConfig.BASE_URL）：装完只要输 6 位连接码。
 *    Codex Harness 版连 remote.ppz123.asia；PPcode 版连 ppcode.pptoken.cc:18443。
 * ⛔ 扫码保留：扫到的整条链接会覆盖内置地址（换域名/临时调试都还能用）。
 * ⛔ 这里不重写界面：会话列表 / 对话 / 自动登录 / 流式全部由电脑端那一页提供。
 * ⛔ 只允许 https：本机 usesCleartextTraffic=false。
 */
public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "remote";
    private static final String KEY_BASE = "server_base";
    private static final String KEY_CONNECTED = "connected_once";

    private WebView web;
    private View setup;
    private EditText code;
    private TextView hint;
    private TextView serverInfo;
    private String baseUrl;

    private final ActivityResultLauncher<ScanOptions> scanLauncher =
            registerForActivityResult(new ScanContract(), result -> {
                if (result.getContents() == null) return;
                String scanned = normalize(result.getContents());
                if (!scanned.startsWith("https://")) {
                    // 扫到的不是链接（例如只扫到一串数字）就当连接码用
                    String digits = scanned.replaceAll("[^0-9]", "");
                    if (digits.length() == 6) code.setText(digits);
                    else showSetup("二维码内容不是 https 链接：" + scanned);
                    return;
                }
                baseUrl = scanned;
                prefs().edit().putString(KEY_BASE, baseUrl).apply();
                updateServerInfo();
                openChat(code.getText().toString());
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        web = findViewById(R.id.web);
        setup = findViewById(R.id.setup);
        code = findViewById(R.id.code);
        hint = findViewById(R.id.hint);
        serverInfo = findViewById(R.id.server_info);
        findViewById(R.id.connect).setOnClickListener(v -> openChat(code.getText().toString()));
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
                String host = Uri.parse(baseUrl).getHost();
                String target = uri.getHost();
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

        baseUrl = prefs().getString(KEY_BASE, BuildConfig.BASE_URL);
        updateServerInfo();
        // 连过一次之后，再打开 App 直接进对话：不带连接码，页面会用设备秘密自动登录；
        // 电脑端在线就永远是对话页，不需要重新连接。
        if (prefs().getBoolean(KEY_CONNECTED, false)) resumeSession();
        else showSetup("");
    }

    /** 重进应用直连：不要求连接码（凭据失效时页面会回到配对页，再输一次码即可）。 */
    private void resumeSession() {
        hint.setText("");
        setup.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(baseUrl);
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

    private void updateServerInfo() {
        Uri uri = Uri.parse(baseUrl);
        String host = uri.getHost() == null ? baseUrl : uri.getHost();
        int port = uri.getPort();
        serverInfo.setText(getString(R.string.server_prefix) + host + (port > 0 ? ":" + port : ""));
    }

    /** 连接码走 URL 片段（#code=…）：不会进服务器日志，配对页读到就自动提交。 */
    private void openChat(String rawCode) {
        String digits = rawCode == null ? "" : rawCode.replaceAll("[^0-9]", "");
        if (digits.length() != 6) {
            showSetup("请输入电脑上显示的 6 位连接码");
            return;
        }
        hint.setText("");
        prefs().edit().putBoolean(KEY_CONNECTED, true).apply();
        setup.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(baseUrl + "/#code=" + digits);
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
        hint.setText(message == null ? "" : message);
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
        // 回到连接码页：换连接码 / 换服务器都不需要清数据重装
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
