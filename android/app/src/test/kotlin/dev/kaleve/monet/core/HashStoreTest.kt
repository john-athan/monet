package dev.kaleve.monet.core

import org.junit.Assert.*
import org.junit.Test

class HashStoreTest {
    private fun local(id: Long, size: Long = 10, mod: Long = 5, bucket: Long = 1) =
        Local(id, size, mod, false, bucket, "Camera", "IMG_$id.jpg", 0)

    @Test fun hitNeedsIdSizeAndDateToMatch() {
        val s = MemoryHashStore(); s.put(Seen(1, 10, 5, "aa", false, 0, false))
        assertNotNull(s.get(1, 10, 5)); assertNull(s.get(1, 11, 5)); assertNull(s.get(1, 10, 6)); assertNull(s.get(2, 10, 5))
    }

    @Test fun markOnServerKeepsFirstUploadTime() {
        val s = MemoryHashStore(); s.put(Seen(1, 10, 5, "aa", false, 0, false))
        s.markOnServer(1, 100); s.markOnServer(1, 200)
        assertEquals(100L, s.get(1, 10, 5)!!.uploadedAt); assertTrue(s.get(1, 10, 5)!!.onServer)
    }

    @Test fun pendingIsEnabledFoldersNotYetOnServer() {
        val s = MemoryHashStore()
        s.put(Seen(1, 10, 5, "aa", true, 1, false))
        val locals = listOf(local(1), local(2), local(3, bucket = 9))
        assertEquals(listOf(2L), pending(locals, setOf(1L), s).map { it.id })
    }

    @Test fun editedPhotoIsPendingAgain() {
        val s = MemoryHashStore(); s.put(Seen(1, 10, 5, "aa", true, 1, false))
        assertEquals(listOf(1L), pending(listOf(local(1, mod = 6)), setOf(1L), s).map { it.id })
    }

    @Test fun confirmedOnlyWhenStoreMatchesCurrentRow() {
        val s = MemoryHashStore()
        s.put(Seen(1, 10, 5, "aa", true, 1, false)); s.put(Seen(2, 10, 5, "bb", false, 0, false)); s.put(Seen(3, 10, 5, "cc", true, 1, false))
        val c = confirmed(listOf(local(1), local(2), local(3, size = 99)), s)
        assertEquals(listOf(1L), c.map { it.first.id }); assertEquals("aa", c[0].second.sha256)
    }

    @Test fun removeForgets() {
        val s = MemoryHashStore(); s.put(Seen(1, 10, 5, "aa", true, 1, false)); s.remove(listOf(1L))
        assertTrue(s.all().isEmpty())
    }
}
