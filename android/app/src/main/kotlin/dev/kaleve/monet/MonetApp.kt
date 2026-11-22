package dev.kaleve.monet

import android.app.Application
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import dev.kaleve.monet.data.Media
import dev.kaleve.device.TokenVault
import dev.kaleve.monet.work.Scheduler

class MonetApp : Application() {
    private val handler = Handler(Looper.getMainLooper())
    private val fire = Runnable { if (Media.hasAccess(this) && TokenVault(this).load() != null) Scheduler.kick(this) }

    override fun onCreate() {
        super.onCreate()
        // While the process is alive a ContentObserver reacts at once (debounced); when it is not,
        // the content-URI trigger of WatchWorker and the 6 hour job take over.
        val obs = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean) { handler.removeCallbacks(fire); handler.postDelayed(fire, 5_000) }
        }
        contentResolver.registerContentObserver(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, obs)
        contentResolver.registerContentObserver(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, obs)
        if (TokenVault(this).load() != null) Scheduler.configure(this)
    }
}
