package dev.kaleve.monet.work

import android.content.ContentResolver
import android.os.ParcelFileDescriptor
import dev.kaleve.monet.core.*
import dev.kaleve.monet.data.*
import dev.kaleve.device.Unauthorized
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

enum class Outcome { Done, Retry, Unauthorized }

/**
 * One backup run: scan, hash what is new, ask the server what it lacks, upload
 * that in 16 MiB chunks. Everything blocking; the worker calls it on a worker thread.
 */
class Engine(
    private val cr: ContentResolver,
    private val settings: Settings,
    private val store: HashStore,
    private val api: Api,
) {
    private fun openOriginal(l: Local): InputStream? =
        try { cr.openInputStream(Media.originalOf(l)) }
        catch (_: SecurityException) { cr.openInputStream(Media.uriOf(l)) }  // no ACCESS_MEDIA_LOCATION
        catch (_: UnsupportedOperationException) { cr.openInputStream(Media.uriOf(l)) }  // same, as MediaStore reports it

    private fun openFd(l: Local): ParcelFileDescriptor? =
        try { cr.openFileDescriptor(Media.originalOf(l), "r") }
        catch (_: SecurityException) { cr.openFileDescriptor(Media.uriOf(l), "r") }
        catch (_: UnsupportedOperationException) { cr.openFileDescriptor(Media.uriOf(l), "r") }

    /** Streaming SHA-256; null when the bytes read do not match the size MediaStore reported. */
    internal fun hash(l: Local): String? {
        val md = MessageDigest.getInstance("SHA-256")
        var n = 0L
        (openOriginal(l) ?: return null).use { s ->
            val buf = ByteArray(1 shl 20)
            while (true) { val r = s.read(buf); if (r < 0) break; md.update(buf, 0, r); n += r }
        }
        if (n != l.size) return null
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun upload(l: Local, sha: String, onBytes: (Long) -> Unit, stopped: () -> Boolean) {
        val total = l.size
        var offset = 0L
        var stalls = 0
        openFd(l)?.use { pfd ->
            FileInputStream(pfd.fileDescriptor).use { fin ->
                while (true) {
                    if (stopped()) throw IOException("stopped")
                    val c = nextChunk(offset, total) ?: return
                    fin.channel.position(c.offset)
                    val r = api.putChunk(sha, c.offset, total, l.name, l.modified, c.length, fin, onBytes)
                    when (val step = afterChunk(r.status, r.received, c.offset, c.length, total, stalls)) {
                        Step.Done -> return
                        is Step.Continue -> { stalls = if (step.offset == offset) stalls + 1 else 0; offset = step.offset }
                        is Step.Fail -> throw IOException(step.reason)
                    }
                }
            }
        } ?: throw IOException("cannot open")
    }

    fun run(progress: (done: Int, total: Int) -> Unit, stopped: () -> Boolean): Outcome {
        try {
            var rounds = 0
            while (rounds++ < 5) {
                val locals = Media.scan(cr)
                val enabled = locals.groupBy { it.bucketId }.filter { (id, l) -> settings.folderOn(id, l.first().bucket) }.keys
                val todo = pending(locals, enabled, store)
                if (todo.isEmpty()) break
                var done = 0
                progress(0, todo.size)
                for (batch in todo.chunked(40)) {
                    if (stopped()) return Outcome.Retry
                    val hashed = ArrayList<Pair<Local, String>>()
                    for (l in batch) {
                        val known = store.get(l.id, l.size, l.modified)
                        if (known != null) { hashed += l to known.sha256; continue }
                        val sha = try { hash(l) } catch (_: IOException) { null } catch (_: SecurityException) { null }
                        if (sha == null) { done++; continue }  // vanished or still being written: next round
                        store.put(Seen(l.id, l.size, l.modified, sha, false, 0, l.video))
                        hashed += l to sha
                        progress(done, todo.size)
                    }
                    if (hashed.isEmpty()) continue
                    val missing = api.check(hashed.map { it.second }.distinct())
                    val now = System.currentTimeMillis()
                    for ((l, sha) in hashed) {
                        if (stopped()) return Outcome.Retry
                        if (sha !in missing) {
                            store.markOnServer(l.id, now)
                        } else {
                            upload(l, sha, onBytes = {}, stopped = stopped)
                            store.markOnServer(l.id, System.currentTimeMillis())
                        }
                        done++
                        progress(done, todo.size)
                    }
                }
            }
            settings.lastBackupAt = System.currentTimeMillis()
            return Outcome.Done
        } catch (_: Unauthorized) {
            return Outcome.Unauthorized
        } catch (_: IOException) {
            return Outcome.Retry
        }
    }
}
