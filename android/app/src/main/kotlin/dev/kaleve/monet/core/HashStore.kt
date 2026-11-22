package dev.kaleve.monet.core

/** What the phone knows about one MediaStore row. */
data class Seen(
    val id: Long,
    val size: Long,
    val modified: Long,
    val sha256: String,
    val onServer: Boolean,
    val uploadedAt: Long,
    val video: Boolean,
)

/**
 * Remembers sha256 per MediaStore row. A row counts only while id, size and
 * date_modified are all unchanged; an edited photo is hashed again.
 */
interface HashStore {
    fun get(id: Long, size: Long, modified: Long): Seen?
    fun put(seen: Seen)
    fun markOnServer(id: Long, atMillis: Long)
    fun all(): List<Seen>
    fun remove(ids: Collection<Long>)
}

class MemoryHashStore : HashStore {
    private val rows = LinkedHashMap<Long, Seen>()
    override fun get(id: Long, size: Long, modified: Long): Seen? =
        rows[id]?.takeIf { it.size == size && it.modified == modified }
    override fun put(seen: Seen) { rows[seen.id] = seen }
    override fun markOnServer(id: Long, atMillis: Long) {
        rows[id]?.let { rows[id] = it.copy(onServer = true, uploadedAt = if (it.uploadedAt == 0L) atMillis else it.uploadedAt) }
    }
    override fun all(): List<Seen> = rows.values.toList()
    override fun remove(ids: Collection<Long>) { ids.forEach { rows.remove(it) } }
}

/** One row of MediaStore as the scanner reads it. */
data class Local(
    val id: Long, val size: Long, val modified: Long, val video: Boolean,
    val bucketId: Long, val bucket: String, val name: String, val takenMs: Long,
)

/** Rows in enabled folders that the server does not have confirmed yet. */
fun pending(locals: List<Local>, enabled: Set<Long>, store: HashStore): List<Local> =
    locals.filter { it.bucketId in enabled && store.get(it.id, it.size, it.modified)?.onServer != true }

/** Rows whose current state the store has confirmed on the server: candidates for freeing space. */
fun confirmed(locals: List<Local>, store: HashStore): List<Pair<Local, Seen>> =
    locals.mapNotNull { l -> store.get(l.id, l.size, l.modified)?.takeIf { it.onServer }?.let { l to it } }
