package dev.kaleve.monet.ui

import android.app.PendingIntent
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.provider.MediaStore
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.kaleve.device.*
import dev.kaleve.monet.core.*
import dev.kaleve.monet.data.*
import dev.kaleve.monet.work.BackupState
import dev.kaleve.monet.work.Scheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.Calendar

data class Folder(val id: Long, val name: String, val photos: Int, val videos: Int, val on: Boolean)

data class Status(
    val folders: List<Folder> = emptyList(),
    val pending: Int = 0,
    val waiting: List<Local> = emptyList(),
    val freeCount: Int = 0, val freePhotos: Int = 0, val freeVideos: Int = 0, val freeBytes: Long = 0,
    val todayPhotos: Int = 0, val todayVideos: Int = 0,
    val unmetered: Boolean = true, val charging: Boolean = false,
)

enum class PairError { Code, Server, Network, Rate }
class FreeRequest(val request: PendingIntent, val ids: List<Long>)

/** Everything the screens read. Written on the main thread, computed on IO. */
class Model(private val ctx: Context) {
    val settings = Settings(ctx)
    private val vault = TokenVault(ctx)
    val store = SqlHashStore(ctx)

    var style by mutableStateOf(Styles.of(settings.style))
    var paired by mutableStateOf(vault.load() != null)
    var hasAccess by mutableStateOf(Media.hasAccess(ctx))
    /** Only the photos the user picked (Android 14+). */
    var partial by mutableStateOf(hasAccess && !Media.hasFullAccess(ctx))
    /** Android no longer shows the permission dialog; only the app settings can grant access. */
    var blocked by mutableStateOf(false)
    var status by mutableStateOf(Status())
    var wifiOnly by mutableStateOf(settings.wifiOnly)
    var chargingOnly by mutableStateOf(settings.chargingOnly)
    var lastBackupAt by mutableStateOf(settings.lastBackupAt)
    /** null while unknown */
    var connected by mutableStateOf<Boolean?>(null)
    var message by mutableStateOf<Int?>(null)
    var freeing by mutableStateOf(false)

    suspend fun pair(serverRaw: String, codeRaw: String): PairError? {
        val server = normalizeServer(serverRaw) ?: return PairError.Server
        val err = withContext(Dispatchers.IO) {
            try {
                val token = Api(server).claim(normalizeCode(codeRaw))
                vault.save(token)
                settings.server = server
                null
            } catch (e: ApiError) {
                if (e.status == 429) PairError.Rate else PairError.Code
            } catch (_: Exception) {
                PairError.Network
            }
        }
        if (err != null) return err
        paired = true
        BackupState.unauthorized.value = false
        Scheduler.configure(ctx); Scheduler.kick(ctx)
        checkServer()
        return null
    }

    fun unpair() { vault.clear(); Scheduler.cancelAll(ctx); paired = false }

    fun setFolder(f: Folder, on: Boolean) {
        settings.setFolder(f.id, on)
        status = status.copy(folders = status.folders.map { if (it.id == f.id) it.copy(on = on) else it })
        if (on) Scheduler.kick(ctx)
    }
    fun setWifi(v: Boolean) { wifiOnly = v; settings.wifiOnly = v; Scheduler.configure(ctx) }
    fun setCharging(v: Boolean) { chargingOnly = v; settings.chargingOnly = v; Scheduler.configure(ctx) }

    suspend fun checkServer() {
        val token = vault.load() ?: return
        var theme = ""
        connected = withContext(Dispatchers.IO) {
            try { theme = Api(settings.server, token).status().optString("theme"); true }
            catch (_: Unauthorized) { BackupState.unauthorized.value = true; false }
            catch (_: Exception) { false }
        }
        if (theme.isNotEmpty()) { settings.style = theme; style = Styles.of(theme) }
        if (BackupState.unauthorized.value) { vault.clear(); paired = false }
    }

    suspend fun refresh() {
        hasAccess = Media.hasAccess(ctx)
        partial = hasAccess && !Media.hasFullAccess(ctx)
        if (Media.hasFullAccess(ctx)) blocked = false
        lastBackupAt = settings.lastBackupAt
        status = withContext(Dispatchers.IO) { compute() }
    }

    private fun compute(): Status {
        val locals = Media.scan(ctx.contentResolver)
        // Rows deleted from the phone no longer belong in the store.
        val live = locals.map { it.id }.toHashSet()
        if (locals.isNotEmpty()) store.remove(store.all().filter { it.id !in live }.map { it.id })

        val byBucket = locals.groupBy { it.bucketId }
        val folders = byBucket.map { (id, l) ->
            Folder(id, l.first().bucket, l.count { !it.video }, l.count { it.video }, settings.folderOn(id, l.first().bucket))
        }.sortedWith(compareByDescending<Folder> { it.name == "Camera" }.thenByDescending { it.photos + it.videos }.thenBy { it.name })
        val enabled = folders.filter { it.on }.map { it.id }.toSet()
        val todo = pending(locals, enabled, store)
        val conf = confirmed(locals, store)
        val dayStart = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        val today = store.all().filter { it.onServer && it.uploadedAt >= dayStart }
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val unmetered = cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
        val charging = ctx.getSystemService(BatteryManager::class.java).isCharging
        return Status(
            folders = folders, pending = todo.size, waiting = todo.take(3),
            freeCount = conf.size, freePhotos = conf.count { !it.first.video }, freeVideos = conf.count { it.first.video },
            freeBytes = conf.sumOf { it.first.size },
            todayPhotos = today.count { !it.video }, todayVideos = today.count { it.video },
            unmetered = unmetered, charging = charging,
        )
    }

    /**
     * Asks the server again, right now, which of the phone's confirmed items it really holds, and builds
     * the system delete request for exactly those. Nothing is deleted here: the system dialog decides.
     * Returns null (and sets [message]) when there is nothing safe to delete or the server cannot be asked.
     */
    suspend fun prepareFree(): FreeRequest? = withContext(Dispatchers.IO) {
        val token = vault.load() ?: return@withContext null
        try {
            val locals = Media.scan(ctx.contentResolver)
            val conf = confirmed(locals, store).take(MAX_DELETE)
            val missing = HashSet<String>()
            val api = Api(settings.server, token)
            conf.map { it.second.sha256 }.distinct().chunked(500).forEach { missing += api.check(it) }
            val safe = conf.filter { it.second.sha256 !in missing }
            if (safe.isEmpty()) { message = dev.kaleve.monet.R.string.frei_nichts; return@withContext null }
            val pi = MediaStore.createDeleteRequest(ctx.contentResolver, safe.map { Media.uriOf(it.first) })
            FreeRequest(pi, safe.map { it.first.id })
        } catch (_: Unauthorized) {
            BackupState.unauthorized.value = true; null
        } catch (_: IOException) {
            message = dev.kaleve.monet.R.string.frei_offline; null
        }
    }

    suspend fun finishFree(ids: List<Long>) { withContext(Dispatchers.IO) { store.remove(ids) }; refresh() }

    companion object { const val MAX_DELETE = 1000 }
}
