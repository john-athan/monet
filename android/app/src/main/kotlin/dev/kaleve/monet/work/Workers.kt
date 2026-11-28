package dev.kaleve.monet.work

import android.content.Context
import android.provider.MediaStore
import androidx.work.*
import dev.kaleve.monet.data.*
import dev.kaleve.device.TokenVault
import java.util.concurrent.TimeUnit

class BackupWorker(private val ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun getForegroundInfo(): ForegroundInfo = Notifications.info(ctx, 0, 0)

    override suspend fun doWork(): Result {
        val token = TokenVault(ctx).load() ?: return Result.success()
        if (!Media.hasAccess(ctx)) return Result.success()
        val settings = Settings(ctx)
        val engine = Engine(ctx.contentResolver, settings, SqlHashStore(ctx), Api(settings.server, token))
        var lastNotify = 0L
        try { setForeground(Notifications.info(ctx, 0, 0)) } catch (_: Exception) { /* not allowed from background: carry on without */ }
        val outcome = try {
            engine.run(progress = { d, t, part ->
                BackupState.running.value = BackupState.Progress(d, t)
                val now = System.currentTimeMillis()
                if (now - lastNotify > 1500) {
                    lastNotify = now
                    try { setForegroundAsync(Notifications.info(ctx, d, t, part)) } catch (_: Exception) {}
                }
            }, stopped = { isStopped })
        } finally {
            BackupState.running.value = null
        }
        return when (outcome) {
            Outcome.Done -> Result.success()
            Outcome.Retry -> if (isStopped) Result.success() else Result.retry()
            Outcome.Unauthorized -> { TokenVault(ctx).clear(); BackupState.unauthorized.value = true; Result.failure() }
        }
    }
}

/** Fires when MediaStore changes (a system content observer), starts a backup and re-arms itself. */
class WatchWorker(private val ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        if (TokenVault(ctx).load() != null) { Scheduler.kick(ctx); Scheduler.watch(ctx) }
        return Result.success()
    }
}

object Scheduler {
    private fun constraints(s: Settings, allowMobile: Boolean = false): Constraints = Constraints.Builder()
        .setRequiredNetworkType(if (s.wifiOnly && !allowMobile) NetworkType.UNMETERED else NetworkType.CONNECTED)
        .setRequiresCharging(s.chargingOnly && !allowMobile)
        .build()

    /** Safety net every 6 hours, plus the MediaStore watcher. Call again whenever a switch changes. */
    fun configure(ctx: Context) {
        val s = Settings(ctx)
        val wm = WorkManager.getInstance(ctx)
        wm.enqueueUniquePeriodicWork("periodic", ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<BackupWorker>(6, TimeUnit.HOURS).setConstraints(constraints(s)).build())
        watch(ctx)
    }

    fun watch(ctx: Context) {
        val s = Settings(ctx)
        val b = OneTimeWorkRequestBuilder<WatchWorker>().setConstraints(
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED)
                .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
                .addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
                .setTriggerContentUpdateDelay(10, TimeUnit.SECONDS)
                .setTriggerContentMaxDelay(60, TimeUnit.SECONDS)
                .build())
        WorkManager.getInstance(ctx).enqueueUniqueWork("watch", ExistingWorkPolicy.REPLACE, b.build())
        @Suppress("UNUSED_VARIABLE") val unused = s
    }

    /** Expedited run now, under the switches. */
    fun kick(ctx: Context) {
        val s = Settings(ctx)
        val req = OneTimeWorkRequestBuilder<BackupWorker>()
            .setConstraints(constraints(s))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("now", ExistingWorkPolicy.KEEP, req)
    }

    /** "Jetzt über mobile Daten senden": one run that ignores the WLAN and charging switches. */
    fun sendOverMobile(ctx: Context) {
        val s = Settings(ctx)
        val wm = WorkManager.getInstance(ctx)
        wm.cancelUniqueWork("now")
        val req = OneTimeWorkRequestBuilder<BackupWorker>()
            .setConstraints(constraints(s, allowMobile = true))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        wm.enqueueUniqueWork("now-mobile", ExistingWorkPolicy.REPLACE, req)
    }

    fun cancelAll(ctx: Context) = WorkManager.getInstance(ctx).cancelAllWork()
}
