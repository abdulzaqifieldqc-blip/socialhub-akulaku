package id.akulaku.socialhub

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import android.widget.Button
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

/**
 * Pembungkus WebView untuk SocialHub Akulaku.
 * Keamanan: hanya HTTPS ke host BASE_URL dimuat di WebView; tautan lain dibuka di Custom Tabs;
 * tanpa JavaScript bridge, tanpa akses file lokal, tanpa mixed content, validasi SSL tidak pernah dimatikan.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private lateinit var errorView: View
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val base: Uri = Uri.parse(BuildConfig.BASE_URL)

    private val picker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val uris = WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data)
        fileCallback?.onReceiveValue(uris)
        fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        progress = findViewById(R.id.progress)
        errorView = findViewById(R.id.error)
        findViewById<Button>(R.id.retry).setOnClickListener {
            errorView.visibility = View.GONE
            if (web.url.isNullOrEmpty()) web.loadUrl(base.toString()) else web.reload()
        }
        setupWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    /** Buka halaman awal, atau lanjutkan hasil OAuth dari socialhub://oauth?... */
    private fun handleIntent(i: Intent?) {
        val data = i?.data
        if (data != null && data.scheme == "socialhub" && data.host == "oauth") {
            val q = data.encodedQuery.orEmpty()
            web.loadUrl(if (q.isEmpty()) "$base/" else "$base/?$q")
        } else if (web.url.isNullOrEmpty()) {
            web.loadUrl(base.toString())
        }
    }

    private fun isInternal(u: Uri) = u.scheme == "https" && u.host.equals(base.host, ignoreCase = true)

    private fun openExternal(u: Uri) {
        try {
            CustomTabsIntent.Builder().build().launchUrl(this, u)
        } catch (e: ActivityNotFoundException) {
            try { startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)) } catch (_: ActivityNotFoundException) {}
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.settings.apply {
            javaScriptEnabled = true            // dibutuhkan aplikasi web
            domStorageEnabled = true            // sesi login (localStorage)
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            userAgentString = userAgentString + " SocialHubApp/" + BuildConfig.VERSION_NAME
        }
        web.setDownloadListener { url, _, _, _, _ -> openExternal(Uri.parse(url)) }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                return when {
                    isInternal(u) -> false
                    u.scheme == "socialhub" -> { handleIntent(Intent(Intent.ACTION_VIEW, u)); true }
                    u.scheme == "https" || u.scheme == "http" -> { openExternal(u); true }   // OAuth platform, dll.
                    else -> true                                                             // blokir skema lain (intent:, file:, dll.)
                }
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                progress.visibility = View.VISIBLE
            }
            override fun onPageFinished(view: WebView, url: String?) {
                progress.visibility = View.GONE
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError()
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()        // JANGAN pernah handler.proceed()
                showError()
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) { progress.progress = newProgress }
            override fun onShowFileChooser(webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    picker.launch(params.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }
    }

    private fun showError() {
        progress.visibility = View.GONE
        errorView.visibility = View.VISIBLE
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        web.destroy()
        super.onDestroy()
    }
}
