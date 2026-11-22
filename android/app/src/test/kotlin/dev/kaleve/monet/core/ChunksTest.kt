package dev.kaleve.monet.core

import org.junit.Assert.*
import org.junit.Test

class ChunksTest {
    private val mib = 1024L * 1024

    @Test fun smallFileIsOneChunk() = assertEquals(listOf(Chunk(0, 1000)), planChunks(1000))

    @Test fun exactMultipleHasNoEmptyTail() {
        val p = planChunks(32 * mib)
        assertEquals(listOf(Chunk(0, 16 * mib), Chunk(16 * mib, 16 * mib)), p)
    }

    @Test fun remainderIsLast() {
        val p = planChunks(40 * mib)
        assertEquals(3, p.size); assertEquals(8 * mib, p.last().length); assertEquals(40 * mib, p.last().offset + p.last().length)
    }

    @Test fun planFromResumeOffset() = assertEquals(listOf(Chunk(20 * mib, 16 * mib), Chunk(36 * mib, 4 * mib)), planChunks(40 * mib, from = 20 * mib))

    @Test fun nothingPastTheEnd() { assertNull(nextChunk(100, 100)); assertNull(nextChunk(-1, 100)); assertTrue(planChunks(0).isEmpty()) }

    @Test fun okMovesToNextOrDone() {
        assertEquals(Step.Continue(16 * mib), afterChunk(200, 16 * mib, 0, 16 * mib, 40 * mib, 0))
        assertEquals(Step.Done, afterChunk(200, null, 32 * mib, 8 * mib, 40 * mib, 0))
    }

    @Test fun conflictResumesFromServerOffset() {
        assertEquals(Step.Continue(10 * mib), afterChunk(409, 10 * mib, 16 * mib, 16 * mib, 40 * mib, 0))
        assertEquals(Step.Done, afterChunk(409, 40 * mib, 0, 16 * mib, 40 * mib, 0))
    }

    @Test fun conflictThatNeverMovesGivesUp() {
        assertTrue(afterChunk(409, 0, 0, 16 * mib, 40 * mib, 2) is Step.Fail)
        assertTrue(afterChunk(409, null, 0, 16 * mib, 40 * mib, 0) is Step.Fail)
        assertTrue(afterChunk(409, 50 * mib, 0, 16 * mib, 40 * mib, 0) is Step.Fail)
    }

    @Test fun authAndServerErrorsFail() {
        assertEquals(Step.Fail("unauthorized"), afterChunk(401, null, 0, 1, 10, 0))
        assertTrue(afterChunk(500, null, 0, 1, 10, 0) is Step.Fail)
    }
}
