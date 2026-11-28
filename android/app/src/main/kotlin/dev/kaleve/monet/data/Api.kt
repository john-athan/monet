package dev.kaleve.monet.data

import dev.kaleve.device.DeviceApi
import dev.kaleve.device.Unauthorized
import dev.kaleve.monet.core.CHUNK_BYTES
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.URLEncoder
import java.util.concurrent.atomic.AtomicLong

/** Server answer to one chunk. */
data class ChunkReply(val status: Int, val received: Long?, val finished: Boolean, val duplicate: Boolean)

/** Monet's own calls; pairing, the token header and the error mapping are the shared DeviceApi. */
class Api(server: String, token: String? = null) : DeviceApi(server, token) {

    /** True when the server answers /api/status with this token. */
    fun status(): JSONObject {
        return call("GET", "/api/status")
    }

    /** Which of [hashes] the server does not have. */
    fun check(hashes: List<String>): Set<String> {
        val arr = call("POST", "/api/upload/check", JSONObject().put("hashes", JSONArray(hashes))).getJSONArray("missing")
        return buildSet { for (i in 0 until arr.length()) add(arr.getString(i)) }
    }

    /** PUT one chunk. [data] must yield exactly [length] bytes. */
    fun putChunk(sha: String, offset: Long, total: Long, name: String, mtimeSec: Long, length: Long, data: InputStream, onBytes: (Long) -> Unit): ChunkReply {
        val q = "offset=$offset&total=$total&name=${URLEncoder.encode(name, "UTF-8")}&mtime=$mtimeSec&source=android"
        val c = open("/api/upload/$sha?$q", "PUT")
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/octet-stream")
        c.setFixedLengthStreamingMode(length)
        c.readTimeout = 120_000
        val buf = ByteArray(64 * 1024)
        var left = length
        // A socket write has no timeout of its own: on a connection that went silent (WLAN handover, the tunnel
        // dropping the stream) it blocks for as long as TCP keeps trying, which can be most of an hour. The watchdog
        // closes the connection once no byte has moved for STALL_MS, the write throws and the engine resumes.
        val moved = AtomicLong(System.currentTimeMillis())
        val dog = Thread {
            try {
                while (true) {
                    Thread.sleep(5_000)
                    if (System.currentTimeMillis() - moved.get() > STALL_MS) { c.disconnect(); return@Thread }
                }
            } catch (_: InterruptedException) { /* the body is out */ }
        }.apply { isDaemon = true; start() }
        try {
            c.outputStream.use { out ->
                while (left > 0) {
                    val n = data.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                    if (n < 0) throw IOException("file ended early")
                    out.write(buf, 0, n); left -= n; moved.set(System.currentTimeMillis()); onBytes(n.toLong())
                }
            }
        } finally {
            dog.interrupt()
        }
        val status = c.responseCode
        val text = body(c)
        if (status == 401 || status == 403) throw Unauthorized()
        val j = runCatching { JSONObject(text) }.getOrNull()
        val received = j?.takeIf { it.has("received") }?.getLong("received")
        return ChunkReply(status, received, j?.has("item") == true, j?.optBoolean("duplicate") == true)
    }

    companion object {
        const val CHUNK = CHUNK_BYTES
        /** No byte written for this long: the connection is dead. */
        const val STALL_MS = 60_000L
    }
}
