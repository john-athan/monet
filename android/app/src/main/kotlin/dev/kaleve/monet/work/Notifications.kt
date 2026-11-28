package dev.kaleve.monet.work

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.Context
import android.content.pm.ServiceInfo
import androidx.work.ForegroundInfo
import dev.kaleve.monet.MainActivity
import dev.kaleve.monet.R

object Notifications {
    private const val CHANNEL = "backup"
    private const val ID = 4321

    /** [part] is how far the file being sent is, so the bar moves during a long video too. */
    fun info(context: Context, done: Int, total: Int, part: Float = 0f): ForegroundInfo {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, context.getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW))
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(context.getString(R.string.notif_title))
            .setContentText(if (total > 0) context.getString(R.string.sichert_von, done, total) else null)
            .setProgress(total * 100, done * 100 + (part.coerceIn(0f, 1f) * 100).toInt(), total == 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
            .build()
        return ForegroundInfo(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    }
}
