package dev.kaleve.monet.core

import org.junit.Assert.*
import org.junit.Test

class FormatTest {
    @Test fun agoBuckets() {
        val now = 10_000_000_000L
        assertEquals(Ago(Unit.Never, 0), ago(0, now))
        assertEquals(Ago(Unit.Now, 0), ago(now - 30_000, now))
        assertEquals(Ago(Unit.Minutes, 4), ago(now - 4 * 60_000, now))
        assertEquals(Ago(Unit.Hours, 3), ago(now - 190 * 60_000, now))
        assertEquals(Ago(Unit.Days, 2), ago(now - 49 * 3_600_000L, now))
        assertEquals(Ago(Unit.Now, 0), ago(now + 5000, now))
    }
}
