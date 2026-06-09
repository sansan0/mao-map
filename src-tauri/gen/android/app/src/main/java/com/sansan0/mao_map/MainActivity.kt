package com.sansan0.mao_map

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    WindowInsetsControllerCompat(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }

    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(bars.left, bars.top, bars.right, 0)
      insets
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)

    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val displayCutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      val density = resources.displayMetrics.density

      val safeTop = maxOf(systemBars.top, displayCutout.top)
      val safeBottom = maxOf(systemBars.bottom, displayCutout.bottom)
      val safeLeft = maxOf(systemBars.left, displayCutout.left)
      val safeRight = maxOf(systemBars.right, displayCutout.right)

      val script = """
        document.documentElement.style.setProperty('--safe-area-inset-top', '${(safeTop / density).roundToInt()}px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '${(safeBottom / density).roundToInt()}px');
        document.documentElement.style.setProperty('--safe-area-inset-left', '${(safeLeft / density).roundToInt()}px');
        document.documentElement.style.setProperty('--safe-area-inset-right', '${(safeRight / density).roundToInt()}px');
      """.trimIndent()

      webView.evaluateJavascript(script, null)
      insets
    }
  }
}
