package dev.kaleve.monet.core

/** Upload chunk size. The server accepts up to 32 MiB; 16 MiB keeps retries cheap. */
const val CHUNK_BYTES: Long = 16L * 1024 * 1024

data class Chunk(val offset: Long, val length: Long)

/** The chunk that starts at [offset], or null when [offset] has reached [total]. */
fun nextChunk(offset: Long, total: Long, chunk: Long = CHUNK_BYTES): Chunk? {
    if (offset < 0 || offset >= total) return null
    return Chunk(offset, minOf(chunk, total - offset))
}

/** The whole plan from [from]; used by tests and for the progress arithmetic. */
fun planChunks(total: Long, from: Long = 0, chunk: Long = CHUNK_BYTES): List<Chunk> {
    val out = ArrayList<Chunk>()
    var o = from
    while (true) { val c = nextChunk(o, total, chunk) ?: break; out += c; o += c.length }
    return out
}

/** What to do after the server answered a chunk. */
sealed interface Step {
    /** Send the chunk at this offset next; null means the file is complete. */
    data class Continue(val offset: Long) : Step
    data object Done : Step
    data class Fail(val reason: String) : Step
}

/**
 * Resume logic. [status] is the HTTP status of the PUT, [received] the byte count
 * the server reported in its body (200 and 409 both carry it), [sent] the offset
 * of the chunk we just sent plus its length, [stalls] how many 409s in a row
 * did not move the offset.
 */
fun afterChunk(status: Int, received: Long?, sentOffset: Long, sentLength: Long, total: Long, stalls: Int): Step = when {
    status == 200 || status == 201 -> {
        val next = received ?: (sentOffset + sentLength)
        if (next >= total) Step.Done else Step.Continue(next)
    }
    status == 409 -> when {
        received == null || received < 0 || received > total -> Step.Fail("409 without a usable offset")
        received >= total -> Step.Done
        received == sentOffset && stalls >= 2 -> Step.Fail("server keeps asking for offset $received")
        else -> Step.Continue(received)
    }
    status == 401 || status == 403 -> Step.Fail("unauthorized")
    else -> Step.Fail("status $status")
}
