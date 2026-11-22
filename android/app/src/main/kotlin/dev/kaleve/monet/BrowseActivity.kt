package dev.kaleve.monet

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import dev.kaleve.device.TokenVault
import dev.kaleve.device.WebApp
import dev.kaleve.monet.data.Settings

/**
 * The launcher: the app is the web app. It opens the paired server as a Trusted Web Activity (Chrome's engine, full
 * screen, the same passkeys and session as Chrome), so everything you look at is the one web codebase. Chrome shows
 * it without an address bar once the server's /.well-known/assetlinks.json names this app's signing key.
 * Native stays only what a browser cannot do: the backup, set up in [MainActivity] (pairing on first start, later
 * through the icon's long-press shortcut "Sicherung" or the link in the web app's place). The TWA plumbing is the
 * shared WebApp (oss-kit android-device).
 */
class BrowseActivity : Activity() {
    private val web by lazy { WebApp(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (TokenVault(this).load() == null) {
            // its own task (taskAffinity in the manifest): left in the launcher's task, the icon would bring the
            // backup screen back to the front forever instead of starting this activity again
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); finish(); return
        }
        web.open(Uri.parse(Settings(this).server)) { finish() }
    }

    override fun onDestroy() {
        web.close()
        super.onDestroy()
    }

    companion object {
        /** From the backup screen: the library in the web app. CLEAR_TASK, because a plain start only brings the
         *  launcher's task to the front and this activity would not run at all. */
        fun start(ctx: Context) = ctx.startActivity(Intent(ctx, BrowseActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    }
}
