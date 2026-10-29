package com.codexharness.remote;

import android.app.DownloadManager;
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
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

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
    /** 配对进行中：按钮禁用，提示「正在配对 / 等待电脑端批准」 */
    private volatile boolean busy;

    private final ActivityResultLauncher<ScanOptions> scanLauncher =
            registerForActivityResult(new ScanContract(), result -> {
                if (result.getContents() == null) return;
                String raw = result.getContents().trim();
                // ⛔ 先判纯数字再 normalize：normalize 会给任意串补 https://，
                //    放后面的话「扫到 6 位码」这条永远走不到（会去加载 https://123456）。
                String digitsOfScan = raw.replaceAll("[^0-9]", "");
                if (!raw.toLowerCase(java.util.Locale.ROOT).startsWith("http") && digitsOfScan.length() == 6) {
                    if (code != null) code.setText(digitsOfScan);
                    startConnect(digitsOfScan);
                    return;
                }
                /* 10-29：中转地址是 https://<域名>/t/<设备ID>，必须**连路径前缀一起存**
                   （只存 origin 会丢设备 ID，打开就是 404）。没有 /r/ 的链接仍只取 origin。 */
                String scanned = baseOf(normalize(raw));
                if (scanned.isEmpty()) {
                    showSetup("二维码内容不是 https 链接：" + raw);
                    return;
                }
                baseUrl = scanned;
                prefs().edit().putString(KEY_BASE, baseUrl).apply();
                /* 二维码里带连接码（#code=）⇒ 扫完直接配对；没有码就把码填好等用户输。
                   ⛔ 配对全过程在 App 内完成，不再跳网页配对页。 */
                String scannedCode = codeFromFragment(raw);
                if (code != null) code.setText(scannedCode);
                if (!scannedCode.isEmpty()) startConnect(scannedCode);
                else showSetup("已连上电脑地址，请输入 6 位连接码");
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        web = findViewById(R.id.web);
        setup = findViewById(R.id.setup);
        code = findViewById(R.id.code);
        hint = findViewById(R.id.hint);
        findViewById(R.id.connect).setOnClickListener(v -> startConnect(code == null ? "" : code.getText().toString()));
        findViewById(R.id.scan).setOnClickListener(v -> startScan());

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " CodexHarnessRemote/0.1.6");
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        // 页面导航到 /apk 这类下载地址时交给系统下载管理器（带 cookie 走中转），装完通知栏点开即装
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                if (mimetype != null && mimetype.length() > 0) request.setMimeType(mimetype);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                String name = (contentDisposition != null && contentDisposition.contains("filename=\""))
                        ? contentDisposition.split("filename=\"")[1].split("\"")[0] : "CodexRemote.apk";
                request.setDestinationInExternalFilesDir(this, android.os.Environment.DIRECTORY_DOWNLOADS, name);
                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                if (manager != null) manager.enqueue(request);
            } catch (Exception ignored) {
                // 下载管理器不可用就退回系统浏览器
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored2) { }
            }
        });

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
                if (url == null || !url.startsWith("http")) return;
                setup.setVisibility(View.GONE);
                web.setVisibility(View.VISIBLE);
                /* 把设备秘密同步给页面：万一 cookie 被清，页面自己的 autoLogin 还能救回来
                   （前缀 = /t/<设备ID>；没有中转前缀时为空串） */
                try {
                    String secret = savedSecret();
                    int at = url.indexOf("/t/");
                    int chat = url.indexOf("/r/");
                    if (!secret.isEmpty() && at >= 0 && chat > at) {
                        String prefix = url.substring(at, chat);
                        String js = "try{localStorage.setItem('chm-pair-secret'+"
                                + JSONObject.quote(prefix) + "," + JSONObject.quote(secret) + ");"
                                + "localStorage.setItem('chm-pair-device'+" + JSONObject.quote(prefix) + ","
                                + JSONObject.quote(deviceId()) + ");}catch(e){}";
                        view.evaluateJavascript(js, null);
                    }
                } catch (Exception ignored) { /* 注入失败不影响使用 */ }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showSetup("连不上：" + error.getDescription());
                }
            }

            // ⛔ 502/4xx 走的是 onReceivedHttpError（不是 onReceivedError）——不接的话手机上就是
            //    一整页英文“网页无法打开 / ERR_HTTP_RESPONSE_CODE_FAILURE”，看不出是电脑端没开
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (!request.isForMainFrame()) return;
                int code = response.getStatusCode();
                if (code >= 400) {
                    showSetup(code == 502
                            ? "连不上：电脑端应用没打开，或远控服务没启动（HTTP 502）"
                            : "连不上：服务返回 HTTP " + code);
                }
            }
        });

        String fallback = decodeBase(BuildConfig.BASE_URL_B64);
        String stored = prefs().getString(KEY_BASE, "");
        /* 存的值可能带中转前缀（/t/<设备ID>）：整段 baseOf 才算完整入口 */
        String origin = baseOf(stored);
        baseUrl = origin.isEmpty() ? fallback : origin;
        // 连过一次之后，再打开 App 直接进对话：不带连接码，页面会用设备秘密自动登录；
        // 电脑端在线就永远是对话页，不需要重新连接。
        /* 连过一次：App 自己用设备秘密换新 cookie 再进对话（⛔ 不再让网页配对页出现） */
        if (prefs().getBoolean(KEY_CONNECTED, false)) autoLogin();
        else showSetup("");
    }

    /** 已拿到 cookie：进对话页 */
    private void enterChat() {
        busy = false;
        hint.setText("");
        prefs().edit().putBoolean(KEY_CONNECTED, true).apply();
        setup.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        /* ⛔ 直接开 /r/mobile：根路径会 302 一次，没必要。
           延迟一拍再加载：刚 setCookie 的凭据要确保已进 WebView 的 cookie store，
           否则首帧可能 401 → 又回到配对页（审查发现）。 */
        web.postDelayed(() -> web.loadUrl(baseUrl + "/r/mobile"), 150);
    }

    /** 二维码里的 #code=123456（有就自动配对，没有就让用户手输） */
    private String codeFromFragment(String url) {
        try {
            String fragment = Uri.parse(url).getFragment();
            if (fragment == null) return "";
            java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("code=(\\d{6})").matcher(fragment);
            return matcher.find() ? matcher.group(1) : "";
        } catch (Exception error) {
            return "";
        }
    }

    private String deviceId() {
        String id = prefs().getString("device_id", "");
        if (id.isEmpty()) {
            id = "dev-" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            prefs().edit().putString("device_id", id).apply();
        }
        return id;
    }

    private String deviceName() {
        String name = android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL;
        return name.length() > 40 ? name.substring(0, 40) : name;
    }

    private String secretKey() {
        return "secret:" + baseUrl;
    }

    private String savedSecret() {
        return prefs().getString(secretKey(), "");
    }

    private void saveSecret(String value) {
        prefs().edit().putString(secretKey(), value).apply();
    }

    private void setBusy(boolean value, String text) {
        busy = value;
        if (hint != null) hint.setText(text == null ? "" : text);
        View connectButton = findViewById(R.id.connect);
        View scanButton = findViewById(R.id.scan);
        if (connectButton != null) connectButton.setEnabled(!value);
        if (scanButton != null) scanButton.setEnabled(!value);
    }

    /** 手输 / 扫到的连接码 → 在 App 内完成配对（配对过程也显示在这里，⛔ 不跳网页配对页） */
    private void startConnect(String rawCode) {
        if (busy) return;
        String digits = rawCode == null ? "" : rawCode.replaceAll("[^0-9]", "");
        if (digits.length() != 6) { showSetup("请输入电脑上显示的 6 位连接码"); return; }
        if (baseUrl == null || baseUrl.isEmpty()) { showSetup("还没有电脑地址：请先扫码"); return; }
        if (code != null) code.setText(digits);
        setBusy(true, "正在配对…");
        new Thread(() -> {
            try {
                List<String> jar = new ArrayList<>();
                JSONObject body = new JSONObject()
                        .put("code", digits)
                        .put("deviceId", deviceId())
                        .put("deviceName", deviceName())
                        .put("deviceSecret", savedSecret());
                HttpResult result = http("POST", "/api/pair", body.toString(), jar);
                JSONObject json = new JSONObject(result.body);
                if (!json.optBoolean("ok")) throw new Exception(json.optString("error", "配对失败"));
                String secret = json.optString("deviceSecret", "");
                if (!secret.isEmpty()) saveSecret(secret);
                applyCookies(result.cookies);
                if (json.optBoolean("approved")) { runOnUiThread(this::enterChat); return; }
                String rid = json.optString("rid", "");
                runOnUiThread(() -> setBusy(true, "配对码正确，等待电脑端批准…"));
                pollApproval(rid, jar);
            } catch (Exception error) {
                runOnUiThread(() -> setBusy(false, "配对失败：" + String.valueOf(error.getMessage())));
            }
        }).start();
    }

    private void pollApproval(String rid, List<String> jar) {
        long deadline = System.currentTimeMillis() + 120_000;
        while (System.currentTimeMillis() < deadline) {
            try { Thread.sleep(1500); } catch (InterruptedException interrupted) { return; }
            try {
                HttpResult result = http("GET", "/api/pair-status?rid=" + Uri.encode(rid), null, jar);
                JSONObject json = new JSONObject(result.body);
                String status = json.optString("status", "");
                if ("approved".equals(status)) {
                    String secret = json.optString("deviceSecret", "");
                    if (!secret.isEmpty()) saveSecret(secret);
                    applyCookies(result.cookies);
                    runOnUiThread(this::enterChat);
                    return;
                }
                if ("denied".equals(status)) { runOnUiThread(() -> setBusy(false, "电脑端拒绝了这次连接")); return; }
                if ("expired".equals(status)) { runOnUiThread(() -> setBusy(false, "配对码已过期，请刷新电脑端二维码后重试")); return; }
            } catch (Exception ignored) { /* 网络抖动：继续轮询 */ }
        }
        runOnUiThread(() -> setBusy(false, "等待批准超时，请重试"));
    }

    /** 重开应用：用设备秘密换新 cookie 再进对话（accessToken 每次启动都重生成） */
    private void autoLogin() {
        if (savedSecret().isEmpty()) { showSetup(""); return; }
        setBusy(true, "正在自动登录…");
        new Thread(() -> {
            String failure = "连接已失效，请重新输入连接码或扫码";
            for (int attempt = 0; attempt < 3; attempt += 1) {
                try {
                    List<String> jar = new ArrayList<>();
                    JSONObject body = new JSONObject()
                            .put("deviceId", deviceId())
                            .put("deviceName", deviceName())
                            .put("deviceSecret", savedSecret());
                    HttpResult result = http("POST", "/api/pair", body.toString(), jar);
                    JSONObject json = new JSONObject(result.body);
                    if (json.optBoolean("ok") && json.optBoolean("approved")) {
                        applyCookies(result.cookies);
                        runOnUiThread(this::enterChat);
                        return;
                    }
                    if (!json.optBoolean("ok")) {
                        /* 服务器明确回了「不行」= 设备秘密失效，重试没意义，直接让人重新配对 */
                        failure = json.optString("error", "连接已失效，请重新输入连接码或扫码");
                        break;
                    }
                    failure = "电脑还没准备好，请稍后重试";
                } catch (Exception error) {
                    /* ⛔ 冷启动时中转还没连上（通常 1~2 秒）：重试几次再下结论，
                       否则用户会被要求白白重新输一次码（审查发现） */
                    failure = "连不上电脑：请确认电脑端应用在线，然后重试";
                }
                try { Thread.sleep(1500); } catch (InterruptedException interrupted) { return; }
            }
            final String message = failure;
            runOnUiThread(() -> { setBusy(false, message); showSetup(message); });
        }).start();
    }

    private void applyCookies(List<String> cookies) {
        CookieManager manager = CookieManager.getInstance();
        for (String header : cookies) {
            try { manager.setCookie(baseUrl, header); } catch (Exception ignored) { }
        }
        manager.flush();
    }

    private static class HttpResult {
        int status;
        String body;
        List<String> cookies = new ArrayList<>();
    }

    private HttpResult http(String method, String path, String json, List<String> jar) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(20_000);
        connection.setRequestProperty("accept", "application/json");
        if (!jar.isEmpty()) connection.setRequestProperty("Cookie", TextUtils.join("; ", jar));
        if (json != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("content-type", "application/json");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(json.getBytes(StandardCharsets.UTF_8));
            }
        }
        HttpResult result = new HttpResult();
        result.status = connection.getResponseCode();
        InputStream stream = result.status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        StringBuilder text = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) text.append(line);
            }
        }
        result.body = text.toString();
        for (java.util.Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
            if (entry.getKey() == null || !"set-cookie".equalsIgnoreCase(entry.getKey())) continue;
            for (String value : entry.getValue()) {
                result.cookies.add(value);
                /* 同名 cookie 只留最新一条（pair 与 pair-status 都会下发，重复会让服务端解析到旧值） */
                String pair = value.split(";")[0];
                String name = pair.split("=")[0];
                jar.removeIf((existing) -> existing.split("=")[0].equals(name));
                jar.add(pair);
            }
        }
        connection.disconnect();
        return result;
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

    /** 完整入口 = scheme://host[:port] + 中转路径前缀（/t/<设备ID>）。
     *  ⛔ 只取 origin 会丢设备 ID（打开就是 404）；没有 /r/ 的普通链接仍只取 origin。 */
    private String baseOf(String url) {
        String origin = originOf(url);
        if (origin.isEmpty()) return "";
        Uri uri = Uri.parse(url);
        String path = uri.getPath() == null ? "" : uri.getPath();
        int cut = path.indexOf("/r/");
        if (cut > 0) return origin + path.substring(0, cut);
        return origin;
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

    private void startScan() {
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
        options.setPrompt("对准电脑端「手机远控」里的二维码");
        options.setBeepEnabled(false);
        options.setOrientationLocked(true); // 竖屏扫码（用户令：不要横屏）
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
