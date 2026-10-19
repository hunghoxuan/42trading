package com.mozasolution.pos;

import android.Manifest;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends ComponentActivity {
    private static final int CAMERA_PERMISSION = 10, CHOOSE_FILE = 11, SAVE_FILE = 12;
    private static final int MAX_FILE_BYTES = 20 * 1024 * 1024;
    private final TrustedOrigin trusted = new TrustedOrigin(BuildConfig.POS_URL);
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private WebView web;
    private WebView printWeb;
    private PrintJob printJob;
    private LinearLayout errorPanel;
    private PermissionRequest cameraRequest;
    private ValueCallback<Uri[]> chooser;
    private PendingDownload pendingDownload;
    private String retryUrl = BuildConfig.POS_URL;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 24, 32));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        errorPanel.setPadding(padding, padding, padding, padding);
        errorPanel.setBackgroundColor(Color.rgb(16, 24, 32));
        TextView errorText = new TextView(this);
        errorText.setText(R.string.connection_error);
        errorText.setTextSize(17);
        errorText.setTextColor(Color.WHITE);
        errorText.setGravity(Gravity.CENTER);
        errorPanel.addView(errorText);
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(view -> { errorPanel.setVisibility(View.GONE); web.loadUrl(retryUrl); });
        errorPanel.addView(retry);
        errorPanel.setVisibility(View.GONE);
        root.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { handleBack(); }
        });

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " 42TradePOSAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (trusted.allows(url)) return false;
                if (request.isForMainFrame() && request.hasGesture()
                        && (url.startsWith("https://") || url.startsWith("mailto:") || url.startsWith("tel:"))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); }
                    catch (ActivityNotFoundException ignored) { toast(R.string.connection_error); }
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (trusted.allows(url)) retryUrl = url;
                if (cameraRequest != null) { cameraRequest.deny(); cameraRequest = null; }
            }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) errorPanel.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) errorPanel.setVisibility(View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!trusted.allows(request.getOrigin().toString()) || !trusted.allows(web.getUrl())
                        || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                    request.deny(); return;
                }
                if (cameraRequest != null) cameraRequest.deny();
                cameraRequest = request;
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) grantCamera();
                else requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (cameraRequest == request) cameraRequest = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                try { startActivityForResult(params.createIntent(), CHOOSE_FILE); }
                catch (ActivityNotFoundException error) { chooser.onReceiveValue(null); chooser = null; toast(R.string.file_unavailable); }
                return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        // Unlike addJavascriptInterface, this bridge is available only on our configured origin.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "PosAndroid", Collections.singleton(trusted.rule()),
                    (view, message, sourceOrigin, isMainFrame, reply) -> {
                        if (!isMainFrame || !trusted.allows(sourceOrigin.toString()) || !trusted.allows(web.getUrl())) return;
                        try {
                            String raw = message.getData();
                            if (raw == null || raw.length() > MAX_FILE_BYTES * 4 / 3 + 4096) throw new IllegalArgumentException();
                            JSONObject data = new JSONObject(raw);
                            if ("print".equals(data.optString("type"))) printHtml(data.getString("html"));
                            else if ("saveFile".equals(data.optString("type"))) {
                                byte[] bytes = Base64.decode(data.getString("base64"), Base64.DEFAULT);
                                if (bytes.length > MAX_FILE_BYTES) throw new IllegalArgumentException();
                                chooseDestination(new PendingDownload(data.optString("filename"), data.optString("mime", "application/octet-stream"), bytes));
                            }
                        } catch (Exception error) { toast(R.string.save_error); }
                    });
        } else toast(R.string.webview_update);
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (!trusted.allows(url) || !trusted.allows(web.getUrl())) { toast(R.string.save_error); return; }
            PendingDownload download = new PendingDownload(URLUtil.guessFileName(url, disposition, mime), mime, null);
            download.url = url;
            download.cookie = CookieManager.getInstance().getCookie(url);
            download.userAgent = userAgent;
            chooseDestination(download);
        });
        // Reuse WebView state without clearing IndexedDB or pending offline sales.
        if (state == null || web.restoreState(state) == null) web.loadUrl(BuildConfig.POS_URL);
    }

    private void grantCamera() {
        PermissionRequest request = cameraRequest;
        cameraRequest = null;
        if (request == null) return;
        if (trusted.allows(web.getUrl()) && trusted.allows(request.getOrigin().toString()))
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else request.deny();
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != CAMERA_PERMISSION) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) grantCamera();
        else {
            if (cameraRequest != null) { cameraRequest.deny(); cameraRequest = null; }
            toast(R.string.camera_denied);
        }
    }

    private void chooseDestination(PendingDownload download) {
        if (pendingDownload != null) { toast(R.string.save_error); return; }
        pendingDownload = download;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(download.mime).putExtra(Intent.EXTRA_TITLE, TrustedOrigin.safeFilename(download.filename));
        try { startActivityForResult(intent, SAVE_FILE); }
        catch (ActivityNotFoundException error) { pendingDownload = null; toast(R.string.file_unavailable); }
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == CHOOSE_FILE && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            chooser = null;
        }
        if (code == SAVE_FILE) {
            PendingDownload download = pendingDownload;
            pendingDownload = null;
            if (result == RESULT_OK && data != null && data.getData() != null && download != null) {
                Uri destination = data.getData();
                files.execute(() -> saveDownload(download, destination));
            }
        }
    }

    private void saveDownload(PendingDownload download, Uri destination) {
        HttpURLConnection connection = null;
        try (OutputStream output = getContentResolver().openOutputStream(destination, "wt")) {
            if (output == null) throw new IllegalStateException();
            if (download.bytes != null) output.write(download.bytes);
            else {
                connection = (HttpURLConnection) new URL(download.url).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                if (download.cookie != null) connection.setRequestProperty("Cookie", download.cookie);
                if (download.userAgent != null) connection.setRequestProperty("User-Agent", download.userAgent);
                if (connection.getResponseCode() != 200) throw new IllegalStateException();
                try (InputStream input = connection.getInputStream()) {
                    byte[] buffer = new byte[8192];
                    int count, total = 0;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > MAX_FILE_BYTES) throw new IllegalStateException();
                        output.write(buffer, 0, count);
                    }
                }
            }
            runOnUiThread(() -> toast(R.string.saved));
        } catch (Exception error) { runOnUiThread(() -> toast(R.string.save_error)); }
        finally { if (connection != null) connection.disconnect(); }
    }

    private void printHtml(String html) {
        if (html.length() > 2 * 1024 * 1024 || (printJob != null && !printJob.isCompleted()
                && !printJob.isCancelled() && !printJob.isFailed())) { toast(R.string.print_error); return; }
        if (printWeb != null) printWeb.destroy();
        printWeb = new WebView(this);
        printWeb.getSettings().setJavaScriptEnabled(false);
        printWeb.getSettings().setAllowFileAccess(false);
        printWeb.getSettings().setBlockNetworkLoads(true);
        printWeb.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                PrintManager manager = (PrintManager) getSystemService(PRINT_SERVICE);
                if (manager == null) { toast(R.string.print_error); return; }
                PrintDocumentAdapter adapter = view.createPrintDocumentAdapter("42Trade POS Invoice");
                try {
                    printJob = manager.print("42Trade POS Invoice", adapter,
                            new PrintAttributes.Builder().setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME).build());
                } catch (RuntimeException error) { toast(R.string.print_error); }
            }
        });
        printWeb.loadDataWithBaseURL(trusted.rule() + "/", html, "text/html", StandardCharsets.UTF_8.name(), null);
    }

    private void toast(int message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); web.saveState(state); }
    @Override protected void onPause() { web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    private void handleBack() {
        if (errorPanel.getVisibility() == View.VISIBLE) errorPanel.setVisibility(View.GONE);
        else if (web.canGoBack()) web.goBack();
        // Keep the live WebView when leaving the root screen, just like the Home button.
        else moveTaskToBack(true);
    }
    @Override protected void onDestroy() {
        if (cameraRequest != null) cameraRequest.deny();
        if (chooser != null) chooser.onReceiveValue(null);
        files.shutdown();
        if (printWeb != null) printWeb.destroy();
        web.destroy();
        super.onDestroy();
    }
    private static final class PendingDownload {
        final String filename, mime;
        final byte[] bytes;
        String url, cookie, userAgent;
        PendingDownload(String filename, String mime, byte[] bytes) {
            this.filename = filename;
            this.mime = mime == null || mime.trim().isEmpty() ? "application/octet-stream" : mime;
            this.bytes = bytes;
        }
    }
}
