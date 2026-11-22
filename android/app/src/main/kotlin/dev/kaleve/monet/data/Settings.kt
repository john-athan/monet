package dev.kaleve.monet.data

import android.content.Context

/** Plain preferences: server, folder switches, conditions. The token is not here. */
class Settings(context: Context) {
    private val p = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var server: String
        get() = p.getString("server", DEFAULT_SERVER) ?: DEFAULT_SERVER
        set(v) = p.edit().putString("server", v).apply()
    var wifiOnly: Boolean
        get() = p.getBoolean("wifiOnly", true)
        set(v) = p.edit().putBoolean("wifiOnly", v).apply()
    var chargingOnly: Boolean
        get() = p.getBoolean("chargingOnly", false)
        set(v) = p.edit().putBoolean("chargingOnly", v).apply()
    /** Key of the paired library's style; the server's word, applied by Styles.of. */
    var style: String
        get() = p.getString("style", "monet") ?: "monet"
        set(v) = p.edit().putString("style", v).apply()
    var lastBackupAt: Long
        get() = p.getLong("lastBackupAt", 0)
        set(v) = p.edit().putLong("lastBackupAt", v).apply()

    /** An unseen folder is on only when it is the camera folder. */
    fun folderOn(bucketId: Long, bucketName: String): Boolean =
        if (p.contains("f$bucketId")) p.getBoolean("f$bucketId", false) else bucketName == "Camera"
    fun setFolder(bucketId: Long, on: Boolean) = p.edit().putBoolean("f$bucketId", on).apply()

    companion object { const val DEFAULT_SERVER = "https://monet.kaleve.dev" }
}
