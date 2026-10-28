package com.codexharness.remote;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Base64;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.ValueCallback;
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
    private static final int FILE_CHOOSER_REQUEST = 2001;

    /** WebView 文件选择回调（＋ → 图片）。⚠️ 一次选择期间只允许一个挂起回调。 */
    private ValueCallback<Uri[]> fileChooserCallback;

    private WebView web;
    private View setup;
    private EditText code;
    private TextView hint;
    private String baseUrl;

    private final ActivityResultLauncher<ScanOptions> scanLauncher =
            registerForActivityResult(new ScanContract(), result -> {
                if (result.getContents() == null) return;
                String raw = result.getContents().trim();
                // ⛔ 先判纯数字再 normalize：normalize 会给任意串补 https://，
                //    放后面的话「扫到 6 位码」这条永远走不到（会去加载 https://123456）。
                String digitsOfScan = raw.replaceAll("[^0-9]", "");
                if (!raw.toLowerCase(java.util.Locale.ROOT).startsWith("http") && digitsOfScan.length() == 6) {
                    code.setText(digitsOfScan);
                    openChat(digitsOfScan);
                    return;
                }
                String scanned = originOf(normalize(raw));
                if (scanned.isEmpty()) {
                    showSetup("二维码内容不是 https 链接：" + raw);
                    return;
                }
                baseUrl = scanned;
                prefs().edit().putString(KEY_BASE, baseUrl).apply();
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

        // ⛔ 不实现 onShowFileChooser 的话，页面里 <input type=file> 点了没反应 —— 手机相册选图全靠它
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择图片"), FILE_CHOOSER_REQUEST);
                } catch (Exception error) {
                    fileChooserCallback = null;
                    showSetup("没有可以选图的应用");
                    return false;
                }
                return true;
            }
        });

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

        String fallback = decodeBase(BuildConfig.BASE_URL_B64);
        String stored = prefs().getString(KEY_BASE, "");
        String origin = originOf(stored);
        baseUrl = origin.isEmpty() ? fallback : origin;
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
        web.loadUrl(baseUrl + "/r/mobile");
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private String normalize(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return "";
        if (!value.toLowerCase(java.util.Locale.ROOT).startsWith("http://")
                && !value.toLowerCase(java.util.Locale.ROOT).startsWith("https://")) {
            value = "https://" + value;
        }
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    /** 只留 scheme://host[:port]：二维码里常带 `?p=1` 之类参数，拼路径前必须剥掉。 */
    private String originOf(String url) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return "";
        if (!"https".equalsIgnoreCase(scheme)) return "";
        return scheme.toLowerCase(java.util.Locale.ROOT) + "://" + host + (uri.getPort() > 0 ? ":" + uri.getPort() : "");
    }

    /** 内置中转地址在 APK 里是 XOR+base64：界面上不显示、strings 里也搜不到明文。 */
    private static String decodeBase(String encoded) {
        byte[] raw = Base64.decode(encoded, Base64.NO_WRAP);
        byte[] out = new byte[raw.length];
        for (int i = 0; i < raw.length; i++) out[i] = (byte) (raw[i] ^ 0x5a);
        return new String(out, java.nio.charset.StandardCharsets.UTF_8);
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
        // ⛔ 直接开 /r/mobile：根路径会 302 一次，没必要（且避免刷新时把码丢掉）
        web.loadUrl(baseUrl + "/r/mobile#code=" + digits);
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
        // 先让页面收掉面板 / ＋ 菜单再退出 —— 否则按返回直接把人踢回连接码页
        web.evaluateJavascript("(window.__remoteBack && window.__remoteBack()) ? '1' : '0'", value -> {
            if ("\"1\"".equals(value)) return;
            runOnUiThread(() -> {
                if (web != null && web.canGoBack()) {
                    web.goBack();
                    return;
                }
                // 回到连接码页：换连接码 / 换服务器都不需要清数据重装
                showSetup("");
            });
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != FILE_CHOOSER_REQUEST) { super.onActivityResult(requestCode, resultCode, data); return; }
        ValueCallback<Uri[]> callback = fileChooserCallback;
        fileChooserCallback = null;
        if (callback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                // 多选：上限 4 张，与页面端一致
                int count = Math.min(data.getClipData().getItemCount(), 4);
                results = new Uri[count];
                for (int i = 0; i < count; i++) results[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                results = new Uri[]{ data.getData() };
            }
        }
        callback.onReceiveValue(results);
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
